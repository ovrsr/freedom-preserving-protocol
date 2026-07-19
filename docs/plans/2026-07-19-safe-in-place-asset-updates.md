# Safe In-Place Asset Updates

**Status:** VERIFIED
**Created:** 2026-07-19
**Scope:** Make PR #8's updater preserve all non-owned destination files, restore reliable clean-install CI, and document the resulting ownership and rollback behavior. Out: changing release publishing, adoption/revocation semantics, or existing host hook configuration.

## Summary

PR #8 adds an in-place updater that stages canonical assets before replacing existing installations. Its current `rsync --delete` and `rm -rf` fallback can delete files not present in the staged package, including operator-created state in an asset directory; this contradicts the runbook's state-preservation guarantee.

The updater will become ownership-aware: it will record the files it owns after an update, copy staged files without sweeping unrelated destination content, and remove only files recorded as owned by a prior updater manifest. A first update of a legacy target will remain additive because no reliable ownership record exists yet.

The plan also fixes the CI path that fails resolving `@ovrsr/fpp-tool-proxy` after the nested plugin installs, and adds clean-install coverage for that sequence.

## Architecture Notes

- `scripts/update-installed-assets.sh` is the public CLI. It stages the skill and packed packages, backs up targets, then currently delegates replacement to `sync_trees`.
- Each destination will contain an updater-owned manifest that lists only relative files supplied by the staged artifact. The manifest is updated only after a successful sync.
- On later updates, files in the previous manifest but absent from the new staged manifest are stale owned files and may be removed. Files not listed in the manifest are never deleted by the updater.
- The backup remains a full pre-update copy. `--dry-run` reports planned owned-file removals and makes no destination changes.
- Root `npm ci` already installs all declared workspaces. The CI install sequence must be made reproducible without nested install steps invalidating workspace links.

## Feature Inventory

| Existing surface | Current behavior | Planned task |
|---|---|---|
| `scripts/update-installed-assets.sh:sync_trees` | Deletes the complete destination using `rsync --delete` or `rm -rf`. | Task 2 |
| `scripts/update-installed-assets.sh:backup_dir` | Backs up an existing target before sync. | Task 2 (retain and validate) |
| `scripts/update-installed-assets.sh:sync_dir` | Coordinates a target update but has no ownership model. | Task 2 |
| `.github/workflows/ci.yml` root and nested `npm ci` steps | Nested installs precede the typecheck failure in CI. | Task 4 |

## Progress Tracking

- [x] Task 1: Define ownership-manifest behavior with failing updater tests
- [x] Task 2: Implement non-destructive owned-file synchronization
- [x] Task 3: Update operator and maintainer documentation
- [x] Task 4: Repair and validate clean-install CI dependency setup

**Total Tasks:** 4 | **Completed:** 4 | **Remaining:** 0

## Implementation Tasks

### Task 1: Define ownership-manifest behavior with failing updater tests

**Objective:** Establish executable safety requirements for a target containing both updater-owned files and operator-local state.

**Files:**
- Create: `scripts/update-installed-assets.test.ts`
- Modify: `package.json` (only if the existing `test:scripts` glob cannot execute the new test)
- Test: `scripts/update-installed-assets.test.ts`

**Steps:**
1. Write failing tests that run the updater against temporary staged/target fixtures without invoking a real package install.
2. Seed a target with `SOUL.md`, `MEMORY.md`, audit/trust state, and an arbitrary unowned file; verify all remain after a non-dry-run update.
3. Seed a prior ownership manifest with one stale owned file; verify that only the stale owned file is removed and the full backup contains the pre-update target.
4. Verify dry-run reports planned owned-file removals without changing the target or manifest.
5. Run the new test and confirm it fails because the current whole-tree replacement deletes unowned files.

**Definition of Done:**
- [x] Target tests fail before implementation for the intended safety reason
- [x] Fixture tests cover rsync and fallback-compatible behavior
- [x] No new type errors
- [x] No new linter errors

### Task 2: Implement non-destructive owned-file synchronization

**Objective:** Replace whole-tree deletion with manifest-based ownership tracking while keeping source staging, target backups, and normal updates intact.

**Files:**
- Modify: `scripts/update-installed-assets.sh`
- Test: `scripts/update-installed-assets.test.ts`

