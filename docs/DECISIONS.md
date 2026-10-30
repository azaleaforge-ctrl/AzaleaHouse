# AzaleaHouse — Decisions Log

Every technical decision that has been *tested or explicitly fixed* belongs here.
Unconfirmed items stay marked **provisional** until the user approves them.

## Confirmed by PRD (product level)
| ID | Decision | Status |
|---|---|---|
| P-01 | Product name: AzaleaHouse | locked (PRD §5) |
| P-02 | Local memory root folder name: `.AzaleaMemory` | locked (PRD §5) |
| P-03 | Default data path: `%LOCALAPPDATA%\AzaleaHouse\.AzaleaMemory\` | locked (PRD §10.1) |
| P-04 | Updates: check-only automatic, download/install always manual | locked (PRD §15.1) |
| P-05 | Implementation proceeds one phase at a time, report, then wait | locked (PRD §20) |

## Provisional (needs user approval before release)
| ID | Decision | Value used now | Risk if wrong |
|---|---|---|---|
| T-01 | Desktop shell | Tauri 2 (stable, `@tauri-apps/cli` 2.12.4) | low |
| T-02 | Frontend stack | React 19 + TypeScript 5.9 + Vite 8 | low |
| T-03 | Styling | Hand-written CSS with custom-property tokens (no Tailwind) | low, easy to swap |
| T-04 | Bundle identifier | `com.azaleahouse.desktop` | changing it later forces a reinstall path change |
| T-05 | Installer target | NSIS, `installMode: currentUser` | mode change affects uninstall/data location |
| T-06 | Local model runtime | Ollama v0.40.13 + Gemma 4 E2B (validated) | model compatibility already tested |
| T-07 | Model | Gemma 4 E2B multimodal — validated via direct HTTP | thinking via `<|think|>` system token, not `think` bool |
| T-08 | GitHub release owner/repo | `azaleaforge-ctrl/AzaleaHouse` (user-provided) | update endpoint finalized |
| T-09 | Updater signing key | **not generated**; unsigned installer execution removed by Phase 1 security containment | Phase 7 remains blocked until official Tauri signature verification is configured |

## Phase status

Statuses below use the phase numbers in the current PRD, not the separate repair-stage numbering.

| PRD phase | State | Evidence / outstanding acceptance |
|---|---|---|
| 0 — Validation & decisions | **Previously validated; rerun if environment/model changes** | Earlier record: Ollama + Gemma 4 E2B were tested through the local API. This is not a substitute for the current desktop acceptance matrix. |
| 1 — Desktop shell & design system | **Implemented; manual acceptance pending** | Tauri/React shell, sidebar, chat layout, settings, and background components exist. |
| 2 — Runtime bridge & chat | **Implemented; CI passes on main** | Ollama IPC, streaming, cancel, and visible errors exist. Interactive Windows/Ollama smoke tests remain a separate requirement. |
| 3 — Settings & runtime lifecycle | **Implemented; manual acceptance pending** | Thinking/settings and auto/manual keep-alive code exist; verify the one-hour idle and active-generation edge cases on Windows. |
| 4 — Local storage & .AzaleaMemory | **Partial; hardening in progress** | Conversation/settings persistence exists. Custom-path migration and backup are under Repair Stage 1; restore, memory deletion controls, and full migration failure acceptance remain incomplete. |
| 5 — File reader & vision | **Implemented in source; manual acceptance pending** | Stage 2 adds bounded text/code, PDF, DOCX and XLSX extraction; PNG/JPG/JPEG/WebP images; safe byte-only attachment persistence and session metadata. OCR and some PDF fonts/encodings remain limitations; validate with Windows/Ollama samples. |
| 6 — Document engine | **Partial — first DOCX/export slice** | Documents view now previews a Markdown-backed draft and writes a genuine OOXML DOCX locally with styles, lists, tables, A4 margins, and page numbering. PDF uses Windows print-to-PDF through the native print dialog; direct PDF generation and render validation remain outstanding. |
| 7 — Version Center & manual updater | **Partial / blocked** | GitHub metadata check and manual download code exist, but the official signed Tauri updater, signature verification, and Install & Restart are not configured. No GitHub Release is currently published. |
| 8 — Quality & packaging | **CI infrastructure present; release acceptance pending** | Windows CI checks frontend build and Rust compile/tests. Installer installation/uninstallation, interactive desktop behavior, and end-to-end update tests still need direct acceptance. |

## Phase 2 technical notes
- **Rust deps added:** `tokio` (macros, net, rt, sync, time), `reqwest` (rustls-tls, stream, json, gzip), `futures-util`
- **Backend commands:** `runtime_status`, `list_models`, `chat_start`, `chat_cancel`, `load_model` — all via `tauri::command`, no shell/exec
- **Event protocol (SSE over HTTP → Tauri emit):** `azalea:chat_started`, `azalea:chat_chunk`, `azalea:chat_error`, `azalea:chat_done`
- **Gemma 4 thinking:** controlled via `<|think|>` system token (per Ollama docs), not a boolean `think` param
- **Model ID mapping:** frontend `"gemma4:e2b"` matches Ollama model name directly
- **Runtime status granularity:** `unloaded` (downloaded, not in RAM) still allows chat — Ollama auto-loads on demand

## Development version and release freeze

- The development branch synchronizes application/package metadata to **0.1.3** across `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, and the frontend fallback version.
- This version change is source/configuration metadata only. It does **not** create a `v0.1.3` tag, GitHub Release, installer upload, or production update.
- Keep the release freeze in place until the planned repairs and Windows acceptance tests pass and the owner separately authorizes publication.

