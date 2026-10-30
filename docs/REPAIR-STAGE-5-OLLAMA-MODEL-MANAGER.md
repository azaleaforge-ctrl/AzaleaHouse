# Repair Stage 5 — Ollama Local Model Manager

**Development version:** 0.1.5 (source/configuration metadata only)  
**Branch:** `feat/ollama-model-manager-v0.1.5`  
**Scope:** Replace the hardcoded model chooser with live Ollama discovery and a user-triggered model pull flow.

## What this increment changes

- The chat backend already uses the user's local Ollama service for real inference. This increment changes the UI's model inventory: installed models come from Ollama's `/api/tags` rather than a one-item mock catalog.
- Add a new **AI Lokal** sidebar page listing model references present in the local Ollama store, their reported size, and basic capability hints.
- A model downloaded separately by the user through Ollama becomes visible when the list is refreshed.
- The user may enter a model reference, then explicitly start a pull through Ollama's local `/api/pull` API. No model is downloaded automatically by opening the app.
- Forward progress events from Ollama. When the runtime provides `completed` and `total`, show percentage/bytes for the currently reported layer and its status.
- Make the chat header model chip a model picker and connect Default AI settings to the discovered list. A user's saved model reference is preserved even when it is not installed; the UI can tell the user that it is missing instead of silently changing it back to the mock default.
- The model list and pull operation remain local-runtime calls to `127.0.0.1:11434`; model files remain managed by Ollama and are not copied into the AzaleaHouse installer.

## Progress semantics

There are two different operations:

1. **Downloading a model:** Ollama's pull stream can report per-layer `completed` and `total` values. The percentage shown is explicitly labelled as the progress of the current layer where those values are provided. It is not guaranteed to be the total percentage for all layers.
2. **Loading model weights into RAM for inference:** the existing Ollama status/preload API does not expose a reliable percent-complete value. AzaleaHouse therefore uses an indeterminate loading indicator instead of inventing a numeric percentage or ETA.

## Capability detection caveat

Thinking/vision badges are conservative name-based hints from the existing runtime bridge, not a guaranteed capability registry. The app sends images through the Ollama chat request where attachments contain image bytes, but the selected model must support image input for image understanding to work. Unsupported options should be disabled rather than represented as guaranteed capabilities.

## Not included in this increment

- Dark/light mode with a per-mode wallpaper, replacing the app branding using the UI showcase image, and wiring the blur slider across all CSS tokens.
- Full standalone Images view.
- AI-prompt-to-professionally-laid-out-document orchestration. The existing document studio is a Markdown-based formatter and DOCX exporter; its PDF flow relies on Windows Print to PDF.
- Skills/plugins or a tool orchestrator. Skills are not a direct inference-speed switch; speed work should first benchmark model size/quantization, prompt context, output length, and keep-alive policy.
- Automatic model downloads, bundled model weights, or changing/removing Ollama's global service.

## Validation checklist

CI must pass on the current PR head:
- `npm ci`
- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`
- `cargo test --manifest-path src-tauri/Cargo.toml`

Manual acceptance on Windows with Ollama is still required:
1. Launch with Ollama running and confirm every installed model shown by `ollama list` is shown in AI Lokal.
2. Install a model outside AzaleaHouse, refresh, and confirm it appears.
3. Enter a valid new model tag and start a pull; confirm progress/status events appear and the model shows in the list afterwards.
4. Stop/check failure handling for offline Ollama, invalid tag, insufficient disk/network failure, and a partially completed pull.
5. Select different installed models in the chat header, send a message, and confirm the request uses the selected model.
6. Confirm missing model references are explained and are not silently replaced.
7. For image attachments, test with a model known to support vision and with a text-only model; ensure UI does not claim text-only models can understand images.

## Release behavior

Version metadata on this branch is synchronized to 0.1.5. This branch does not itself create a tag or publish a Release. After the PR is reviewed and merged to `main`, the repository's Windows release workflow can build and publish `v0.1.5` if CI and the installer build pass. The installer still does not bundle Ollama or model weights.