**Steps:**
1. Implement a stable per-target ownership manifest format containing only normalized relative paths delivered by the staged asset.
2. Change sync behavior to copy staged files into the destination without deleting unrelated files.
3. Before copying, compare the prior manifest to the staged inventory and remove only paths previously recorded as updater-owned but no longer staged; reject unsafe manifest paths that escape the target.
4. Preserve the existing full backup-before-write behavior; include the ownership manifest in the backup.
5. Make `--dry-run` enumerate planned copy/removal operations without writing target files or a new manifest.
6. Implement matching semantics for environments with and without `rsync`; do not retain a `rm -rf "$dest"` replacement path.
7. Run the updater regression test, `bash -n scripts/update-installed-assets.sh`, and the targeted script-test suite.

**Definition of Done:**
- [x] All Task 1 tests pass
- [x] Unowned destination files are preserved
- [x] Only previously owned stale files are removed
- [x] No new type errors
- [x] No new linter errors

### Task 3: Update operator and maintainer documentation

**Objective:** State the ownership semantics, first-update behavior, backup content, and limitations accurately.

**Files:**
- Modify: `docs/runbooks/in-place-updates.md`
- Modify: `docs/MAINTAINER_UPDATE_GUIDELINES.md`
- Modify: `README.md`
- Test: `scripts/update-installed-assets.test.ts`

**Steps:**
1. Document that first-time updates to legacy directories are additive because there is no prior ownership manifest.
2. Document that subsequent updates remove only stale files listed in the updater-owned manifest, while all other files remain untouched.
3. Describe the manifest location, dry-run output, full backup behavior, and rollback procedure.
4. Keep the protected-state promise, now backed by the ownership behavior and regression test.
5. Verify every command and path in the runbook against the implemented CLI and existing repository scripts.

**Definition of Done:**
- [x] Documentation matches actual updater behavior
- [x] State-preservation and stale-owned-file semantics are explicit
- [x] Dependent README links remain valid

### Task 4: Repair and validate clean-install CI dependency setup

**Objective:** Ensure the CI workflow retains workspace links required by adapter typechecking after dependency installation.

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json` (only if a dedicated clean-install verification command is needed)
- Test: `.github/workflows/ci.yml` clean-install verification path

**Steps:**
1. Reproduce the CI sequence in an isolated clean dependency tree: root `npm ci`, the current nested plugin installs, core build, and adapter typecheck.
2. Identify whether a nested `npm ci` prunes or replaces the root workspace links; inspect the resulting `node_modules/@ovrsr/fpp-tool-proxy` link and adapter resolution.
3. Write the minimal failing reproduction or CI assertion that detects the missing workspace dependency.
4. Modify the workflow to use a dependency-install order that retains all workspace links, while preserving plugin-specific dependencies required by their tests.
5. Re-run the clean-install reproduction, `npm run typecheck`, and the full verification gate from that clean state.

**Definition of Done:**
- [x] Clean-install reproduction passes
- [x] `@ovrsr/fpp-tool-proxy` resolves from every adapter workspace
- [x] `npm run typecheck` passes in the CI-equivalent environment
- [x] CI workflow change is minimal and documented if non-obvious

## Testing Strategy

1. Use temporary directory fixtures and mocked staging/packing commands to test the updater without modifying real installs.
2. Confirm RED before Task 2: current replacement behavior must demonstrably remove a seeded unowned file.
3. Confirm GREEN after Task 2: state files, unknown unowned files, backups, stale owned-file cleanup, manifest-path validation, and dry-run behavior.
4. Run `bash -n scripts/update-installed-assets.sh`, focused script tests, `npm run typecheck`, and a CI-equivalent clean-install `npm run verify:all`.

## Risks & Mitigations

- **Legacy targets lack an ownership manifest:** Treat the first update as additive; do not infer ownership from arbitrary files.
- **Manifest path traversal:** Normalize and validate every entry, rejecting absolute paths and `..` segments before removal.
- **Partial update failure:** Preserve the full backup and write the replacement manifest only after all file operations succeed.
- **Stale package files:** Remove them only when a prior manifest establishes updater ownership; expose the plan in dry-run output.
- **Nested npm installs:** Validate under a fresh dependency tree, not a developer machine with pre-existing workspace links.
