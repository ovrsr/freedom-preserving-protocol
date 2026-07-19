# Live `apply_patch` Operator-Authorization Coverage

**Status:** COMPLETE
**Created:** 2026-07-18
**Depends on:** `docs/plans/2026-07-18-steward-operator-authorization.md` (COMPLETE)
**Scope:** Upstream the host-verified OpenClaw/Codex `apply_patch` descriptor fix, preserve fail-closed path containment, add an exact out-of-workspace alias map for explicitly approved harness files, synchronize the OpenClaw plugin schema, and produce release-ready package artifacts.

## Summary

A live OpenClaw gateway proved that signed steward authorization, ledger admission, scope matching, and consumption work when enforcement receives a correct `ActionDescriptor`. The repository implementation cannot currently construct that descriptor from the real Codex payload because:

1. `readPatchText()` does not inspect the live `params.command` patch envelope.
2. Absolute patch-header paths are rejected even when they are inside `workspaceRoot`.
3. OpenClaw's top-level `~/.openclaw/openclaw.json` intentionally sits outside `~/.openclaw/workspace`, so it requires an explicit exact-path mapping rather than a widened workspace boundary.
4. The Codex protocol also defines a structured `params.changes[]` representation that the extractor does not support.

The fix keeps the existing V4A flat-text parser as a compatibility path, adds the two observed payload forms, converts contained absolute paths to workspace-relative resource paths, and permits explicitly configured external files only through an exact `{ absolutePath: resourcePathAlias }` map. Any missing, malformed, duplicated, traversing, or unlisted external target remains ambiguous and cannot match an authorization.

## Confirmed Design Decisions

- Keep `resolveWorkspaceRoot({ profile: "openclaw" })` rooted at `~/.openclaw/workspace`.
- Add `outOfWorkspacePaths` as a narrow, exact per-file mapping; do not accept directories, globs, or prefix matches.
- Add `params.command` and structured `params.changes[]` handling directly in the descriptor boundary now.
- Defer capability-metadata-driven payload extraction to a separate design.
- Preserve the legacy `patch|input|diff|content|text` payload keys.
- Treat a present `changes` array as authoritative. Empty or malformed arrays fail closed instead of falling back to a second payload representation.
- Track richer abstain diagnostics separately; do not expand this security fix into disposition/audit redesign.
- Avoid top-level `await` in OpenClaw plugin entry modules.
- Require a full gateway restart after changing `openclaw.plugin.json`; hot reload does not refresh the cached manifest schema.

## Architecture Notes

Current authorization flow:

```text
OpenClaw before_tool_call
  -> createEnforcementRuntime().onBeforeToolCall()
  -> lookupStewardOperatorCoverage()
  -> buildActionDescriptor()
  -> AuthorizationService.findCandidate()
  -> disposition
  -> consumeIfValid()
```

The change remains at the descriptor/config boundary. Steward signatures, ledger semantics, authorization scope matching, hard-floor ordering, and consumption logic are unchanged.

Path handling invariants:

- Relative patch paths remain normalized workspace-relative resource paths.
- Native absolute paths are resolved with `node:path`, then accepted only when lexical `relative(workspaceRoot, target)` containment succeeds.
- String-prefix containment is forbidden because sibling prefixes such as `/wsevil` must not match `/ws`.
- An absolute path outside `workspaceRoot` is accepted only when its canonical exact path is present in `outOfWorkspacePaths`.
- Alias values are resource-path identifiers and must themselves be non-empty, relative, traversal-free, and NUL-free.
- No partial target list is returned after any malformed or unsafe target.
- Symlink-aware filesystem containment is not introduced here because add targets may not exist; this plan preserves lexical containment and documents that limit.

`outOfWorkspacePaths` changes authorization behavior and therefore must be bound into `effectiveConfigHash` using stable, sorted entries. It is not equivalent to storage-only fields such as audit-log paths. The hash may vary across hosts when their explicit path maps differ; that accurately reflects different effective authorization policy.

