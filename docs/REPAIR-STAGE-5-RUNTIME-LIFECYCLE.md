# Repair Phase 5 — Runtime Lifecycle & Keep-Alive

**Status:** Implementation prepared; current-head Windows CI validation pending.
**Branch:** `fix/phase-5-runtime-lifecycle`

## Scope

Prevent automatic or manual model unloading while a chat is starting or streaming, measure the one-hour idle interval from a recent activity timestamp, and serialize model load/unload operations against starting a new chat.

## Changes

- Initialize the idle clock at application startup instead of `0`, which made a model already loaded at launch appear to have been idle for an hour.
- Refresh the activity clock when a model is detected as loaded, when a user starts a request, and when streaming finishes, errors, or is cancelled.
- Run the automatic unload timer only in automatic policy, while the model is ready and the UI is idle.
- Check pending IPC and active-stream refs before automatic unloading; guard the manual action and visibly disable the button while the model is busy.
- Show `unloading` while an unload is in progress and report a readable error if it fails.
- Avoid repeated unload attempts when Ollama still briefly reports the model as ready after a successful unload.
- Add a Rust-managed lifecycle mutex shared by chat start, model load, and model unload. This prevents a new stream from starting in the middle of an unload and rejects load/unload while a stream is registered.
- Add Rust unit tests for the lifecycle guard decision.
- Keep the idle policy at one hour; manual policy does not run the automatic unload timer.

## Validation

Windows GitHub Actions must pass for the current PR head:

- `npm ci` and `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`
- `cargo test --manifest-path src-tauri/Cargo.toml`

## Manual desktop acceptance checks

1. Launch with Ollama already holding the configured model in RAM; it must remain loaded for a full hour of inactivity, not unload on the first timer tick.
2. Generate a response longer than one minute and confirm automatic unload does not run mid-stream.
3. Leave the model idle in automatic policy for over an hour; confirm it is unloaded and runtime status changes away from `ready`.
4. Select manual policy and confirm idle automatic unload never runs.
5. Attempt manual unload during an active response; the UI must disable the action, and backend IPC must reject a racing request.
6. Start a new chat as automatic/manual unload is requested; lifecycle serialization must prevent the operations from overlapping.
7. Simulate an Ollama unload failure and confirm the app reports an error, refreshes runtime status, and remains usable.

Windows GitHub Actions cannot substitute for interactive Windows/Ollama tests.

## Release rule

Keep application version `0.1.0`. Do not publish a release, tag, production installer, or version bump before the planned repair stages are complete and release is explicitly authorized.
