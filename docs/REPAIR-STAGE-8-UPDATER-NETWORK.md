# Repair Stage 8 — Manual Updater Network Timeout

**Source version:** 0.2.1  
**Branch:** fix/updater-zero-timeout  
**Scope:** Correct the manual download client's timeout configuration and improve Windows network compatibility without changing the manual-install security boundary.

## Root cause

The download client called `reqwest::ClientBuilder::timeout(Duration::from_secs(0))`. In Reqwest's async client, `timeout` sets a total request deadline; zero is not the documented way to disable it. The intended behavior is no total download deadline, with an idle-read timeout to detect a stalled connection. This explains why both direct GitHub release attempts and the API fallback reported `TimedOut`.

## Changes

- Remove the zero-duration total request timeout. Leave the total download duration unlimited, as intended by Repair Stage 7.
- Keep a 30-second connection-establishment limit and use a 120-second idle-read limit for the streamed installer.
- Increase the release metadata check timeout to 30 seconds.
- Replace verbose timeout debug output with a concise Indonesian explanation that identifies connection, DNS, firewall, or proxy checks.
- Add a regression test that serves a response after a delay, proving that the updater client does not abort at the start of the request.

## Security boundary

The updater still accepts only installer URLs from the fixed official AzaleaHouse GitHub repository, validates the release tag and asset name, checks the file size and PE header, and requires the user to press the install button. No third-party mirror, automatic install, or signature-verification bypass is introduced.

## Validation

The PR must pass Windows CI:
1. Frontend typecheck and build.
2. Rust all-target compile check.
3. Rust tests, including the delayed-response regression test.

Manual acceptance after building the installer:
1. Check for the next release from an installed v0.2.1 build.
2. Download the official release asset and confirm the progress indicator completes.
3. Confirm an invalid/partial response is still rejected.
4. Confirm installation only begins after pressing **Pasang & Tutup Aplikasi**.
