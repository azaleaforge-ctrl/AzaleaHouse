# Repair Stage 4 — Conversation Sessions & History

**Status:** Implementation complete; Windows CI passed for code commit `8c2bca13538149db3ddf1818ef28e929d14a9b1b` (frontend build, Rust compile, and Rust tests).
**Branch:** `fix/phase-4-session-persistence`

## Scope

Make local conversations persist under a stable conversation ID, restore the most recently updated conversation at startup, and keep History in sync with the files stored under `.AzaleaMemory/conversations/`.

## Changes

- Load the conversation directory only after memory-folder initialization finishes.
- Populate History at startup instead of leaving it empty until a deletion occurs.
- Keep an active-conversation ref alongside React state so long-lived event handlers do not capture the first-render `null` conversation ID.
- Autosave transcript snapshots periodically even while a long response is streaming, flush promptly when generation finishes or is cancelled, and serialize writes so an older asynchronous save cannot overwrite a newer snapshot.
- Save the current session before creating a new chat or opening another history entry.
- Prevent a restored conversation from being treated as new activity immediately on load.
- Write ISO 8601 `updated_at` timestamps so new sessions sort correctly across dates; continue displaying legacy `HH:mm` timestamps.
- Validate conversation IDs before using them as filesystem paths, with Rust unit tests for generated IDs and path-traversal rejection.
- Refresh History after a save or deletion and report persistence failures in the chat UI.

## Validation

Windows GitHub Actions must pass for the current PR head:

- `npm ci` and `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`
- `cargo test --manifest-path src-tauri/Cargo.toml`

## Manual desktop acceptance checks

1. Send a message, close and relaunch the app, and confirm the newest conversation restores.
2. Create a new chat and confirm it does not overwrite the previous conversation.
3. Switch between two history entries, send follow-up messages, and confirm each session keeps its own transcript.
4. Confirm History is populated on launch and its newest entry moves to the top after a save.
5. Delete a conversation, restart the app, and confirm the deleted session does not return.
6. Verify old saved records with legacy `HH:mm` timestamps remain readable.
7. Inspect `.AzaleaMemory/conversations/` and confirm one JSON file exists per conversation ID.

CI does not substitute for interactive Windows/Ollama checks.

## Known boundary

This phase persists the existing text transcript fields. Image payloads and attachment files are not embedded in conversation JSON; attachment persistence and reader/vision completeness require their own storage design and validation.

## Release rule

Keep application version `0.1.0`. Do not create a production release, installer, tag, or version bump until the planned repair stages are complete and release is explicitly authorized.
