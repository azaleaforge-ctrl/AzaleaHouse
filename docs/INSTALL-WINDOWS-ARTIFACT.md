# Installing the current Windows development build

AzaleaHouse's GitHub **Releases** page may be empty while production releases are intentionally frozen. The Windows installer is therefore delivered as a temporary GitHub Actions artifact, not as a published release.

## Download

1. Open the repository's [Actions](https://github.com/azaleaforge-ctrl/AzaleaHouse/actions) tab.
2. Select **Windows Installer Artifact**.
3. Open the latest successful run for the `main` branch.
4. In the run's **Artifacts** section, download `AzaleaHouse-Installer-v0.1.4-Windows-x64` (the version in the name follows the source configuration).
5. Extract the downloaded ZIP. It contains the Windows setup `.exe` and `SHA256SUMS.txt`.
6. Run the setup executable. The installer uses the current-user install mode configured by the project.

If no successful run is available yet, merge the workflow that adds this build process, then open Actions again after the main-branch run completes. You can also use **Run workflow** on the Windows Installer Artifact workflow to build the current `main` branch manually.

## Important security and retention notes

- This is an **unsigned development installer**, not a production release. Windows SmartScreen or antivirus software may show a warning. Only install it if you trust the repository and have verified the source/build.
- To check the downloaded file, compare its SHA-256 with the matching entry in `SHA256SUMS.txt`. The checksum verifies file integrity against that manifest; it does not prove who signed or authored the installer.
- The artifact is retained for 14 days, after which it expires and must be rebuilt.
- The artifact is not shown on the Releases page, does not create a version tag, and does not enable automatic updates or installer execution by AzaleaHouse.
- Ollama and the required local model still need to be available separately for local AI chat to work.
