# Engineering Assurance Foundation

**Status:** COMPLETE
**Created:** 2026-07-10
**Scope:** In: CI, deterministic local verification, broader baseline tests, coverage reporting, fail-hard publishing, runtime pinning, package/SBOM checks. Out: protocol-v2 semantics, security-default changes, conformance receipts, governance mechanisms, and signed release attestations.

## Summary

Establish automated quality gates before large protocol changes. The repository currently has four test files, no tracked CI workflow, no root command that verifies all three packages, and publishing paths that either skip trust tests or treat enforcement test failures as warnings.

This is Plan 2 of 7. Implement after the immediate documentation reconciliation and before protocol-core or behavior changes.

## Architecture Notes

- Root scripts exercise the skill and operational utilities.
- `plugin/` and `plugin-trust/` are separate TypeScript packages with their own lockfiles and test commands.
- OpenClaw plugin dependencies are installed with `--ignore-scripts`; package outputs must already contain built JavaScript.
- The installed SDK exposes `before_tool_call` and `after_tool_call`, including `toolCallId`, `runId`, `agentId`, and `sessionKey` for later receipt correlation.
- `.github/` is currently ignored, so CI cannot be tracked until `.gitignore` is narrowed.

## Quality Gate Inventory

| Existing command/surface | Current state | Destination task |
|---|---|---|
| Root `npm run verify` | Verifies signed constitution | Task 2 |
| Root `npm run self-test` | Ten classifier fixtures | Tasks 2 and 8 |
| Enforcement `typecheck` / `test` | 21 tests, classifier-heavy | Tasks 3–5 |
| Trust `typecheck` / `test` | 24 tests across claims, Merkle, strict mode | Tasks 3, 4, and 6 |
| Root scripts | No unit-test command or root `tsconfig.json` | Task 7 |
| `.github/workflows/` | No tracked workflows | Task 1 |
| `scripts/clawhub-publish.sh` | Enforcement failures soft-fail; trust tests omitted | Task 9 |
| `scripts/verify-pack.sh` | Checks package contents but not reproducibility/SBOM | Task 10 |

## Progress Tracking

- [x] Task 1: Add tracked continuous integration
- [x] Task 2: Add one root verification entry point and pin the supported runtime
- [x] Task 3: Add coverage instrumentation and initial thresholds
- [x] Task 4: Build reusable plugin test harnesses
- [x] Task 5: Cover enforcement configuration, audit, and hook integration
- [x] Task 6: Cover trust handshake, graph, persistence, group, and tool wiring
- [x] Task 7: Make root operational scripts testable
- [x] Task 8: Establish an independent adversarial fixture corpus
- [x] Task 9: Make every publish path fail hard on verification errors
- [x] Task 10: Verify package reproducibility and generate SBOMs

**Total Tasks:** 10 | **Completed:** 10 | **Remaining:** 0

## Implementation Tasks

### Task 1: Add tracked continuous integration

**Objective:** Run the current root and plugin checks on every pull request and protected-branch push using a supported Node runtime.

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `.gitignore`
- Modify: `README.md`
- Test: `.github/workflows/ci.yml`

**TDD:** Exempt — workflow/configuration-only.

**Steps:**
1. Narrow `.gitignore` so workflows are tracked while Praxiscode-managed files remain handled correctly.
2. Add a Node 22.19-or-newer CI job with dependency caching for all three lockfiles.
3. Run root verification/self-test and both plugin typecheck/test commands.
4. Add a package dry-run job that does not publish.
5. Validate the workflow syntax and run safe local equivalents of every command.

**Definition of Done:**
- [x] CI is tracked by Git
- [x] Every existing verification command runs in CI
- [x] The workflow uses a supported Node version
- [x] Package checks have no registry side effects

### Task 2: Add one root verification entry point and pin the supported runtime

**Objective:** Give developers and CI one deterministic command that verifies the constitution, root scripts, both plugins, and package contents.

**Files:**
- Create: `.node-version`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `docs/COMPATIBILITY.md`
- Test: `package.json` scripts executed end to end

**TDD:** Exempt for script/configuration wiring; command output is the verification.

**Steps:**
1. Raise the root engine to the plugin-supported minimum and add a checked-in runtime pin.
2. Add root `typecheck`, `test`, `test:all`, and `verify:all` scripts using explicit package prefixes.
3. Make `verify:all` run constitution verification, classifier fixtures, type checks, tests, and pack checks.
4. Keep commands cross-platform under the repository’s Bash/Windows constraints.
5. Run each component command separately, then run the aggregate command.

**Definition of Done:**
- [x] One root command covers all packages
- [x] Root and plugin Node requirements agree
- [x] Lockfile metadata matches the manifest
- [x] Documentation names the canonical command

### Task 3: Add coverage instrumentation and initial thresholds

**Objective:** Measure the current automated assurance surface and prevent coverage from silently shrinking.