`implementationVersion` and `packageBuildHash` identify package metadata, not source bytes. Release verification must inspect the packed plugin's nested enforcement artifact rather than using those receipt fields alone as proof that a source patch was bundled.

## Feature Inventory

| Existing surface | Required treatment | Task |
|---|---|---|
| `readPatchText()` flat-key list | Add `command`; retain all legacy keys | 1 |
| `normalizeWorkspaceRelativePath()` | Resolve contained native absolute paths; reject escapes and unsafe aliases | 1 |
| `extractApplyPatchTargets()` | Thread optional exact external-path aliases through flat V4A parsing | 1 |
| `buildActionDescriptor()` | Prefer valid structured `changes[]`; otherwise use flat-text compatibility path | 1 |
| `FppPluginConfig` / `DEFAULT_CONFIG` / `mergeConfig()` | Add backward-compatible `outOfWorkspacePaths: {}` | 2 |
| `computeEffectiveConfigHash()` | Bind sorted external-path mappings into effective policy identity | 2 |
| `lookupStewardOperatorCoverage()` | Pass exact path mappings into descriptor construction | 2 |
| Runtime `onBeforeToolCall()` | Supply merged config to steward coverage lookup | 2 |
| Signed steward runtime/E2E fixtures | Exercise the real `command` + absolute external target shape and consumption | 2 |
| `openclaw.plugin.json` | Declare the new object field under `additionalProperties: false` | 3 |
| Plugin manifest/default drift checks | Include `outOfWorkspacePaths` | 3 |
| Enforcement-core and OpenClaw plugin package metadata | Patch bump and synchronize exact bundled dependency/lock metadata | 4 |
| Operator architecture/config/troubleshooting docs | Document payload forms, boundary model, restart requirement, and incident hazards | 5 |
| Generic abstain reason | Out of scope; retain as an explicit follow-up below | Follow-up |

This is an additive compatibility extension, not a migration. No existing payload form or public export is removed.

## Progress Tracking

- [x] Task 1: Parse live and structured patch payloads with fail-closed path normalization
- [x] Task 2: Propagate exact external-path policy through config, runtime, hashing, and signed authorization tests
- [x] Task 3: Synchronize the OpenClaw manifest schema and drift checks
- [x] Task 4: Produce versioned, bundle-verified release artifacts
- [x] Task 5: Document the authorization boundary and incident learnings

**Total Tasks:** 5 | **Completed:** 5 | **Remaining:** 0

## Implementation Tasks

### Task 1: Parse live and structured patch payloads with fail-closed path normalization

**Objective:** Build exact resource paths from the live Codex `params.command` envelope and the protocol's structured `params.changes[]` form while retaining legacy flat-text compatibility.

**Files:**
- Modify: `packages/enforcement-core/src/action-descriptor.ts`
- Test: `packages/enforcement-core/src/action-descriptor.test.ts`

**Steps:**
1. RED: add failing tests for the exact live shape (`params.command` containing a V4A envelope with an absolute target), structured multi-file `changes[]`, structured precedence over flat text, and legacy key compatibility.
2. RED: add failing containment tests using native absolute paths: inside workspace, parent escape, sibling-prefix collision, target equal to workspace root, NUL, and non-native drive/absolute forms where applicable.
3. RED: add failing external-map tests: exact mapped target succeeds with its alias; unlisted target, unsafe alias, empty/malformed/duplicate structured changes, and mixed valid/invalid targets all return `{ paths: [], ambiguous: true }`.
4. Run only `action-descriptor.test.ts` and confirm failures are caused by missing `command`, absolute-path, structured-change, and alias support.
5. GREEN: use `node:path` resolution/relative checks for lexical containment. Keep relative-path behavior and fail closed without returning partial paths.
6. GREEN: add `command` to the flat patch-text keys and an internal structured-change extractor checked before flat-text fallback when `params.changes` is an array.
7. Preserve tool-name normalization, classification propagation, legacy header parsing, and non-patch descriptor behavior.
8. Run the targeted test, enforcement-core typecheck, and enforcement-core tests.

