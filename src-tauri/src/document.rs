//! Dependency-free local DOCX creation for the Documents view.
//!
//! DOCX is a ZIP package containing Office Open XML parts. This module writes a
//! minimal Store-compressed ZIP package so the application can produce a real
//! editable Word document without invoking a shell, an external document
//! executable, or a remote service.

use std::io::ErrorKind;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::io::AsyncWriteExt;

use crate::fs::resolve_memory_path;

const MAX_DOCUMENT_CHARS: usize = 200_000;
const MAX_DOCUMENT_TITLE_CHARS: usize = 150;
const DOCUMENTS_DIR: &str = "documents";
const CODE_DELIMITER: &str = "\u{0060}";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDraft {
    pub title: String,
    pub markdown: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedDocumentFile {
    pub file_name: String,
    pub path: String,
    pub size: u64,
}

#[derive(Debug, PartialEq, Eq)]
enum Block {
    Heading { level: u8, text: String },
    Paragraph(String),
    ListItem { ordered: bool, text: String },
    Table(Vec<Vec<String>>),
    PageBreak,
}

fn escape_xml(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => result.push_str("&amp;"),
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            '"' => result.push_str("&quot;"),
            '\'' => result.push_str("&apos;"),
            '\t' | '\n' | '\r' => result.push(character),
            character if character >= '\u{20}' => result.push(character),
            _ => result.push('\u{FFFD}'),
        }
    }
    result
}

fn heading_line(line: &str) -> Option<(u8, String)> {
    let trimmed = line.trim_start();
    let level = trimmed.chars().take_while(|character| *character == '#').count();
    if !(1..=3).contains(&level) || trimmed.as_bytes().get(level) != Some(&b' ') {
        return None;
    }
    Some((level as u8, trimmed[level + 1..].trim().to_owned()))
}

fn list_line(line: &str) -> Option<(bool, String)> {
    let trimmed = line.trim_start();
    for marker in ["- ", "* ", "+ "] {
        if let Some(text) = trimmed.strip_prefix(marker) {
            return Some((false, text.trim().to_owned()));
        }
    }

    let digit_count = trimmed.bytes().take_while(|byte| byte.is_ascii_digit()).count();
    if digit_count > 0 && trimmed.as_bytes().get(digit_count..digit_count + 2) == Some(b". ") {
        return Some((true, trimmed[digit_count + 2..].trim().to_owned()));
    }
    None
}

fn is_table_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with('|') && trimmed.contains('|')
}

fn table_cells(line: &str) -> Vec<String> {
    line.trim()
        .trim_matches('|')
        .split('|')
        .map(|cell| cell.trim().to_owned())
        .collect()
}

fn is_table_separator(row: &[String]) -> bool {
    !row.is_empty()
        && row.iter().all(|cell| {
            !cell.is_empty()
                && cell.chars().all(|character| character == '-' || character == ':' || character.is_whitespace())
                && cell.contains('-')
        })
}

fn starts_block(line: &str) -> bool {
    heading_line(line).is_some()
        || list_line(line).is_some()
        || is_table_line(line)
        || line.trim() == "[[PAGEBREAK]]"
}

