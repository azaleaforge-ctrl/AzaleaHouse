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
| 7 — Version Center & manual updater | **Partial — download reliability hardened; signed installation blocked** | Release versions are compared semantically, installer assets must match the release tag/version and size limits, downloads validate a Windows PE header, and cancellation is responsive/single-flight. The official signed Tauri updater, cryptographic signature verification, and Install & Restart remain blocked pending the owner's signing-key setup. |
| 8 — Quality & packaging | **CI infrastructure present; release acceptance pending** | Windows CI checks frontend build and Rust compile/tests. Installer installation/uninstallation, interactive desktop behavior, and end-to-end update tests still need direct acceptance. |

## Phase 2 technical notes
- **Rust deps added:** `tokio` (macros, net, rt, sync, time), `reqwest` (rustls-tls, stream, json, gzip), `futures-util`
- **Backend commands:** `runtime_status`, `list_models`, `chat_start`, `chat_cancel`, `load_model` — all via `tauri::command`, no shell/exec
- **Event protocol (SSE over HTTP → Tauri emit):** `azalea:chat_started`, `azalea:chat_chunk`, `azalea:chat_error`, `azalea:chat_done`
- **Gemma 4 thinking:** controlled via `<|think|>` system token (per Ollama docs), not a boolean `think` param
- **Model ID mapping:** frontend `"gemma4:e2b"` matches Ollama model name directly
- **Runtime status granularity:** `unloaded` (downloaded, not in RAM) still allows chat — Ollama auto-loads on demand

## Windows installer distribution and release behavior

