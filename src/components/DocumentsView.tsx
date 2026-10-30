import { useMemo, useState } from "react";
import { invokeCreateDocumentDocx, invokeOpenDocumentsFolder } from "../lib/tauri";
import "./DocumentsView.css";

type PreviewBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; rows: string[][] }
  | { type: "pageBreak" };

function parseHeading(line: string): { level: 1 | 2 | 3; text: string } | null {
  const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
  if (!match) return null;
  return { level: match[1].length as 1 | 2 | 3, text: match[2].trim() };
}

function parseListItem(line: string): { ordered: boolean; text: string } | null {
  const trimmed = line.trim();
  const bullet = /^[-*+]\s+(.+)$/.exec(trimmed);
  if (bullet) return { ordered: false, text: bullet[1] };
  const ordered = /^\d+\.\s+(.+)$/.exec(trimmed);
  if (ordered) return { ordered: true, text: ordered[1] };
  return null;
}

function isTableLine(line: string): boolean {
  return line.trim().startsWith("|") && line.trim().includes("|");
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => cell.length > 0 && /^:?-{3,}:?$/.test(cell));
}

function isBlockStart(line: string): boolean {
  return parseHeading(line) !== null
    || parseListItem(line) !== null
    || isTableLine(line)
    || line.trim() === "[[PAGEBREAK]]";
}

function parseDocumentMarkdown(markdown: string): PreviewBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: PreviewBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    if (trimmed === "[[PAGEBREAK]]") {
      blocks.push({ type: "pageBreak" });
      index += 1;
      continue;
    }
    const heading = parseHeading(line);
    if (heading) {
      blocks.push({ type: "heading", ...heading });
      index += 1;
      continue;
    }
    if (isTableLine(line)) {
      const rows: string[][] = [];
      while (index < lines.length && isTableLine(lines[index])) {
        const cells = tableCells(lines[index]);
        if (!isTableSeparator(cells)) rows.push(cells);
        index += 1;
      }
      if (rows.length) blocks.push({ type: "table", rows });
      continue;
    }
    const listItem = parseListItem(line);
    if (listItem) {
      const items = [listItem.text];
      const ordered = listItem.ordered;
      index += 1;
      while (index < lines.length) {
        if (!lines[index].trim()) break;
        const next = parseListItem(lines[index]);
        if (!next || next.ordered !== ordered) break;
        items.push(next.text);
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphs = [trimmed];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraphs.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphs.join(" ") });
  }
  return blocks;
}

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (part.length > 2 && part.charAt(0) === String.fromCharCode(96) && part.charAt(part.length - 1) === String.fromCharCode(96)) {
          return <code key={index}>{part.slice(1, -1)}</code>;
        }
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
          return <em key={index}>{part.slice(1, -1)}</em>;
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function DocumentPreview({ title, markdown }: { title: string; markdown: string }) {
  const blocks = useMemo(() => parseDocumentMarkdown(markdown), [markdown]);
  return (
    <div id="document-print-preview" className="document-preview">
      <article className="document-paper">
        <h1 className="document-paper-title">{title.trim() || "Judul dokumen"}</h1>
        {!blocks.length ? (
          <p className="document-preview-empty">Pratinjau dokumen akan muncul di sini.</p>
        ) : null}
        {blocks.map((block, index) => {
          if (block.type === "heading") {
            const Tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
            return <Tag className={"document-paper-heading level-" + block.level} key={index}><InlineMarkdown text={block.text} /></Tag>;
          }
          if (block.type === "paragraph") {
            return <p className="document-paper-paragraph" key={index}><InlineMarkdown text={block.text} /></p>;
          }
          if (block.type === "list") {
            const ListTag = block.ordered ? "ol" : "ul";
            return <ListTag className="document-paper-list" key={index}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}><InlineMarkdown text={item} /></li>)}
            </ListTag>;
          }
          if (block.type === "table") {
            return <table className="document-paper-table" key={index}>
              {block.rows.length ? (
                <thead><tr>{block.rows[0].map((cell, cellIndex) => <th key={cellIndex}><InlineMarkdown text={cell} /></th>)}</tr></thead>
              ) : null}
              {block.rows.length > 1 ? (
                <tbody>{block.rows.slice(1).map((row, rowIndex) => (
                  <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><InlineMarkdown text={cell} /></td>)}</tr>
                ))}</tbody>
              ) : null}
            </table>;
          }
          return <div key={index} className="document-page-break" aria-label="Pemisah halaman" />;
        })}
      </article>
    </div>
  );
}