**Definition of Done:**
- [ ] Exact live `params.command` fixture resolves the expected resource path
- [ ] Structured and legacy payload fixtures pass
- [ ] Absolute containment and prefix-collision tests pass
- [ ] Every malformed/unsafe multi-target shape fails closed without partial paths
- [ ] Enforcement-core target tests and typecheck pass
- [ ] No new linter errors (N/A unless a lint script is added; package currently has none)

### Task 2: Propagate exact external-path policy through config, runtime, hashing, and signed authorization tests

**Objective:** Make the narrow per-file map an explicit, default-empty enforcement policy field and prove that a signed grant can cover a mapped OpenClaw config path through the complete runtime/ledger/consumption flow.

**Files:**
- Modify: `packages/enforcement-core/src/config.ts`
- Modify: `packages/enforcement-core/src/runtime-manifest.ts`
- Modify: `packages/enforcement-core/src/steward-coverage.ts`
- Modify: `packages/enforcement-core/src/runtime-adapter.ts`
- Test: `packages/enforcement-core/src/config.test.ts`
- Test: `packages/enforcement-core/src/runtime-manifest.test.ts`
- Test: `packages/enforcement-core/src/steward-coverage.test.ts`
- Test: `test/steward-operator-authorization-e2e.test.ts`

**Steps:**
1. RED: add config tests proving the field defaults to `{}`, accepts an explicit exact map without mutating it, and remains independent from `knownCustomTools`.
2. RED: add runtime-manifest tests proving changing the map changes `effectiveConfigHash` and key insertion order does not.
3. RED: change/add a signed steward runtime fixture to use an authorization alias plus a live-shaped `params.command` patch targeting an absolute path outside the synthetic workspace. Assert the mapped path allows once, writes steward evidence, appends `authorization_consumed`, and replay does not allow.
4. RED: add wrong-map, missing-map, and mismatched authorization-alias cases that abstain without consuming the grant; retain the hard-floor non-bypass test.
5. Run the focused config/manifest/steward/E2E tests and confirm the expected missing-propagation failures.
6. GREEN: add `outOfWorkspacePaths: Record<string, string>` to `FppPluginConfig`, `DEFAULT_CONFIG`, and merge handling with default `{}`.
7. GREEN: hash stable sorted map entries as effective authorization policy without exposing path text in receipts.
8. GREEN: thread the map through `lookupStewardOperatorCoverage()` and `buildActionDescriptor()` from `onBeforeToolCall()`.
9. Run the focused tests, enforcement-core full tests, root steward E2E, and enforcement-core typecheck.

**Definition of Done:**
- [ ] Default config remains backward compatible
- [ ] Effective policy hash binds the exact external-path map deterministically
- [ ] Live-shaped signed authorization is consumed exactly once for the mapped alias
- [ ] Missing/mismatched mappings fail closed and leave authorization uses unconsumed
- [ ] Hard-floor behavior remains unchanged
- [ ] Enforcement-core and root steward E2E tests pass
- [ ] No new type errors
- [ ] No new linter errors (N/A unless a lint script is added)

### Task 3: Synchronize the OpenClaw manifest schema and drift checks

**Objective:** Ensure OpenClaw accepts the new config field at process startup and the repository detects future runtime/manifest default drift.

**Files:**
- Modify: `plugin/openclaw.plugin.json`
- Modify: `plugin/src/config.ts`
- Test: `plugin/src/config.test.ts`

**Steps:**
1. RED: extend manifest/default parity tests to require `outOfWorkspacePaths` with default `{}` and an object-of-string-values schema.
2. Run the focused plugin config test and confirm it fails because the manifest and parity key list lack the field.
3. GREEN: add `outOfWorkspacePaths` to `MANIFEST_DEFAULT_KEYS`.
4. GREEN: add the exact-path map schema and security-focused description under the manifest's `additionalProperties: false` config schema.
5. Confirm no wildcard, directory-prefix, or implicit `~/.openclaw` widening option is introduced.
6. Run plugin config tests, plugin typecheck, and plugin tests.