fn parse_markdown(markdown: &str) -> Vec<Block> {
    let normalized = markdown.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.lines().collect();
    let mut blocks = Vec::new();
    let mut index = 0usize;

    while index < lines.len() {
        let line = lines[index];
        let trimmed = line.trim();

        if trimmed.is_empty() {
            index += 1;
            continue;
        }

        if trimmed == "[[PAGEBREAK]]" {
            blocks.push(Block::PageBreak);
            index += 1;
            continue;
        }

        if let Some((level, text)) = heading_line(line) {
            if !text.is_empty() {
                blocks.push(Block::Heading { level, text });
            }
            index += 1;
            continue;
        }

        if is_table_line(line) {
            let mut rows = Vec::new();
            while index < lines.len() && is_table_line(lines[index]) {
                let row = table_cells(lines[index]);
                if !is_table_separator(&row) {
                    rows.push(row);
                }
                index += 1;
            }
            if !rows.is_empty() {
                blocks.push(Block::Table(rows));
            }
            continue;
        }

        if let Some((ordered, text)) = list_line(line) {
            blocks.push(Block::ListItem { ordered, text });
            index += 1;
            while index < lines.len() {
                if lines[index].trim().is_empty() {
                    break;
                }
                match list_line(lines[index]) {
                    Some((next_ordered, next_text)) if next_ordered == ordered => {
                        blocks.push(Block::ListItem { ordered, text: next_text });
                        index += 1;
                    }
                    _ => break,
                }
            }
            continue;
        }

        let mut paragraph = trimmed.to_owned();
        index += 1;
        while index < lines.len() {
            let next = lines[index].trim();
            if next.is_empty() || starts_block(next) {
                break;
            }
            paragraph.push(' ');
            paragraph.push_str(next);
            index += 1;
        }
        if !paragraph.is_empty() {
            blocks.push(Block::Paragraph(paragraph));
        }
    }

    blocks
}

fn xml_text_run(value: &str, properties: Option<&str>) -> String {
    if value.is_empty() {
        return String::new();
    }
    let props = properties
        .map(|value| format!("<w:rPr>{value}</w:rPr>"))
        .unwrap_or_default();
    format!(
        "<w:r>{props}<w:t xml:space=\"preserve\">{}</w:t></w:r>",
        escape_xml(value)
    )
}

fn inline_runs(value: &str) -> String {
    let mut result = String::new();
    let mut rest = value;

    while !rest.is_empty() {
        let mut next_index = rest.len();
        let mut delimiter = "";
        for candidate in ["**", "*", CODE_DELIMITER] {
            if let Some(index) = rest.find(candidate) {
                if index < next_index {
                    next_index = index;
                    delimiter = candidate;
                }
            }
        }

        if next_index > 0 {
            result.push_str(&xml_text_run(&rest[..next_index], None));
            rest = &rest[next_index..];
            continue;
        }

        match delimiter {
            "**" => {
                if let Some(end) = rest[2..].find("**") {
                    let inner = &rest[2..2 + end];
                    result.push_str(&xml_text_run(inner, Some("<w:b/>")));
                    rest = &rest[2 + end + 2..];
                } else {
                    result.push_str(&xml_text_run("**", None));
                    rest = &rest[2..];
                }
            }
            "*" => {
                if let Some(end) = rest[1..].find('*') {
                    let inner = &rest[1..1 + end];
                    result.push_str(&xml_text_run(inner, Some("<w:i/>")));
                    rest = &rest[1 + end + 1..];
                } else {
                    result.push_str(&xml_text_run("*", None));
                    rest = &rest[1..];
                }
            }
            CODE_DELIMITER => {
                if let Some(end) = rest[1..].find(CODE_DELIMITER) {
                    let inner = &rest[1..1 + end];
                    result.push_str(&xml_text_run(
                        inner,
                        Some("<w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\"/><w:shd w:fill=\"F0F1F5\"/>"),
                    ));
                    rest = &rest[1 + end + 1..];
                } else {
                    result.push_str(&xml_text_run(CODE_DELIMITER, None));
                    rest = &rest[1..];
                }
            }
            _ => {
                result.push_str(&xml_text_run(&rest[..1], None));
                rest = &rest[1..];
            }
        }
    }

    result
}

fn paragraph_xml(value: &str, style: Option<&str>) -> String {
    let properties = style
        .map(|style| format!("<w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>"))
        .unwrap_or_default();
    format!("<w:p>{properties}{}</w:p>", inline_runs(value))
}

fn list_paragraph_xml(value: &str, ordered: bool) -> String {
    let number_id = if ordered { 2 } else { 1 };
    format!(
        "<w:p><w:pPr><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"{number_id}\"/></w:numPr><w:spacing w:after=\"100\"/></w:pPr>{}</w:p>",
        inline_runs(value)
    )
}