- The current app version is synchronized to **0.1.8** across `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, and the frontend fallback version.
- The Windows release workflow runs on `main`, builds a Windows x64 NSIS installer, runs Rust tests, validates that the installer filename matches the app version, and publishes the `.exe` plus `SHA256SUMS.txt` to GitHub Releases when that version does not already have a release.
- The first release is intentionally an **unsigned development build**. Windows SmartScreen may warn; the workflow does not claim the checksum is a digital signature and does not configure automatic installer execution.
- Future releases require synchronized version metadata to be bumped before the corresponding changes are merged to `main`. The workflow does not overwrite an existing release with the same version.
- Ollama and local model files are not bundled with the installer.

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


## Repair increment — Version Center / Manual Updater (PRD Phase 7)

- The latest GitHub Release tag is parsed as a semantic version and compared numerically with the installed version. A lower or equal latest version is not advertised as an update, and malformed tags fail closed with a visible error.
- Release assets must have the approved AzaleaHouse_<version>_*.exe naming form, match the exact release tag in the download URL, have a nonzero metadata size no larger than 2 GiB, and come from the fixed project release path.
- Downloads are single-flight. Each attempt owns a cancellation channel, so cancelling during the HTTP request or waiting for streamed data does not depend on another network chunk arriving, and a subsequent download cannot reset an earlier attempt's cancellation flag.
- The completed temporary file must match Content-Length when provided, be nonempty, and pass a lightweight Windows PE-header check before being renamed to its final cache name. This catches common HTML/error payloads; it is not cryptographic authenticity verification.
- Frontend update operations retain backend error text rather than silently converting all failures to generic null results. Download progress is reset for each attempt and the Version Center no longer shows a static Live label.
- The app still never runs the downloaded installer. Official Tauri updater integration and cryptographic signature verification remain blocked until the owner generates and securely stores the private signing key, configures the public verification key, and publishes signed release artifacts.
- Version metadata is synchronized to 0.1.4 on this branch only. No tag, GitHub Release, installer upload, or production update is created.


## Local Ollama Model Manager — development increment 0.1.5

- Chat inference already uses the local Ollama `/api/chat` endpoint; model files themselves are not included in the AzaleaHouse installer. The previous model chooser was static UI metadata and did not reflect all models installed in the user's Ollama store.
- The AI Lokal view obtains the installed model list from Ollama `/api/tags`; refreshing the view makes models installed independently through Ollama visible to AzaleaHouse.
- A user can explicitly enter an Ollama model reference and start a pull via the local runtime `/api/pull`; progress fields come from Ollama events. When Ollama reports `completed` and `total`, the UI shows progress for the currently reported layer. It does not fabricate an overall download percentage where the runtime does not provide one.
- The chat header and Default AI settings use the discovered local model list. A saved model preference is no longer silently overwritten just because it is not the old hardcoded default.
- Loading a model into RAM is separate from downloading it. Ollama does not expose a reliable percentage for the full model-preload operation through the existing status API, so the chat displays an indeterminate status while loading rather than an invented percent-to-ready estimate.
- The model manager is a local-runtime interface, not a skill/plugin execution system. Tools/skills are orchestration modules and are not assumed to directly increase token generation speed.
- Version 0.1.5 on the repair branch is source/configuration metadata only until merged and a successful Windows Release workflow publishes the versioned installer.


## Updater argument-casing repair — v0.1.6

- Fixed the manual updater invocation to send the camelCase keys assetUrl and assetName to Tauri v2's command bridge. The Rust command parameters remain asset_url and asset_name; Tauri's default command argument mapping is camelCase on the JavaScript side.
- The reported error "invalid args assetUrl ... missing required key assetUrl" happened because the frontend sent snake_case keys. The command bridge expects the camelCase keys for these arguments.
- All synchronized version metadata is bumped to 0.1.6 so the next successful Windows release workflow produces a new installable version with the fix. No release is created from this repair branch.


## Hardware-aware Ollama Model Advisor — v0.1.7 development increment

- Added a local Windows hardware scan for CPU name/core counts, total/available RAM, video adapters and reported VRAM (when the data source can provide it), operating-system name, and free space on the system drive.
- The scan uses a fixed read-only Windows CIM/PowerShell query with no user-provided shell input. The result stays on the device and is never uploaded by this feature.
- Added a curated catalog of common Ollama model tags, with rough size/RAM/disk estimates and purpose categories. The advisor sorts models into green (recommended), yellow (likely to run slower), and red (hardware/disk budget below minimum estimate); the strongest compatible candidate is shown in a separate top recommendation card.
- The advisor estimates compatibility; it cannot guarantee tokens-per-second or exact memory usage because model quantization, context size, runtime version, and GPU support change real requirements. If Windows does not report GPU VRAM accurately, the UI says so rather than inventing the value.
- Red/unfit catalog downloads are disabled; a locally installed model may still be selected manually, because estimates should not destructively prevent user control.
- The updater now declares Tauri's camelCase argument naming explicitly for `download_update`, matching the frontend's `assetUrl` and `assetName` payload. The installed v0.1.5 updater cannot fix itself while its own download command is broken; bootstrap to the fixed v0.1.6-or-newer installer must be done manually once.
- Metadata on this branch is synchronized to 0.1.7. No tag or release is created from the PR branch; the main-branch Windows Release workflow publishes the installer after merge and successful build/tests.


## v0.1.8 — appearance, Ollama inventory, and updater transport reliability

- Added persisted dark/light appearance mode. Dark mode uses the existing sunset wallpaper; light mode uses the supplied Dreamy Balcony Over a Sea of Clouds wallpaper. Both themes override design tokens so glass panels, text, borders, and controls adapt to the selected mode.
- The blur slider maps 0% to zero blur and 100% to the strongest tokenized blur. Fixed 6px backdrop blur rules now use the shared blur token.
- Replaced the in-app flower mark with a gradient AzaleaHouse bloom mark aligned with the supplied Dreamy UI visual direction. The Windows executable/installer icon binaries were not replaced by this web-code increment.
- Removed the hardcoded Gemma 4 E2B mock catalog and default setting. Existing saved settings migrate the old Gemma 4 E2B selection to an empty model selection; the user must choose an actually installed Ollama model before chat can send.
- Added the Ollama `/api/delete` command, guarded by exact membership in `/api/tags`, plus a confirmation-first Uninstall action for installed models. AI Lokal filters include all models, installed models, and models not downloaded from the curated catalogue. Uninstalling the active selected model releases it from RAM first when its runtime status is ready.
- Hardened manual update downloads: retry the official release URL, then fall back to the GitHub Releases API asset endpoint for the exact installer name and parsed release tag. The response must still come from a GitHub-owned host, fit the size limit, and pass PE validation. Failure messages include attempt details if both official paths fail.
- Version metadata on the branch is synchronized to 0.1.8. Merge and successful Windows release CI are required before the v0.1.8 installer is published.