**Definition of Done:**
- [ ] OpenClaw manifest accepts only string-valued map entries
- [ ] Manifest and runtime defaults both equal `{}`
- [ ] Drift test covers the new field
- [ ] Plugin tests and typecheck pass
- [ ] No new linter errors (N/A unless a lint script is added)

### Task 4: Produce versioned, bundle-verified release artifacts

**Objective:** Make the fix release-ready and prove the enforcement plugin tarball embeds the patched enforcement-core artifact rather than relying on an edited host `node_modules`.

**Files:**
- Modify: `packages/enforcement-core/package.json` (`1.0.2` → `1.0.3`)
- Modify: `packages/enforcement-core/src/index.ts` (`PACKAGE_VERSION`)
- Modify: `plugin/package.json` (preserve the user-owned `1.1.17` change, then bump to `1.1.18`; pin enforcement-core `1.0.3`)
- Modify: `package-lock.json`
- Test: `plugin/pack-bundle.test.ts`

**Steps:**
1. RED: extend package/bundle verification to assert that the packed plugin contains `@ovrsr/fpp-enforcement-core@1.0.3` and that its built `action-descriptor.js` contains the new live payload branches.
2. Run the focused pack test against current metadata/artifacts and confirm it fails for the missing version/bundle.
3. Bump enforcement-core to `1.0.3`, synchronize its exported version constant, and bump the enforcement plugin from the current working-tree `1.1.17` to `1.1.18`.
4. Update the plugin's exact enforcement-core dependency to `1.0.3`; synchronize `package-lock.json` through the package manager rather than hand-editing lock structure.
5. Build enforcement-core before bundling the plugin, then run plugin prepack/pack verification and inspect the packed nested dependency.
6. Run enforcement-core/plugin builds, typechecks, tests, and the existing OpenClaw-style package smoke checks. Do not publish or install on a live host in this task.

**Definition of Done:**
- [ ] Core/package/export versions agree at `1.0.3`
- [ ] Plugin/package/lock versions agree at `1.1.18`
- [ ] Plugin pins and bundles enforcement-core `1.0.3`
- [ ] Packed nested `action-descriptor.js` contains the verified fix
- [ ] Build, pack verification, and install smoke pass
- [ ] No generated host-only `node_modules` edits are treated as source changes
- [ ] No new type or lint errors

### Task 5: Document the authorization boundary and incident learnings

**Objective:** Record the supported payload forms, exact-path security model, operational restart requirement, and investigation hazards without claiming unverified upstream deployment.