**Files:**
- Modify: `plugin/package.json`
- Modify: `plugin/package-lock.json`
- Modify: `plugin-trust/package.json`
- Modify: `plugin-trust/package-lock.json`
- Modify: `package.json`
- Test: Existing and new `*.test.ts` files

**Steps:**
1. Add failing CI assertions showing no coverage command or threshold exists (RED).
2. Add `c8`-based coverage commands to both plugins (GREEN).
3. Set conservative initial line/branch/function thresholds based on measured baseline, not aspirational numbers.
4. Exclude generated declarations and test fixtures only.
5. Wire coverage into CI and document how thresholds may be raised.

**Definition of Done:**
- [x] Coverage commands pass
- [x] CI fails below documented thresholds
- [x] Thresholds are sourced from a fresh baseline
- [x] No production paths are hidden without rationale

### Task 4: Build reusable plugin test harnesses

**Objective:** Provide deterministic OpenClaw API stubs, temporary workspaces, fake clocks, and hook capture helpers for security-sensitive tests.

**Files:**
- Create: `plugin/src/test-helpers.ts`
- Create: `plugin-trust/src/test-helpers.ts`
- Create: `plugin/src/test-helpers.test.ts`
- Create: `plugin-trust/src/test-helpers.test.ts`
- Modify: `plugin/tsconfig.json` only if test-specific compilation needs an explicit config
- Modify: `plugin-trust/tsconfig.json` only if test-specific compilation needs an explicit config

**Steps:**
1. Write failing tests for temporary-directory cleanup, hook registration capture, fake approval resolution, and deterministic time (RED).
2. Implement minimal helpers using Node built-ins and typed OpenClaw interfaces (GREEN).
3. Ensure helpers never write to real `.openclaw/` paths.
4. Reuse the helpers in one existing test from each plugin.
5. Run type checks and both test suites.

**Definition of Done:**
- [x] Test workspaces are isolated and cleaned
- [x] Hook registration and callback behavior can be asserted
- [x] Time-dependent tests do not busy-wait
- [x] Both plugin suites pass

### Task 5: Cover enforcement configuration, audit, and hook integration

**Objective:** Test the enforcement paths not covered by classifier unit tests without yet changing security policy.

**Files:**
- Create: `plugin/src/config.test.ts`
- Create: `plugin/src/audit-log.test.ts`
- Create: `plugin/src/index.test.ts`
- Modify: `plugin/src/config.ts` only as needed for testability
- Modify: `plugin/src/audit-log.ts` only as needed for testability
- Modify: `plugin/src/index.ts` only as needed for dependency injection

**Steps:**
1. Write failing tests for config merge precedence, block terminal behavior, approval callback outcomes, allow logging, and valid-chain continuation (RED).
2. Extract only the seams needed to test registration and audit dependencies (GREEN).
3. Assert `toolCallId`, `runId`, `agentId`, and `sessionKey` are retained where the SDK provides them.
4. Do not codify malformed-tail reset or unknown-tool allow as desirable behavior; those belong to Plan 4.
5. Run enforcement tests, typecheck, and coverage.

**Definition of Done:**
- [x] Block, approval, resolution, and allow branches are covered
- [x] Config precedence is explicit
- [x] Correlation identifiers survive the hook boundary
- [x] No Plan 4 behavior change is implemented early

### Task 6: Cover trust handshake, graph, persistence, group, and tool wiring

**Objective:** Add baseline tests around the trust plugin’s untested core while reserving security expectation changes for Plan 4.

**Files:**
- Create: `plugin-trust/src/handshake.test.ts`
- Create: `plugin-trust/src/trust-graph.test.ts`
- Create: `plugin-trust/src/persistence.test.ts`
- Create: `plugin-trust/src/group-context.test.ts`
- Create: `plugin-trust/src/tools.test.ts`
- Create: `plugin-trust/src/identity.test.ts`
- Modify: Corresponding production files only to introduce test seams

**Steps:**
1. Write failing tests for a valid signed current-version handshake, graph export/import, atomic persistence, group membership, registered tools, and deterministic identity reload (RED).
2. Add minimal dependency injection or exports required by the tests (GREEN).
3. Avoid asserting acceptance of stale, unsigned, replayed, or spoofed claims; Plan 4 will specify their rejection.
4. Replace the strict-mode busy wait with a fake clock.
5. Run trust tests, typecheck, and coverage.

**Definition of Done:**
- [x] Every named trust module has direct tests
- [x] Tests use temporary paths and deterministic time
- [x] Existing valid signed behavior remains covered
- [x] Security flaws are not frozen as compatibility guarantees

### Task 7: Make root operational scripts testable

**Objective:** Cover adoption, revocation, audit append/verify/proof, and install verification without invoking real user files.

**Files:**
- Create: `scripts/safe-append.test.ts`
- Create: `scripts/revoke.test.ts`
- Create: `scripts/audit-chain.test.ts`
- Create: `scripts/verify-install.test.ts`
- Modify: `scripts/safe-append.ts`
- Modify: `scripts/revoke.ts`
- Modify: `scripts/audit-append.ts`
- Modify: `scripts/audit-verify.ts`
- Modify: `scripts/audit-proof.ts`
- Modify: `scripts/verify-install.ts`
- Modify: `package.json`

