# Repair Stage 3 — Streaming, Timeouts & Cancellation

**Date:** 2026-10-30  
**Branch:** `fix/phase-3-stream-timeouts-cancellation`  
**Status:** Merged after Windows CI passed; manual Ollama runtime checks remain unverified.

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
- Windows CI: passed for PR #5 head `368b8a2619c0ac246f7527b48efc0a07e2de1d2a` (frontend build, Rust compile, Rust tests).
- Interactive runtime checks against Ollama: require a Windows desktop runtime and a running local Ollama instance; these are not simulated by the source edits alone.
- No GitHub Release, tag, installer upload, or version change was created.

## Release rule

The app version remains `0.1.0` during development. Do not publish `0.1.1` or any production installer until the planned repairs are complete and the owner explicitly authorizes the release.

## Follow-up — replies stopped by the output-token limit

**Implementation branch:** \`fix/ollama-response-completion\`  
**Validation:** pending CI and manual Windows/Ollama acceptance; no release is created by this change.

Source review found that the previous default output budget was 512 tokens, and the stream handler treated every valid \`done: true\` record as a normal completion even when Ollama reported \`done_reason: "length"\`. That made an answer stopped by the output limit look like a fully completed response.

The follow-up change:
- raises the default output budget to 2,048 tokens and migrates the previous saved default of 512 to 2,048; users can still lower it manually;
- increases the output options and profile presets in Settings;
- when the Ollama stream ends with \`done_reason: "length"\`, asks the same local model to continue from the partial answer without repeating it, up to three additional generation segments;
- emits normal completion statistics only after the overall response finishes;
- surfaces \`ERR_OUTPUT_LIMIT\` when the safety bound is reached, preserving the partial text instead of falsely claiming the answer completed;
- adds unit coverage for length-reason continuation decisions.

The continuation remains local: each request is sent to the existing loopback Ollama API. This is a bounded recovery mechanism, not a guarantee that every model can complete arbitrarily long answers. Manual tests must still check long answers, cancellation during a continuation, runtime interruption, and models whose context limit is reached.