export function DocumentsView() {
  const [title, setTitle] = useState("Dokumen Baru");
  const [markdown, setMarkdown] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);

  const readyToExport = title.trim().length > 0 && markdown.trim().length > 0 && !busy;
  const characterCount = markdown.length.toLocaleString("id-ID");

  async function saveDocx() {
    if (!readyToExport) return;
    setBusy(true);
    setNotice(null);
    try {
      const file = await invokeCreateDocumentDocx(title, markdown);
      setNotice({
        kind: "success",
        text: "DOCX berhasil dibuat: " + file.fileName + " · " + (file.size / 1024).toFixed(1) + " KB. Lokasi: " + file.path,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Dokumen DOCX gagal dibuat.",
      });
    } finally {
      setBusy(false);
    }
  }

  function savePdf() {
    if (!readyToExport) return;
    setNotice({
      kind: "info",
      text: "Dialog cetak akan terbuka. Pilih printer Microsoft Print to PDF, lalu tentukan nama dan lokasi PDF.",
    });
    window.print();
  }

  async function openFolder() {
    setNotice(null);
    try {
      await invokeOpenDocumentsFolder();
      setNotice({ kind: "success", text: "Folder dokumen lokal dibuka di File Explorer." });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Folder dokumen tidak dapat dibuka.",
      });
    }
  }

  return (
    <section className="document-studio" aria-label="Studio dokumen">
      <header className="document-studio-header document-no-print">
        <div>
          <span className="document-eyebrow">PRD Phase 6 · Document Engine</span>
          <h1>Studio Dokumen</h1>
          <p>Buat DOCX lokal dengan struktur yang konsisten, atau simpan pratinjau sebagai PDF melalui dialog cetak Windows.</p>
        </div>
        <div className="document-studio-actions">
          <button type="button" className="btn btn--ghost" onClick={openFolder}>Buka folder</button>
          <button type="button" className="btn btn--ghost" onClick={savePdf} disabled={!readyToExport}>Cetak / Simpan PDF</button>
          <button type="button" className="btn btn--primary" onClick={saveDocx} disabled={!readyToExport}>
            {busy ? "Membuat DOCX…" : "Simpan DOCX"}
          </button>
        </div>
      </header>

      {notice ? (
        <div className={"document-notice is-" + notice.kind + " document-no-print"} role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">
          {notice.text}
        </div>
      ) : null}

      <div className="document-workspace">
        <section className="document-editor-panel document-no-print" aria-label="Editor dokumen">
          <div className="document-panel-heading">
            <div>
              <h2>Editor</h2>
              <p>Gunakan Markdown untuk judul bagian, daftar, dan tabel.</p>
            </div>
            <span className="document-char-count">{characterCount} karakter</span>
          </div>

          <label className="document-field-label" htmlFor="document-title">Judul dokumen</label>
          <input
            id="document-title"
            className="document-title-input"
            value={title}
            maxLength={150}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Masukkan judul dokumen"
          />

          <label className="document-field-label" htmlFor="document-markdown">Isi dokumen</label>
          <textarea
            id="document-markdown"
            className="document-markdown-input"
            value={markdown}
            maxLength={200000}
            onChange={(event) => setMarkdown(event.target.value)}
            placeholder={"Tulis atau tempel konten di sini…\n\n# Pendahuluan\nParagraf pembuka.\n\n## Poin utama\n- Poin pertama\n- Poin kedua\n\n| Kolom | Keterangan |\n| --- | --- |\n| A | Nilai A |\n\nGunakan [[PAGEBREAK]] pada baris tersendiri untuk memulai halaman baru."}
            spellCheck
          />
          <p className="document-editor-help">
            DOCX: heading, paragraf, daftar, tabel, pemformatan tebal, miring, kode, dan [[PAGEBREAK]].
          </p>
        </section>

        <section className="document-preview-panel" aria-label="Pratinjau halaman A4">
          <div className="document-panel-heading document-no-print">
            <div>
              <h2>Pratinjau A4</h2>
              <p>Pratinjau berbasis browser; pagination final tetap ditentukan Word atau printer PDF.</p>
            </div>
            <span className="document-preview-badge">A4 · Portrait</span>
          </div>
          <DocumentPreview title={title} markdown={markdown} />
        </section>
      </div>
    </section>
  );
}
