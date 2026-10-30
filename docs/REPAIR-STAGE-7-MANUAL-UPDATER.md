# Repair Stage 4 — Version Center & Manual Updater Reliability

**Development version:** 0.1.4 (source/configuration metadata only)  
**Branch:** feat/updater-reliability-v0.1.4  
**Scope:** Harden the existing metadata-check and manual-download path without enabling installer execution.

## Changes

- Compare the installed version and latest GitHub release using semantic version ordering. Lower/equal releases are not offered as updates; malformed tags fail closed.
- Only show installer assets whose filename version matches the release tag, whose URL is in the configured repository's release-download path and has the same tag, and whose declared size is nonzero and at most 2 GiB.
- Permit only one active download. Use a per-attempt cancellation channel so cancellation can interrupt the initial HTTP request or a stalled body stream, and a later request cannot reset cancellation on an older download.
- Keep the overall download duration unbounded, while imposing a 60-second idle read timeout so a dead connection can fail and be retried.
- Keep writing to a temporary .part file; validate nonempty size, Content-Length when available, and a lightweight PE header before moving it to the final cache filename.
- Preserve backend error details in the Version Center, reset progress for each new attempt, and replace the misleading static Live label with Manual.

## Security boundary

The PE-header check only detects common invalid payloads such as an HTML error page. It does NOT prove who built the installer or whether it is trustworthy. The downloaded installer is not launched by AzaleaHouse. The official Tauri updater and signature verification remain blocked until the private key is generated and held locally by the owner, the public verification key is configured, and signed release artifacts/metadata are published.

Never commit or paste the private signing key. No release tag, GitHub Release, installer upload, automatic install, or production update is created by this repair.

## Validation

CI must pass against this PR head: npm install/build, Rust check, and Rust tests. Manual Windows acceptance must still cover:
1. no release available / GitHub API 403 / malformed tag / lower and higher versions;
2. mismatched asset filename/tag/size rejection;
3. cancellation while waiting for HTTP headers and while a stream is idle;
4. invalid EXE payload rejection;
5. successful download of a real signed release asset, with no installer execution;
6. progress speed/byte count and retry after failure.