## Security and behavior boundaries

- The frontend does not provide arbitrary shell text for execution. The storage repair uses fixed Windows dialog/probe invocations only.
- File parsing starts from browser File objects selected explicitly by the user. Persistent attachment IPC accepts byte data plus a validated filename and never opens arbitrary caller-provided paths. Legacy path-based reader/encoder/save commands remain unregistered.
- The memory migration command consumes a one-time canonical folder selection produced by the native folder picker; it rejects a caller-supplied different destination.
- Manual installer download is constrained to the configured GitHub repository. Installer execution remains disabled until signed artifacts and the official Tauri updater verification are configured.
- UI version is read from `tauri.conf.json` via `app_version`, so app-version display follows the Tauri package configuration.
- Gemma 4 Thinking is controlled through the `<|think|>` system token for the validated Ollama path; this remains model/runtime-specific.


## Repair Stage 2 — File Reader & Vision

- File parsing operates in-memory from explicitly user-selected File objects. PDF, DOCX and XLSX contents are treated as untrusted data and are never executed.
- Supported selected attachments are copied into `.AzaleaMemory/attachments/` through byte-only IPC. The native save command does not accept an arbitrary source file path.
- Conversation records persist attachment metadata and extracted text; image bytes are stored as local files and reloaded by an app-generated attachment ID when prior sessions are reused.
- Provisional limits: one attachment up to 5 MiB, at most five files per selection, extracted text up to 30,000 characters per file, selected prompt context up to 12,000 characters.
- PDF extraction is best-effort for common text streams and FlateDecode. OCR, encrypted PDFs, complex font maps and guaranteed layout/table fidelity are not included. Spreadsheet extraction returns cell values rather than calculations or formatting.
- Version 0.1.2 is development metadata only. Do not create a release, version tag, installer upload or production update without separate authorization.


## Document Engine — first local authoring slice (PRD Phase 6)

- The Documents page now has an editor and live A4-oriented preview; Markdown headings, paragraphs, lists, tables, inline bold/italic/code, and explicit PAGEBREAK blocks are supported in the preview.
- DOCX is generated locally using a small, dependency-free Office Open XML + ZIP Store writer. The file is created inside .AzaleaMemory/documents/; its OOXML includes heading styles, list numbering, table styling, A4 page settings, and a page-number footer.
- PDF export currently delegates to the Windows print dialog. The user selects Microsoft Print to PDF to create a PDF; AzaleaHouse does not claim that this is a separate, direct PDF renderer.
- The document editor is a deterministic renderer/formatter, not yet the complete AI-to-document pipeline. The first slice accepts content written or prepared elsewhere and pasted as Markdown; generating content directly from an AI prompt, DOCX render validation, and direct PDF rendering remain future work.
- Version metadata is synchronized to 0.1.3 on this branch only. No tag, GitHub Release, installer, or production update is created.
