# Phase 1 — Updater Security Containment

**Date:** 2026-10-30  
**Branch:** `security/phase-1-updater-hardening`  
**Status:** Partial containment only. Phase 1 is **not complete**.

## Why this partial change exists

The previous custom updater downloaded an arbitrary frontend-supplied URL/name and exposed a Rust command that launched any existing path. It did not authenticate the installer with a cryptographic update signature. That made the install path unsafe to keep enabled while the official signed updater is not configured.

## Containment implemented in this branch

- Lock release metadata checks to the repository specified by the project: `azaleaforge-ctrl/AzaleaHouse`. Environment overrides no longer change the update source.
- Validate installer URLs as HTTPS download assets from the exact project's GitHub Releases path.
- Validate release tags and require a safe `AzaleaHouse_*.exe` filename with no path separators or query string.
- Reject HTTP failures and unexpected redirect hosts.
- Cap installer downloads at 2 GiB, write to a temporary `.part` file, verify nonempty/known content length, clean up failed/cancelled partial downloads, then rename after the download is complete.
- Correct the speed calculation to use bytes received since the prior sample rather than total bytes since the prior sample timer.
- Remove the `apply_update` IPC command and frontend launch path. A downloaded installer is **not run** by the application.
- Add unit tests for URL, source repository, filename, and path-traversal validation. These tests have been authored but could not be executed in this audit environment.

These checks are defense-in-depth for the temporary download path. They are **not a substitute for signature verification** and do not make a downloaded installer trusted.

## Remaining Phase 1 requirements

1. Replace the custom updater with the official Tauri updater plugin.
2. Configure signed updater artifacts, including the public verification key and the `latest.json` platform manifest.
3. Keep the private signing key outside the repository and user-facing application. It must never be committed to GitHub or pasted into chat.
4. Enable the update install/restart action only through the official signature-verifying updater path.
5. Run frontend build, Rust tests/check, Tauri build and Windows update-flow tests before considering the PR mergeable.

At audit time no GitHub Release was published, and the repository has not yet configured the updater signing key.

## Signing-key prerequisite (Windows PowerShell)

The private key needs to be generated locally so the owner retains custody. In the repository root:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.tauri" | Out-Null
npm run tauri signer generate -- -w "$env:USERPROFILE\.tauri\azaleahouse.key"
```

Keep `%USERPROFILE%\.tauri\azaleahouse.key` private and backed up safely. Do not upload or commit it. The public key printed by the command is safe to share with the project maintainer for configuration; share only that public value, never the private key or its password.

The official updater documentation explains the two-key model and signed release artifacts: https://v2.tauri.app/plugin/updater/

The current official `tauri-plugin-updater` 2.14.1 documentation requires Rust 1.90 or newer; this repository currently declares `rust-version = "1.77"`. The runtime/toolchain and manifest declaration must be aligned and verified during the official plugin integration: https://docs.rs/crate/tauri-plugin-updater/latest

## CI validation

The repository now has a Windows GitHub Actions workflow (`.github/workflows/ci.yml`) that runs `npm ci`, `npm run build`, `cargo check --all-targets`, and `cargo test` on pull requests. This PR should be kept open until the current head's frontend and Rust jobs complete successfully. Any formatter-only failure from the earlier draft workflow is not treated as a code-build failure; CI is now aligned to the canonical workflow on `main`.

## Validation outcome

- Static review of the changed source and UI: performed.
- Automated build/test: **not run** because the connected audit environment cannot clone GitHub and does not have the project toolchain/dependencies installed.
- Release, tag, installer, or auto-install workflow: none created.
- Current behavior is intentionally restrictive: users can check release metadata and download allow-listed installers, but the app does not execute them until signature verification is implemented.
