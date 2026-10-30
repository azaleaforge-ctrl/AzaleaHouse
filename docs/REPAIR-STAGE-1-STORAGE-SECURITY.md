# Repair Stage 1 — Storage & Filesystem Safety

**Status:** Implementation prepared on `fix/phase-1-storage-security-v0.1.1`; CI and manual Windows acceptance are pending PR validation.  
**Development version:** `0.1.1` in source/configuration only. This stage does not publish a tag, GitHub Release, or installer.

This repair stage follows the audit sequence and is distinct from PRD Phase 1 (Desktop Shell & Design System).

## Changes

- Add a fixed Windows folder-picker command. The picker issues a one-time canonical directory selection; the migration command consumes that selection and rejects a different caller-supplied destination.
- Preserve the required `.AzaleaMemory` root name by selecting its parent folder in Settings.
- Validate that the selected location exists and is a directory, reject nested/overlapping source and destination paths, reject symlinked or non-empty destination roots, and check available target space before migration.
- Back up into `.AzaleaMemory/backups/`. A backup copies the memory tree but excludes the top-level backup directory to avoid recursive backups.
- Copy the data before switching the active path, compare source and destination file manifests, keep the source tree intact, update the custom-path marker only after validation, and clean up the destination if the switch fails.
- Harden path-based file helpers with canonical-path, regular-file, extension, size, and attachment-name checks. Path-based reader/encoder/save IPC commands are deliberately not registered until the UI has a proper user-selected-file grant flow.
- Wire Settings actions to the folder picker and backup results, show success/error feedback, disable memory actions during a copy, flush the current conversation before migration/backup, and prevent session mutations while the operation is active.
- Synchronize the source version to `0.1.1` in npm metadata/lockfile, Cargo metadata/lockfile, Tauri configuration, and the frontend fallback version. The release freeze remains active.

## Automated validation

Pending. Do not interpret code review or this document as proof of a passing build. The PR must pass the Windows GitHub Actions jobs for frontend typecheck/build and Rust compilation/unit tests.

## Manual Windows acceptance checklist

- [ ] Open Settings and confirm the displayed path is the active `.AzaleaMemory` root.
- [ ] Choose an empty parent directory. Confirm data is copied into its `.AzaleaMemory` child and the active path changes only after validation.
- [ ] Confirm existing chat history and settings remain available after migration and after restarting the app.
- [ ] Attempt migration to a non-empty `.AzaleaMemory` destination, an overlapping path, and a location without enough space; confirm the active source remains unchanged and the UI reports an actionable error.
- [ ] Confirm the source data remains on disk after a successful migration.
- [ ] Create a backup. Confirm it appears below the active `.AzaleaMemory/backups/` folder and does not recursively include older backup folders.
- [ ] Attempt migration/backup while generation is active; confirm the operation is rejected rather than moving a changing conversation store.
- [ ] Confirm the path-based filesystem commands are not callable through frontend Tauri IPC until an explicit selected-file permission flow is implemented.
- [ ] Verify all version configuration files report `0.1.1`; verify no GitHub tag, release, or installer was created.

## Known limitations outside this repair stage

- Backup restore and explicit memory-delete controls are not implemented by this change.
- PDF, DOCX, and XLSX readers and the DOCX/PDF document engine remain unimplemented.
- The signed Tauri updater and Install & Restart flow remain blocked. No production release is authorized by a source-version bump.
