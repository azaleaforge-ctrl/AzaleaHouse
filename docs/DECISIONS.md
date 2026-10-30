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
| 5 — File reader & vision | **Partial** | Text/code extraction and an image request path exist. PDF, DOCX, and XLSX parsers are not implemented; image/runtime acceptance remains pending. Native path-based file commands are deliberately not registered until a selected-file grant flow is wired. |
| 6 — Document engine | **Not implemented** | Documents view still displays a “coming soon” screen; DOCX/PDF generation and render validation are outstanding. |
| 7 — Version Center & manual updater | **Partial / blocked** | GitHub metadata check and manual download code exist, but the official signed Tauri updater, signature verification, and Install & Restart are not configured. No GitHub Release is currently published. |
| 8 — Quality & packaging | **CI infrastructure present; release acceptance pending** | Windows CI checks frontend build and Rust compile/tests. Installer installation/uninstallation, interactive desktop behavior, and end-to-end update tests still need direct acceptance. |

## Phase 2 technical notes
- **Rust deps added:** `tokio` (macros, net, rt, sync, time), `reqwest` (rustls-tls, stream, json, gzip), `futures-util`
- **Backend commands:** `runtime_status`, `list_models`, `chat_start`, `chat_cancel`, `load_model` — all via `tauri::command`, no shell/exec
- **Event protocol (SSE over HTTP → Tauri emit):** `azalea:chat_started`, `azalea:chat_chunk`, `azalea:chat_error`, `azalea:chat_done`
- **Gemma 4 thinking:** controlled via `<|think|>` system token (per Ollama docs), not a boolean `think` param
- **Model ID mapping:** frontend `"gemma4:e2b"` matches Ollama model name directly
- **Runtime status granularity:** `unloaded` (downloaded, not in RAM) still allows chat — Ollama auto-loads on demand

## Non-negotiables already encoded in the shell
- No shell/exec command is exposed to the frontend; the only external process probe is `where ollama` (path detection only, no execution).
- Version Center in Phase 1 is preview-only: no network call, no download, no install.
- UI version is read from `tauri.conf.json` via `app_version`, so installer and UI cannot drift.
- Thinking controlled via `<|think|>` system token (Ollama), not a boolean `think` parameter.
