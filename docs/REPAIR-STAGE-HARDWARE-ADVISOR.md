# Repair Stage — Hardware-aware Ollama Model Advisor and updater IPC hardening

**Development version:** 0.1.7  
**Scope:** Extend the existing AI Lokal page with local hardware inspection and cautious model-fit recommendations; make the Tauri updater's argument casing explicit.

## Hardware scanner

- Reads CPU name, physical cores/logical processors, total and currently available RAM, video adapters and reported VRAM when available, system-drive free space, and Windows edition.
- Uses a fixed read-only Windows CIM/PowerShell query with no user-provided shell command. The result is returned to the local application only.
- NVIDIA VRAM can be sourced from `nvidia-smi` when installed. Windows' generic `Win32_VideoController.AdapterRAM` value can be capped or unavailable, so the UI calls out unknown VRAM instead of making up a value.
- Scan runs on demand from AI Lokal. No hardware report is uploaded.

## Model advisor UX

- A featured **Paling direkomendasikan untuk spek ini** card appears at the top after scanning.
- The curated catalog includes common model tags for general chat, coding, reasoning, and vision.
- Green = recommended by the conservative estimator; yellow = likely runnable but slower; red = detected RAM or disk is under the catalog's minimum estimate and the model should not be downloaded from this catalog.
- The catalogue is sorted green first, then yellow, then red. Users can filter by purpose.
- Red catalog downloads are disabled. Models already installed locally remain selectable because the estimate is a safety hint, not a hard technical prohibition.

## Estimation limits

Model file size is not the same as runtime RAM/VRAM use. Exact fit and speed vary with tag, quantization, context length, Ollama version, GPU offload, shared graphics memory, and other applications. Catalog size/memory figures are approximate for common quantized variants. The UI explains this limitation; it does not promise a precise tokens-per-second rate.

## Updater IPC fix

- The Rust `download_update` command explicitly declares `rename_all = "camelCase"`.
- The frontend passes `assetUrl` and `assetName`, matching Tauri v2's camelCase argument naming. This makes the contract explicit in both sides.
- An old installed app cannot patch the broken command inside itself if its own updater download call fails. An affected v0.1.5 installation needs a one-time manual update to the fixed v0.1.6 or later installer; once v0.1.7 is released, its in-app download flow is the fix being validated going forward.
- The app continues to download only after explicit user action. It does not automatically execute an unsigned installer.

## Acceptance checklist

1. On Windows with Ollama installed, scan hardware and verify CPU/RAM/disk match Windows Task Manager and File Explorer.
2. Verify available NVIDIA VRAM when `nvidia-smi` is installed, and confirm unknown/unsupported VRAM is labelled as such.
3. Verify the top recommendation is a non-red model when at least one catalog candidate meets the memory and disk estimates.
4. Verify green/yellow/red labels, purpose filtering, sorting, and disabling of red model downloads.
5. Pull a recommended model, then select it in the Chat header.
6. From a v0.1.6 app, check for v0.1.7 and download; confirm no missing `assetUrl` argument error.
7. Confirm the downloaded installer/checksum exists and no installer is launched automatically.

CI and manual Windows + Ollama acceptance must pass before calling the increment complete.