**Steps:**
1. Write failing tests for idempotent adoption, backups, symmetric revocation, tamper rejection, Merkle proof round-trip, and layered install reporting (RED).
2. Export pure functions and guard CLI entry points without changing observable behavior (GREEN).
3. Use temporary files and inject clocks/command runners.
4. Add a root `tsx --test` command for script tests.
5. Run root tests, constitution verification, and both plugin suites.

**Definition of Done:**
- [x] Critical root scripts have direct automated tests
- [x] CLI behavior remains backward compatible
- [x] Tests never touch real agent workspaces
- [x] Aggregate verification passes

### Task 8: Establish an independent adversarial fixture corpus

**Objective:** Decouple security expectations from classifier implementation and cover evasions, false positives, nested payloads, and renamed tools.

**Files:**
- Create: `test/fixtures/classifier-adversarial.json`
- Create: `test/fixtures/classifier-benign.json`
- Create: `scripts/run-classifier-corpus.ts`
- Create: `scripts/run-classifier-corpus.test.ts`
- Modify: `scripts/self-test.ts`
- Modify: `package.json`

**Steps:**
1. Write a failing corpus-runner test using fixtures external to `risk-classifier.ts` (RED).
2. Implement schema validation and deterministic fixture execution (GREEN).
3. Add encoded, nested, indirect, renamed, and benign-near-match cases.
4. Keep expected legacy behavior explicit where Plan 4 will intentionally change it.
5. Run the corpus in CI and report false-negative/false-positive counts by category.

**Definition of Done:**
- [x] Fixtures are independent of classifier source
- [x] Corpus reports results by risk category
- [x] Benign controls prevent one-sided hardening
- [x] CI runs the corpus

### Task 9: Make every publish path fail hard on verification errors

**Objective:** Prevent publication when any relevant test, typecheck, build, signature, or package-content check fails.

**Files:**
- Create: `scripts/clawhub-publish.test.ts`
- Modify: `scripts/clawhub-publish.sh`
- Modify: `scripts/verify-pack.sh`
- Modify: `package.json`
- Test: `scripts/clawhub-publish.test.ts`

**Steps:**
1. Write failing dry-run tests proving enforcement test failures are currently swallowed and trust tests are skipped (RED).
2. Run `verify:all` or the relevant strict subset before each publish (GREEN).
3. Remove soft-failure handling and make `--skip-tests` visibly unsafe or maintainer-only.
4. Verify version and lockfile consistency before packaging.
5. Exercise all publish targets in dry-run mode with simulated failures.

**Definition of Done:**
- [x] Enforcement and trust tests are mandatory
- [x] Typecheck and build failures stop publication
- [x] Dry-run tests cover every publish target
- [x] No registry publication occurs during tests

### Task 10: Verify package reproducibility and generate SBOMs

**Objective:** Make packaged contents and dependency inventories reviewable before signed release manifests are introduced later.

**Files:**
- Create: `scripts/package-reproducibility.ts`
- Create: `scripts/package-reproducibility.test.ts`
- Modify: `scripts/verify-pack.sh`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `docs/RELEASE_ASSURANCE.md`

**Steps:**
1. Write failing tests for deterministic file inventory and checksum output from unpacked dry-run tarballs (RED).
2. Implement package normalization and comparison without publishing (GREEN).
3. Add CycloneDX SBOM generation for the root skill and both plugins.
4. Exclude timestamps or normalize them before reproducibility comparison.
5. Add CI artifacts for checksums, file inventories, and SBOMs.

**Definition of Done:**
- [x] Package contents are compared deterministically
- [x] SBOMs are generated for all distributable artifacts
- [x] CI retains assurance artifacts
- [x] No signed-manifest claim is made before Plan 6

## Testing Strategy

- Use Node’s built-in test runner through `tsx`.
- Use temporary directories, dependency injection, and fake clocks for deterministic tests.
- Run `npm run verify:all` on the supported Node version.
- Keep behavior-changing security regression tests in Plan 4 to preserve TDD ordering.
- Treat CI configuration and runtime pins as configuration-only TDD exemptions, but validate safe local equivalents.

## Risks & Mitigations

- **Risk:** Baseline tests accidentally bless known vulnerabilities.
  **Mitigation:** Test valid paths and infrastructure only; reserve stale/unsigned/spoofed expectations for Plan 4.
- **Risk:** Coverage targets incentivize superficial tests.
  **Mitigation:** Start from measured baseline and prioritize branch coverage on security boundaries.
- **Risk:** Windows path behavior makes tests flaky.
  **Mitigation:** Use Node path APIs and temporary directories; include a Windows CI runner if available.
- **Risk:** CI files conflict with Praxiscode-managed `.github` content.
  **Mitigation:** Narrow ignore rules specifically and retain generated-instruction handling.