fn bold_cell_run(value: &str) -> String {
    format!(
        "<w:r><w:rPr><w:b/></w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r>",
        escape_xml(value)
    )
}

fn table_xml(rows: &[Vec<String>]) -> String {
    let mut xml = String::from(
        "<w:tbl><w:tblPr><w:tblStyle w:val=\"TableGrid\"/><w:tblW w:w=\"0\" w:type=\"auto\"/><w:tblBorders><w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"D7DAE4\"/><w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"D7DAE4\"/><w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"D7DAE4\"/><w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"D7DAE4\"/><w:insideH w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"D7DAE4\"/><w:insideV w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"D7DAE4\"/></w:tblBorders></w:tblPr>",
    );

    for (row_index, row) in rows.iter().enumerate() {
        xml.push_str("<w:tr>");
        for cell in row {
            let cell_style = if row_index == 0 { "<w:shd w:fill=\"EEF0F8\"/>" } else { "" };
            let cell_width = 9000 / row.len().max(1);
            let cell_runs = if row_index == 0 { bold_cell_run(cell) } else { inline_runs(cell) };
            xml.push_str(&format!(
                "<w:tc><w:tcPr><w:tcW w:w=\"{cell_width}\" w:type=\"dxa\"/>{cell_style}</w:tcPr><w:p><w:pPr><w:spacing w:after=\"60\"/></w:pPr>{cell_runs}</w:p></w:tc>"
            ));
        }
        xml.push_str("</w:tr>");
    }
    xml.push_str("</w:tbl>");
    xml
}

fn document_xml(title: &str, markdown: &str) -> String {
    let mut body = paragraph_xml(title, Some("Title"));
    body.push_str(&paragraph_xml("", None));
    for block in parse_markdown(markdown) {
        match block {
            Block::Heading { level, text } => {
                let style = match level {
                    1 => "Heading1",
                    2 => "Heading2",
                    _ => "Heading3",
                };
                body.push_str(&paragraph_xml(&text, Some(style)));
            }
            Block::Paragraph(text) => body.push_str(&paragraph_xml(&text, None)),
            Block::ListItem { ordered, text } => body.push_str(&list_paragraph_xml(&text, ordered)),
            Block::Table(rows) => body.push_str(&table_xml(&rows)),
            Block::PageBreak => body.push_str("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>"),
        }
    }

    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
         <w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\
         <w:body>{body}<w:sectPr><w:footerReference w:type=\"default\" r:id=\"rId3\"/><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/></w:sectPr></w:body></w:document>"
    )
}

fn styles_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="320" w:line="340" w:lineRule="auto"/><w:keepNext/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="293A65"/><w:sz w:val="40"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="300" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="344B79"/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="4B5D85"/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="58637E"/><w:sz w:val="24"/></w:rPr></w:style>
</w:styles>"#
}

fn numbering_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>"#
}

fn footer_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:jc w:val="center"/></w:pPr>
    <w:r><w:rPr><w:color w:val="7A8195"/><w:sz w:val="18"/></w:rPr><w:t>AzaleaHouse</w:t></w:r>
    <w:r><w:rPr><w:color w:val="7A8195"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> · Halaman </w:t></w:r>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:t>1</w:t></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
</w:ftr>"#
}

fn content_types_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"#
}

fn package_relationships_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"#
}

fn document_relationships_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>"#
}

fn core_properties_xml(title: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>{}</dc:title><dc:creator>AzaleaHouse</dc:creator><cp:lastModifiedBy>AzaleaHouse</cp:lastModifiedBy>
</cp:coreProperties>"#,
        escape_xml(title)
    )
}

