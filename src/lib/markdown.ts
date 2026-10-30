/**
 * Renderer markdown mini yang aman: seluruh sumber di-escape dulu,
 * baru di-parse menjadi HTML terbatas (tanpa tag/atribut asing).
 * Mendukung: heading, bold/italic, inline code, fenced code,
 * list ordered/unordered, tabel, blockquote, link, hr.
 */

const AMP = "\u0026";
/** Baris blockquote: '>' asli menjadi entitas setelah escape */
const BQ_START = new RegExp(`^${AMP}gt;\\s?`);
const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, `${AMP}amp;`)
    .replace(/</g, `${AMP}lt;`)
    .replace(/>/g, `${AMP}gt;`)
    .replace(/"/g, `${AMP}quot;`);

function renderInline(escaped: string): string {
  const segments = escaped.split(/(`[^`\n]+`)/g);
  return segments
    .map((seg) => {
      if (seg.length > 2 && seg.startsWith("`") && seg.endsWith("`")) {
        return `<code>${seg.slice(1, -1)}</code>`;
      }
      return seg
        .replace(
          /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
          (_m, text: string, url: string) =>
            `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`,
        )
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    })
    .join("");
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function renderTable(header: string[], rows: string[][]): string {
  const th = header.map((c) => `<th>${renderInline(c)}</th>`).join("");
  const trs = rows
    .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

function isBlockStart(line: string): boolean {
  return (
    /^```/.test(line) ||
    /^#{1,4}\s/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line)
  );
}

export function renderMarkdown(source: string): string {
  const lines = escapeHtml(source).split(/\r?\n/);
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Fenced code
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i] ?? "")) {
        buf.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // lewati fence penutup
      html.push(`<pre><code>${buf.join("\n")}</code></pre>`);
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1]?.length ?? 1, 3);
      html.push(`<h${level}>${renderInline(heading[2] ?? "")}</h${level}>`);
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      html.push("<hr />");
      i += 1;
      continue;
    }

    // Blockquote — '>' sudah di-escape menjadi entitas sebelum parsing
    if (BQ_START.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && BQ_START.test(lines[i] ?? "")) {
        buf.push((lines[i] ?? "").replace(BQ_START, ""));
        i += 1;
      }
      html.push(`<blockquote>${renderInline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // Tabel: baris berisi | dan baris berikutnya adalah separator
    const next = lines[i + 1] ?? "";
    if (
      line.includes("|") &&
      /^\s*\|?\s*:?-{2,}[\s:|-]*$/.test(next) &&
      next.includes("-")
    ) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim() !== "") {
        rows.push(splitRow(lines[i] ?? ""));
        i += 1;
      }
      html.push(renderTable(header, rows));
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? "")) {
        items.push(renderInline((lines[i] ?? "").replace(/^[-*]\s+/, "")));
        i += 1;
      }
      html.push(`<ul>${items.map((it) => `<li>${it}</li>`).join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i] ?? "")) {
        items.push(renderInline((lines[i] ?? "").replace(/^\d+\.\s+/, "")));
        i += 1;
      }
      html.push(`<ol>${items.map((it) => `<li>${it}</li>`).join("")}</ol>`);
      continue;
    }

    // Baris kosong
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Paragraf
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() !== "" && !isBlockStart(lines[i] ?? "")) {
      para.push(renderInline(lines[i] ?? ""));
      i += 1;
    }
    html.push(`<p>${para.join("<br />")}</p>`);
  }

  return html.join("\n");
}
