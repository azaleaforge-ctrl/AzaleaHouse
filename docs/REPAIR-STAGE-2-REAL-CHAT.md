# Repair Stage 2 — Real Chat Only

**Date:** 2026-10-30  
**Branch:** `fix/phase-2-real-chat-only`  
**Status:** Implementation drafted; build/runtime validation still pending.

This is Repair Stage 2 in the post-audit repair roadmap. It is not a renumbering of the product-development phases in `AzaleaHouse-PRD.md`.

## Scope

Remove demo conversations and fake model replies so that AzaleaHouse never presents static example text as though it came from a running local model.

## Changes in this branch

- Chat starts with an empty transcript; existing saved conversations are still restored by the persistence layer.
- Deleted the embedded `mockConversation` and `mockReplies` arrays.
- Removed the fake `fallbackMock` path from send and regenerate flows.
- Send is accepted only when the selected local runtime/model status is `ready` or `unloaded` (Ollama can load an unloaded model on demand).
- When the runtime is not ready, display a clear error banner and preserve the unsent draft.
- If the backend cannot start a stream, remove the empty assistant placeholder, report a visible error, and refresh runtime status rather than returning demo text.
- Stream errors are shown as errors; empty assistant placeholders are removed instead of turning the backend error string into a fake assistant answer. Partial model output, if any, remains visible alongside an error banner.
- Regeneration requires a usable local runtime and no longer substitutes a static response.
- Raw model thinking traces are not rendered or persisted in the transcript. The Thinking control can still influence model generation; the UI and stored conversation keep the user-facing answer only.
- Removed the preview-only `Model Mini` / `mini-preview` choice and sanitizes saved settings that still refer to it back to the default Gemma 4 E2B option.
- Removed the mock-only thinking indicator state and updated the chat header to display local runtime status instead of "Pratinjau".

## Manual validation checklist

These checks are the intended acceptance path on Windows with the project dependencies installed:

1. Open a fresh install with no saved history: the chat is empty and no demo transcript appears.
2. Stop or close Ollama and send a draft: an error explains that the local runtime is unavailable; the draft is preserved and no assistant answer is fabricated.
3. Start Ollama and ensure `gemma4:e2b` is available: a sent prompt is routed through `chat_start` and the UI shows the real stream.
4. Simulate a failed `chat_start`/stream: an error is shown, not a mock reply.
5. Regenerate with the runtime unavailable: the UI reports the failure and does not substitute another text.
6. Restore a saved conversation: the existing saved messages still load and legacy `thinking` fields are ignored.
7. Enable Thinking: verify the response renders only user-facing content, without a raw chain-of-thought panel.
8. TypeScript + Vite build: `npm run build`.
9. Rust validation: `cargo check`; run Rust tests after the full checkout is available.

## Validation result

- Static source review: performed.
- Build and Rust test commands: **not run** in this audit environment. The earlier baseline audit recorded a failed GitHub clone due to DNS/network access, missing project dependencies, and no Rust/Cargo toolchain there.
- The checks above are not claimed to have passed.
- No version, release tag, installer, or GitHub Release was created.

## Known follow-up

Conversation persistence/active-session identity has an independently recorded closure issue from the baseline audit; it is not fixed here to keep this repair scope limited. The signed updater work remains separate in PR #2 and is still a draft.
