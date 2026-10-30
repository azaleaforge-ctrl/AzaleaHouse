# AzaleaHouse — Phase 0 Baseline Audit

**Audit date:** 2026-10-30  
**Scope:** Read-only baseline check before the repair phases  
**Repository:** `azaleaforge-ctrl/AzaleaHouse`  
**Branch inspected:** `main`  
**Baseline commit:** `e6a4652fe76377c5b14064a905ef3ead2445cdb7`  
**Result:** Static baseline recorded; executable build validation is **blocked / not run** in the available audit environment.

## 1. Scope and safety

This phase only records the repository state and validation gaps. It does not fix application code, change the product requirements, create a production release, or publish an installer.

The current repository was inspected through GitHub's repository APIs. A local shallow clone was also attempted, but the environment could not resolve `github.com` (`Could not resolve host: github.com`). Therefore, no claim is made that the source has passed a fresh local build or runtime test.

## 2. Repository snapshot

| Check | Observation | Result |
|---|---|---|
| Default branch | `main` | Recorded |
| Baseline commit | `e6a4652fe76377c5b14064a905ef3ead2445cdb7` | Recorded |
| Latest commit message | `docs: Phase 8 complete in DECISIONS.md` | Recorded |
| Published GitHub Releases | No releases returned by the Releases API at audit time | No production release found |
| Commit status checks | No status checks returned for the baseline commit | No CI evidence |
| Workflow runs | No workflow runs returned for the baseline commit | No CI evidence |
| `.github/workflows/` | Not present in the inspected repository tree | No workflow definitions found |
| Test directories/files | No conventional test/spec directory found in the inspected tree | Test coverage not evidenced |
| npm test script | Not defined in `package.json` | No standard npm test command |
| README | No README file found in the inspected tree | Documentation entry point missing |
| Project planning docs | `docs/DECISIONS.md` is present; separate Architecture, Frontend, Backend, Roadmap, and Agent Instructions docs were not found in the inspected tree | Documentation gap |

**Interpretation:** this snapshot provides no repository-level CI result that can serve as a release gate. Absence of a workflow or status check is not proof that nobody has ever run tests manually; it means the repository does not provide a reproducible automated result for this commit.

## 3. Static configuration checks

| Check | Observation | Result |
|---|---|---|
| npm package name/version | `azaleahouse@0.1.0` | Consistent with lock root |
| `package.json` vs `package-lock.json` root metadata | Name, version, root dependencies, and root devDependencies match | Pass |
| Tauri product version | `0.1.0` | Matches npm and Cargo package version |
| Rust package version | `0.1.0` | Matches npm and Tauri config |
| Tauri product identity | `AzaleaHouse`, identifier `com.azaleahouse.desktop` | Recorded; identifier is still marked provisional in DECISIONS |
| Frontend build script | `npm run build` runs `tsc --noEmit && vite build` | Defined, not executed |
| Desktop packaging script | `npm run tauri:build` runs `tauri build` | Defined, not executed |
| Installer target | NSIS, current-user installation | Configured, not validated by building or installing |
| Release automation | No workflow definition found | No automatic release workflow visible in this snapshot |

The static package-lock check was performed by parsing both JSON files and comparing their root package metadata and dependency declarations. It does not verify that every dependency can be installed or that the application compiles.

## 4. Executable validation status

| Validation | Status | Reason / evidence |
|---|---|---|
| `npm run build` | **Not run** | Repository clone failed because DNS/network access to GitHub was unavailable; repository files and dependencies were not present locally |
| `cargo check` | **Not run** | Rust/Cargo is not installed in the audit environment |
| `npm run tauri:build` | **Not run** | Requires a local checkout, dependencies, and Rust/Tauri build toolchain |
| Windows installer launch/install/uninstall | **Not run** | No installer artifact was built or downloaded for this audit |
| Ollama startup/model/chat/streaming tests | **Not run** | No running Windows target app or Ollama instance available in the audit environment |
| Update download/signature/install flow | **Not run** | No published release was available; no updater test artifact was built |
| File/vision and DOCX/PDF integration tests | **Not run** | No executable app or test harness available |

The audit environment had Node.js `v22.16.0` and npm `10.9.2`, but no Rust/Cargo and no project `node_modules` directory. These are environment facts for this audit container, not a statement about the user's development PC.

## 5. Baseline issues to carry into later phases

These are recorded for planning, not fixed in Phase 0:

1. **No reproducible CI/test gate is present** in the inspected tree. Add automated checks only in a later scoped phase after the baseline and repair plan are accepted.
2. **Documentation set is incomplete** relative to the PRD's Definition of Done, which names Architecture, Frontend, Backend, Roadmap, and Agent Instructions in addition to the PRD.
3. **`docs/DECISIONS.md` needs reconciliation with code evidence.** It labels several phases complete, but this baseline has not re-run their executable tests, and the document itself says the updater signing key has not been generated.
4. **The Tauri CSP contains `'unsafe-eval'` and `'unsafe-inline'` for scripts.** This is recorded for a focused security review; Phase 0 does not change it.
5. **The repository version is `0.1.0`, but no GitHub Release exists at audit time.** This is acceptable during development; the updater should not be considered end-to-end validated before a separate test-release plan is approved.

## 6. Phase 0 exit criteria

- [x] Capture baseline branch and commit.
- [x] Inspect project tree, build scripts, package metadata, Tauri identity, visible tests/CI/workflows, and release state.
- [x] Verify the npm lockfile root metadata matches `package.json`.
- [x] Record environment blockers without claiming tests passed.
- [x] Keep this phase documentation-only; no application source code changed.
- [ ] Run `npm ci`, `npm run build`, `cargo check`, and `npm run tauri:build` in a connected Windows development environment.
- [ ] Run a basic smoke test with Ollama and verify the built installer.

**Phase decision:** the static baseline is recorded, but full Phase 0 validation is **partially blocked** until the build/toolchain checks can be executed in a suitable environment. Do not mark the build or runtime as passing based on repository metadata alone.

## 7. Release freeze

No GitHub Release, production installer, version tag, or release workflow was created by this audit. Keep AzaleaHouse unreleased until the repair phases, user's additional feature requests, and final release approval are complete.