**Files:**
- Modify: `docs/architecture/steward-operator-authorization.md`
- Modify: `plugin/README.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `docs/CAPABILITY_STATUS.md`

**Steps:**
1. Document `command`, structured `changes[]`, and legacy flat-key compatibility plus structured precedence/fail-closed behavior.
2. Document why `workspaceRoot` remains `~/.openclaw/workspace` and how an operator explicitly maps a single top-level harness file to an authorization resource alias.
3. Add a configuration example using placeholders derived from the operator's actual host; do not hardcode the incident host's home path as a universal value.
4. Document that manifest schema changes require a full gateway restart and that top-level `await` in the current plugin loader can prevent the entire enforcement hook from registering.
5. Clarify that `packageBuildHash` is metadata-derived and packed-artifact inspection is required for source provenance.
6. Update capability status only to the behavior proven by repository tests; reserve live-deployment claims for a fresh post-release verification.
7. Record generic abstain/candidate-reason propagation as a separate follow-up, not an implemented feature.
8. Run documentation-linked commands or their safe read-only equivalents before finalizing any operator command examples.

**Definition of Done:**
- [ ] Architecture and operator docs agree on the exact path boundary
- [ ] Config example contains no unsourced host-specific resource name
- [ ] Full-restart and no-top-level-await warnings are visible
- [ ] Capability claims match test evidence
- [ ] Abstain diagnostics remain explicitly tracked and out of scope
- [ ] No broken documentation links introduced

## Testing Strategy

### RED evidence

Before each production-code change, run the smallest new test that demonstrates the missing behavior:

```bash
npx tsx --test packages/enforcement-core/src/action-descriptor.test.ts
npx tsx --test packages/enforcement-core/src/config.test.ts packages/enforcement-core/src/runtime-manifest.test.ts packages/enforcement-core/src/steward-coverage.test.ts
npx tsx --test test/steward-operator-authorization-e2e.test.ts
npx tsx --test plugin/src/config.test.ts
```

Record failures caused by the missing feature, not syntax, fixture, dependency, or path errors.

### GREEN and regression evidence

```bash
npm run typecheck -w @ovrsr/fpp-enforcement-core
npm test -w @ovrsr/fpp-enforcement-core
npx tsx --test test/steward-operator-authorization-e2e.test.ts
npm run typecheck -w @ovrsr/openclaw-fpp-plugin
npm test -w @ovrsr/openclaw-fpp-plugin
npm run build -w @ovrsr/fpp-enforcement-core
npm run build -w @ovrsr/openclaw-fpp-plugin
SKIP_ISOLATED_INSTALL=1 bash scripts/verify-pack.sh
bash scripts/smoke-plugin-install.sh plugin
```

Then run the repository-wide typecheck and test commands. A pre-existing failure must be reproduced against the unchanged baseline and reported; it cannot be counted as a pass or silently ignored.

There is currently no repository/package lint script. Record lint as N/A only after reconfirming package scripts during implementation.

### Post-release live acceptance

Publishing, live installation, gateway restart, and authorization consumption are outside `/implement` scope and require separate explicit authorization. After deployment, `/verify` should query the live plugin installation rather than assuming a path, verify the installed package versions/artifact, perform one real scoped patch, and confirm both the enforcement audit and steward ledger contain the matching successful consumption. Prior host-patch evidence is diagnostic input, not fresh verification of the upstream artifact.

## Risks & Mitigations

- **Authorization scope broadening:** Keep `workspaceRoot` unchanged; permit only exact configured absolute files and validated relative aliases.
- **Path-prefix confusion:** Use `node:path` relative containment, never `startsWith`.
- **Partial authorization of multi-file patches:** Any unsafe/malformed target clears all extracted paths and marks the descriptor ambiguous.
- **Payload ambiguity:** Structured arrays are authoritative when present; malformed arrays do not fall through to a potentially contradictory flat body.
- **Cross-platform path handling:** Test with native resolved paths and retain fail-closed treatment for foreign/unsupported absolute forms.
- **Policy provenance gap:** Bind the external map into `effectiveConfigHash` and inspect packed source artifacts; do not treat metadata-only `packageBuildHash` as a source digest.
- **Manifest/runtime drift:** Update runtime config, manifest schema, parity key list, tests, and lock metadata in the same plan.
- **Enforcement bypass during diagnostics:** Never add top-level `await` to the plugin entry; use test seams or synchronous guarded diagnostics.
- **Stale schema during hot reload:** Require a full process restart after manifest schema changes.
- **Host-only success mistaken for upstream completion:** Keep installed `node_modules` patches out of source status and require fresh repository verification.

## Out of Scope / Tracked Follow-ups

The user explicitly selected these as separate work:

1. Thread `stewardAction.candidate.reason` into abstain audit diagnostics so target ambiguity, scope mismatch, expiry, and ledger unavailability are distinguishable.
2. Evaluate harness capability metadata as the source of payload adapters instead of a core hardcoded key list.
3. Consider a first-class harness config root only if exact per-file aliases prove insufficient.
4. Change OpenClaw's plugin loader or hot-reload implementation.
5. Publish to ClawHub, install on a live gateway, or consume another live authorization.

## Handoff

Review the security boundary, task/file inventory, and release scope. After approval, run:

`/implement docs/plans/2026-07-18-apply-patch-live-coverage.md`