fn app_properties_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>AzaleaHouse</Application><AppVersion>0.1.3</AppVersion>
</Properties>"#
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in bytes {
        crc ^= *byte as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xedb8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

fn push_u16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn make_stored_zip(entries: Vec<(String, Vec<u8>)>) -> Result<Vec<u8>, String> {
    if entries.len() > u16::MAX as usize {
        return Err("Paket dokumen berisi terlalu banyak bagian.".to_owned());
    }

    let mut output = Vec::new();
    let mut central_records: Vec<(String, u32, u32, u32)> = Vec::new();

    for (name, data) in entries {
        if name.len() > u16::MAX as usize || data.len() > u32::MAX as usize || output.len() > u32::MAX as usize {
            return Err("Paket DOCX melebihi batas format ZIP.".to_owned());
        }
        let name_bytes = name.as_bytes();
        let data_size = data.len() as u32;
        let checksum = crc32(&data);
        let local_offset = output.len() as u32;

        push_u32(&mut output, 0x0403_4b50);
        push_u16(&mut output, 20);
        push_u16(&mut output, 0x0800);
        push_u16(&mut output, 0);
        push_u16(&mut output, 0);
        push_u16(&mut output, 0x0021);
        push_u32(&mut output, checksum);
        push_u32(&mut output, data_size);
        push_u32(&mut output, data_size);
        push_u16(&mut output, name_bytes.len() as u16);
        push_u16(&mut output, 0);
        output.extend_from_slice(name_bytes);
        output.extend_from_slice(&data);

        central_records.push((name, checksum, data_size, local_offset));
    }

    let central_offset = output.len() as u32;
    for (name, checksum, size, local_offset) in &central_records {
        let name_bytes = name.as_bytes();
        push_u32(&mut output, 0x0201_4b50);
        push_u16(&mut output, 20);
        push_u16(&mut output, 20);
        push_u16(&mut output, 0x0800);
        push_u16(&mut output, 0);
        push_u16(&mut output, 0);
        push_u16(&mut output, 0x0021);
        push_u32(&mut output, *checksum);
        push_u32(&mut output, *size);
        push_u32(&mut output, *size);
        push_u16(&mut output, name_bytes.len() as u16);
        push_u16(&mut output, 0);
        push_u16(&mut output, 0);
        push_u16(&mut output, 0);
        push_u16(&mut output, 0);
        push_u32(&mut output, 0);
        push_u32(&mut output, *local_offset);
        output.extend_from_slice(name_bytes);
    }
    let central_size = (output.len() as u32).saturating_sub(central_offset);

    push_u32(&mut output, 0x0605_4b50);
    push_u16(&mut output, 0);
    push_u16(&mut output, 0);
    push_u16(&mut output, central_records.len() as u16);
    push_u16(&mut output, central_records.len() as u16);
    push_u32(&mut output, central_size);
    push_u32(&mut output, central_offset);
    push_u16(&mut output, 0);

    Ok(output)
}

fn make_docx(title: &str, markdown: &str) -> Result<Vec<u8>, String> {
    let entries = vec![
        ("[Content_Types].xml".to_owned(), content_types_xml().as_bytes().to_vec()),
        ("_rels/.rels".to_owned(), package_relationships_xml().as_bytes().to_vec()),
        ("word/document.xml".to_owned(), document_xml(title, markdown).into_bytes()),
        ("word/_rels/document.xml.rels".to_owned(), document_relationships_xml().as_bytes().to_vec()),
        ("word/styles.xml".to_owned(), styles_xml().as_bytes().to_vec()),
        ("word/numbering.xml".to_owned(), numbering_xml().as_bytes().to_vec()),
        ("word/footer1.xml".to_owned(), footer_xml().as_bytes().to_vec()),
        ("docProps/core.xml".to_owned(), core_properties_xml(title).into_bytes()),
        ("docProps/app.xml".to_owned(), app_properties_xml().as_bytes().to_vec()),
    ];
    make_stored_zip(entries)
}

async fn documents_directory(create: bool) -> Result<PathBuf, String> {
    let base = resolve_memory_path().await;
    if create {
        fs::create_dir_all(&base).await
            .map_err(|error| format!("Gagal menyiapkan .AzaleaMemory: {error}"))?;
    }
    let base_metadata = fs::symlink_metadata(&base).await
        .map_err(|error| format!("Folder .AzaleaMemory tidak dapat diperiksa: {error}"))?;
    if !base_metadata.is_dir() || base_metadata.file_type().is_symlink() {
        return Err("Root .AzaleaMemory harus berupa direktori lokal biasa.".to_owned());
    }
    let canonical_base = fs::canonicalize(&base).await
        .map_err(|error| format!("Root .AzaleaMemory tidak dapat diverifikasi: {error}"))?;
    let directory = canonical_base.join(DOCUMENTS_DIR);

    match fs::symlink_metadata(&directory).await {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("Folder documents tidak boleh berupa symlink atau file biasa.".to_owned());
            }
        }
        Err(error) if error.kind() == ErrorKind::NotFound && create => {
            fs::create_dir(&directory).await
                .map_err(|error| format!("Gagal membuat folder dokumen lokal: {error}"))?;
            let metadata = fs::symlink_metadata(&directory).await
                .map_err(|error| format!("Gagal memverifikasi folder dokumen: {error}"))?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("Folder dokumen lokal tidak aman.".to_owned());
            }
        }
        Err(error) => return Err(format!("Folder dokumen tidak dapat dibaca: {error}")),
    }

    let canonical_directory = fs::canonicalize(&directory).await
        .map_err(|error| format!("Folder dokumen tidak dapat diverifikasi: {error}"))?;
    if !canonical_directory.starts_with(&canonical_base) {
        return Err("Folder dokumen berada di luar .AzaleaMemory.".to_owned());
    }
    Ok(canonical_directory)
}

