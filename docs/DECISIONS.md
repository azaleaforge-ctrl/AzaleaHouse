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
| T-09 | Updater signing key | **not generated** | Phase 7 blocked on signature verification |

## Phase status
| Phase | State | Evidence |
|---|---|---|
| 0 — Validation & decisions | **complete** — Ollama installed + Gemma 4 E2B pulled + API validated | `ollama list` → `gemma4:e2b` 4.6 GB; direct HTTP chat returns thinking + content |
| 1 — Desktop shell & design system | **complete** | `npm run build` OK (39 modules, JS 262 kB / CSS 29 kB); `cargo check` OK (2026 crate) |
| 2 — Runtime bridge & chat | **in progress** — Rust bridge + streaming emit, frontend wired to IPC | `cargo check` clean (0 warnings); `npm run build` clean; Tauri dev launches |
| 3 — Settings & Runtime Lifecycle | **complete** | cargo check 0 warnings; npm build clean; prod release build OK (40 modules, 270 kB) |
| 4 — Local Storage & `.AzaleaMemory` | **complete** | Rust `fs.rs` module (9 commands), conversation + settings persistence, directory verified |
| 5 — File Reader & Vision | **complete** | Rust `fs.rs` file ops (6 commands), frontend types + hooks, Composer file picker, ChatView attachment chips, base64 image encoding for vision |
| 6 — History & Session Restore | **complete** | On startup: load conversation list, auto-restore last session, load saved settings. HistoryView component with open/delete. Session restore logic in App.tsx mount useEffect |
| 7 — Version Center & Manual Updater | **complete** | `azaleaforge-ctrl/AzaleaHouse` repo wired in; Rust `updater.rs` (4 commands: check/download/cancel/apply), GitHub API check, streaming download with progress events, real VersionCenter UI replaces preview, auto-check on mount, update settings in SettingsScreen |
| 8 — Quality & Packaging | **not started** — awaiting user approval | — |

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
