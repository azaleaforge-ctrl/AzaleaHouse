# Repair Stage 3 — Streaming, Timeouts & Cancellation

**Date:** 2026-10-30  
**Branch:** `fix/phase-3-stream-timeouts-cancellation`  
**Status:** Implementation prepared; Windows CI validation pending.

## Scope

Prevent valid local-model responses from being cut off after five seconds, allow cancellation during both request setup and body streaming, and ensure active-stream bookkeeping is cleaned up.

## Changes

- Split short metadata request timeouts from streaming and model-load/unload operations.
- Keep a 5-second connect timeout for Ollama requests.
- Use a 10-minute read-idle timeout for streamed chat responses instead of a five-second total request deadline. A long response can continue while Ollama keeps sending data.
- Use a longer read-idle timeout for model load/unload calls.
- Share the active-stream registry with workers so each worker removes its stream ID after normal completion, cancellation, incomplete EOF, or request/stream error.
- Race cancellation against the initial `/api/chat` request as well as subsequent stream reads, so cancelling during model loading or waiting for response headers is handled.
- Emit the `chat_started` event before spawning the worker to reduce event-order races where an early error could arrive before the frontend has set its active stream ID.
- Return a clear `ERR_STREAM_INCOMPLETE` error if the HTTP stream ends without Ollama's normal `done` marker and without cancellation or an earlier stream error.
- Add unit tests for SSE data parsing and partial-line buffering.

## Validation plan

The branch uses the repository's Windows GitHub Actions workflow:

- `npm ci` and `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`
- `cargo test --manifest-path src-tauri/Cargo.toml`

These results must be checked for the current branch head before merging. The workflow does not create installers or releases.

## Manual runtime acceptance checks

1. Ask a prompt which takes more than five seconds to complete; the response must continue streaming.
2. Cancel immediately after sending, while the model is still preparing; the UI must return to idle and the active stream must be removed.
3. Cancel after chunks have appeared; already generated user-facing text stays visible, and future chunks are ignored.
4. Stop Ollama mid-response; the UI must show a readable error, not a fabricated answer.
5. Confirm stream completion/error/cancellation does not leave stale active-stream entries.
6. Exercise a request with an unsupported Thinking option; the error must remain visible and the chat must recover to idle.
7. Repeat streaming requests; each new response must still work after prior success, error, or cancellation.

## Validation result

- Static source review: performed.
- Windows CI: to be recorded after the current head's run completes.
- Interactive runtime checks against Ollama: require a Windows desktop runtime and a running local Ollama instance; these are not simulated by the source edits alone.
- No GitHub Release, tag, installer upload, or version change was created.

## Release rule

The app version remains `0.1.0` during development. Do not publish `0.1.1` or any production installer until the planned repairs are complete and the owner explicitly authorizes the release.