fn title_slug(title: &str) -> String {
    let mut slug = String::new();
    let mut dash_pending = false;
    for character in title.chars() {
        if character.is_ascii_alphanumeric() {
            if dash_pending && !slug.is_empty() && slug.len() < 64 {
                slug.push('-');
            }
            if slug.len() < 64 {
                slug.push(character.to_ascii_lowercase());
            }
            dash_pending = false;
        } else {
            dash_pending = !slug.is_empty();
        }
        if slug.len() >= 64 {
            break;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() { "dokumen".to_owned() } else { slug }
}

#[tauri::command]
pub async fn create_document_docx(draft: DocumentDraft) -> Result<SavedDocumentFile, String> {
    let title = draft.title.trim();
    if title.is_empty() {
        return Err("Judul dokumen wajib diisi.".to_owned());
    }
    if title.chars().count() > MAX_DOCUMENT_TITLE_CHARS {
        return Err(format!("Judul dokumen maksimal {MAX_DOCUMENT_TITLE_CHARS} karakter."));
    }
    let markdown = draft.markdown.trim();
    if markdown.is_empty() {
        return Err("Isi dokumen masih kosong.".to_owned());
    }
    if markdown.chars().count() > MAX_DOCUMENT_CHARS {
        return Err(format!("Isi dokumen melebihi batas {MAX_DOCUMENT_CHARS} karakter."));
    }

    let bytes = make_docx(title, markdown)?;
    let directory = documents_directory(true).await?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Waktu sistem tidak valid: {error}"))?
        .as_millis();
    let slug = title_slug(title);
    let mut selected_path = None;

    for sequence in 0u32..100 {
        let suffix = if sequence == 0 { String::new() } else { format!("_{sequence}") };
        let file_name = format!("{slug}_{now}{suffix}.docx");
        let path = directory.join(&file_name);
        match fs::OpenOptions::new().write(true).create_new(true).open(&path).await {
            Ok(mut handle) => {
                if let Err(error) = handle.write_all(&bytes).await {
                    drop(handle);
                    let _ = fs::remove_file(&path).await;
                    return Err(format!("Gagal menulis dokumen DOCX: {error}"));
                }
                if let Err(error) = handle.flush().await {
                    drop(handle);
                    let _ = fs::remove_file(&path).await;
                    return Err(format!("Gagal menyelesaikan file DOCX: {error}"));
                }
                selected_path = Some((file_name, path));
                break;
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Gagal membuat file DOCX lokal: {error}")),
        }
    }

    let (file_name, path) = selected_path
        .ok_or_else(|| "Tidak dapat membuat nama file unik. Coba lagi.".to_owned())?;
    Ok(SavedDocumentFile {
        file_name,
        path: path.to_string_lossy().to_string(),
        size: bytes.len() as u64,
    })
}

#[tauri::command]
pub async fn open_documents_folder() -> Result<(), String> {
    let directory = documents_directory(true).await?;
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(&directory)
            .spawn()
            .map_err(|error| format!("Gagal membuka folder dokumen: {error}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = directory;
        Err("Pembukaan folder dokumen hanya didukung di Windows.".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local_zip_entry<'a>(bytes: &'a [u8], name_wanted: &str) -> Option<&'a [u8]> {
        let mut cursor = 0usize;
        while cursor + 30 <= bytes.len() && u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().ok()?) == 0x0403_4b50 {
            let method = u16::from_le_bytes(bytes[cursor + 8..cursor + 10].try_into().ok()?);
            let compressed_size = u32::from_le_bytes(bytes[cursor + 18..cursor + 22].try_into().ok()?) as usize;
            let name_length = u16::from_le_bytes(bytes[cursor + 26..cursor + 28].try_into().ok()?) as usize;
            let extra_length = u16::from_le_bytes(bytes[cursor + 28..cursor + 30].try_into().ok()?) as usize;
            let name_start = cursor + 30;
            let data_start = name_start + name_length + extra_length;
            let data_end = data_start.checked_add(compressed_size)?;
            if data_end > bytes.len() { return None; }
            let name = std::str::from_utf8(bytes.get(name_start..name_start + name_length)?).ok()?;
            if name == name_wanted && method == 0 {
                return bytes.get(data_start..data_end);
            }
            cursor = data_end;
        }
        None
    }

    #[test]
    fn crc32_matches_standard_check_value() {
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
    }

    #[test]
    fn markdown_is_mapped_to_structural_blocks() {
        let blocks = parse_markdown("# Bab Satu\n\nParagraf utama.\n\n- Satu\n- Dua\n\n| Kolom | Nilai |\n| --- | --- |\n| A | B |\n\n[[PAGEBREAK]]");
        assert!(blocks.contains(&Block::Heading { level: 1, text: "Bab Satu".to_owned() }));
        assert!(blocks.contains(&Block::ListItem { ordered: false, text: "Satu".to_owned() }));
        assert!(blocks.iter().any(|block| matches!(block, Block::Table(rows) if rows.len() == 2)));
        assert!(blocks.contains(&Block::PageBreak));
    }

    #[test]
    fn docx_package_contains_open_xml_parts_and_escaped_text() {
        let result = make_docx("Riset & Dokumen", "# Bab Pertama\n\nTeks Bahasa Indonesia: pemilihan, jumlah, dan data.");
        assert!(result.is_ok());
        let bytes = result.expect("DOCX package should be created");
        assert!(bytes.starts_with(b"PK\x03\x04"));
        let document = local_zip_entry(&bytes, "word/document.xml").expect("document.xml part");
        let document = std::str::from_utf8(document).expect("XML must be UTF-8");
        assert!(document.contains("Riset &amp; Dokumen"));
        assert!(document.contains("Bab Pertama"));
        assert!(document.contains("Bahasa Indonesia"));
        assert!(local_zip_entry(&bytes, "[Content_Types].xml").is_some());
        assert!(local_zip_entry(&bytes, "word/numbering.xml").is_some());
        assert!(local_zip_entry(&bytes, "word/footer1.xml").is_some());
    }

    #[test]
    fn title_slug_never_contains_windows_path_separators() {
        let slug = title_slug("..\\CON: Dokumen / contoh?");
        assert!(!slug.contains('\\'));
        assert!(!slug.contains('/'));
        assert!(!slug.contains(':'));
        assert!(!slug.starts_with('.'));
    }
}
