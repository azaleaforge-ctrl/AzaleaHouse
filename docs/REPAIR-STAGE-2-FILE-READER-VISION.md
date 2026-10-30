# Repair Stage 2 — File Reader & Vision

**Development version:** 0.1.2 (source/configuration metadata only)  
**Status:** Implementation in PR; Windows/Ollama acceptance still required.

## Scope

Stage 2 connects the chat attachment UI to a local reader pipeline for explicitly selected files. It covers plain text and source files, JSON, CSV/TSV, PDF, DOCX, XLSX, and PNG/JPG/JPEG/WebP image input. The reader works on the browser's selected `File` object; it does not open arbitrary source filesystem paths.

## Reader and context behavior

- Up to five files are handled per selection and each file is limited to 5 MiB.
- Extracted text is capped at 30,000 characters per file.
- Prompt context uses ranked text chunks and is capped at approximately 12,000 characters across the recent attachment set. The full document is not copied blindly into each model request.
- Document contents are labeled as untrusted data so embedded instructions do not become system instructions.
- JSON is parsed before use. Images are checked against their common file signatures before being sent through the existing Ollama image field.
- PDF extraction is best-effort for common text streams and FlateDecode. There is no OCR path. Scanned PDFs, encrypted documents, unusual font maps/encodings and complex PDF layout may return an explanatory extraction error.
- DOCX and XLSX are read as ZIP/XML entirely in memory, with entry-count and expanded-size limits. No macro, script or embedded executable is run. XLSX extraction reads cell values; it does not calculate formulas or preserve formatting.

## Local persistence

Selected bytes are stored under `.AzaleaMemory/attachments/` using the new byte-only IPC commands. The backend accepts a validated name plus base64 bytes, not an arbitrary source path. It checks the extension, size, and common signatures before writing a temporary file and renaming it into place. Reload uses an app-generated attachment ID.

Conversation records now keep attachment metadata and extracted text alongside each message. Binary image data is not duplicated into transcript JSON; when an older session is sent again, the app reloads the image by its attachment ID.

The local-copy policy is the initial implementation decision for this repair stage. It keeps attachments available even after the original file is moved or removed. The temporary files can increase the size of `.AzaleaMemory`; a retention/cleanup UI is not included here.

## Validation checklist

GitHub Actions should run:
- `npm ci` and `npm run build`
- `cargo check --all-targets`
- `cargo test`

Manual Windows desktop / Ollama acceptance remains required before this work is considered fully accepted:

1. Attach and ask a question about TXT, Markdown, JSON and CSV files.
2. Attach a representative text PDF and a scanned PDF; confirm the first may extract text while the scanned PDF reports OCR is unavailable.
3. Attach representative DOCX and XLSX documents, including text in a table and values in multiple sheets.
4. Attach PNG, JPG/JPEG and WebP images and confirm the selected local model accepts the image payload.
5. Attach malformed files, wrong extensions, and files over 5 MiB. Confirm the UI reports the error without crashing.
6. Send with only an attachment and no typed question.
7. Start a chat with attachments, reopen it from history, and test regenerate; confirm extracted text remains available and stored image IDs can be loaded.
8. Close/relaunch the app and verify attachment metadata and stored files survive in the configured `.AzaleaMemory` folder.
9. Confirm nothing attempts to execute document content, macros, or source files.

## Known limits

- OCR is not implemented.
- PDF extraction is a compact best-effort parser rather than a full PDF rendering/text-layout engine. Some legitimate PDFs will fail or have reading order/font issues.
- DOCX tables are represented as extracted text; document styling, headers/footers, images and text boxes are not fully preserved.
- XLSX extraction does not calculate formula values or preserve formatting, charts and pivots.
- The chat view records metadata for attachments. An explicit attachment library management/cleanup UI is outside this stage.
- Manual Windows/Ollama checks are not claimed as passed until someone exercises the desktop build.

## Version and release discipline

All source/configuration version fields are synchronized to `0.1.2` for this development branch. This change does not create a `v0.1.2` tag, GitHub Release, installer, or production update. Keep the release freeze in place until CI and manual acceptance are reviewed and the repository owner separately authorizes a release.
