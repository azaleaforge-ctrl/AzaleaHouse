# Install AzaleaHouse from GitHub Releases

Use the Releases page to download the installer directly. You do not need to download a source ZIP or use the Actions artifacts.

1. Open the [AzaleaHouse Releases page](https://github.com/azaleaforge-ctrl/AzaleaHouse/releases).
2. Open the newest release, for example **AzaleaHouse v0.1.4**.
3. Under **Assets**, download the Windows x64 setup file ending in `-setup.exe`.
4. Optionally download `SHA256SUMS.txt` and compare the listed checksum with the downloaded installer.
5. Run the setup file. AzaleaHouse is configured to install for the current Windows user, so it should not normally require administrator permission.

## When will a release appear?

After the release workflow is merged into `main), it builds the Windows app, runs the Rust tests, verifies the installer filename and size, and publishes a GitHub Release if the current app version does not already have one. The tag is created by the release action from that main-branch commit, so a manual tag step is not needed for the initial release or subsequent version bumps.

For a later release, update all synchronized app version metadata and merge that version bump into `main`. The workflow intentionally does not overwrite an existing release with the same version.

## Important

- The installer is an **unsigned development build**. Windows SmartScreen or antivirus software may show a warning. Only run it if you trust the repository and the downloaded file.
- The checksum verifies file integrity against the published checksum manifest; it does not prove that the installer was digitally signed by a verified publisher.
- Ollama and the local model are not bundled. Install and configure Ollama separately before expecting local AI chat to work.
- GitHub Releases are permanent release assets; the temporary Actions artifact is retained for 14 days and is only a fallback/testing output.
