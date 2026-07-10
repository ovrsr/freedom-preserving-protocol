# Runtime Security Hardening

**Status:** PENDING
**Created:** 2026-07-10
**Scope:** In: key/ID binding, challenge freshness, replay prevention, hardened v2 defaults, evidence-aware trust derivation, precise verification terminology, unknown-tool handling, fail-closed audit behavior, strict-mode resilience, and configuration migration. Out: signed conformance receipts, full post-execution coverage, contextual trust redesign, governance ratification, and remote-host guarantees.

## Summary

Remediate the high-impact protocol-integrity and enforcement findings demonstrated in the current code. A v2 handshake must reject mismatched identities, stale/replayed claims, unsigned claims under hardened policy, and unsupported evidence. The enforcement plugin must no longer silently allow unknown tools or reset a corrupted audit chain.

Legacy v1 claims remain parseable during migration but are `declaration-only`; they cannot produce `fppVerified`, HIGH trust, or equivalent standing.

This is Plan 4 of 7. It depends on Plans 2 and 3.

## Architecture Notes

- `@ovrsr/fpp-protocol-core` owns versioned schemas and identity/freshness verification.
- The trust plugin owns challenge issuance, replay-cache state, handshake policy, and local trust updates.
- Signed fresh configuration is not behavioral evidence. Until Plan 6 adds receipts, it can establish only identity/configuration standing.
- Merkle proof validation proves inclusion under a root; it does not independently prove log completeness or moral compliance.
- Unknown tools become approval-required by default, with explicit operator override rather than implicit allow.
- Audit corruption and write failure become named degraded modes with conservative policy.

## Feature Inventory

This plan intentionally changes existing behavior. Every replaced surface is mapped below.

| Existing file/function/behavior | Replacement | Task |
|---|---|---|
| `plugin-trust/src/claims.ts::verifyClaim` accepts arbitrary signed `agentId` | Core-backed key/ID verification | Task 1 |
| `plugin-trust/src/handshake.ts::verifyFromClaim` has no freshness enforcement | Challenge-bound v2 verification | Task 2 |
| `plugin-trust/src/tools.ts::executeHandshakeOffer` creates replayable claims | Challenge-response offer/answer flow | Task 2 |
| `plugin-trust/src/cli.ts` claim verification has no replay policy | Versioned challenge-aware CLI | Task 2 |
| `plugin-trust/src/index.ts` defaults signed/proof checks off | Hardened v2 policy with explicit legacy mode | Task 3 |
| Trust plugin manifest defaults | Schema-aligned hardened defaults | Tasks 3 and 9 |
| `chainIntact` and `auditEntryCount` self-assertions drive trust | Evidence-level-aware derivation | Task 4 |
| Optional proof under a self-asserted root | Precisely labeled inclusion evidence | Task 4 |
| `fppVerified` outputs in `tools.ts` | Claim-specific verification result plus compatibility field | Task 5 |
| `unknown.unclassified -> allow` | Approval-required unknown/degraded classification | Task 6 |
| `audit-log.ts::readPreviousHash` returns zero on malformed tail | Explicit corruption error | Task 7 |
| Uncaught/silent audit-write behavior in `plugin/src/index.ts` | Named degraded-mode policy | Task 7 |
| Strict-mode parse failure returns no overrides | Configurable conservative fallback and diagnostics | Task 8 |
| Dead `http.public-read` strict classification | Valid taxonomy or removal | Task 8 |
| Manifest/runtime default drift | One validated source of defaults | Task 9 |
| Classifier hard block downgraded by loose config | Explicit dangerous override policy | Task 9 |
| Approval timeout may be configured fail-open without warning | Validated risk-aware timeout policy | Task 9 |

No security behavior is removed without a versioned migration path.

## Progress Tracking

- [ ] Task 1: Enforce key-bound identity
- [ ] Task 2: Add challenge freshness and replay prevention
- [ ] Task 3: Introduce versioned verification policy and hardened defaults
- [ ] Task 4: Derive trust only from verified evidence classes
- [ ] Task 5: Replace ambiguous verification terminology and outputs
- [ ] Task 6: Require approval for unknown tools
- [ ] Task 7: Fail safely on audit corruption and persistence failure
- [ ] Task 8: Harden strict-mode state and taxonomy handling
- [ ] Task 9: Normalize configuration and migration diagnostics
- [ ] Task 10: Add end-to-end security regression coverage

**Total Tasks:** 10 | **Completed:** 0 | **Remaining:** 10

## Implementation Tasks

### Task 1: Enforce key-bound identity

**Objective:** Reject any signed claim whose agent identifier is not derivable from the embedded public key.

**Files:**
- Modify: `plugin-trust/src/claims.ts`
- Modify: `plugin-trust/src/identity.ts`
- Modify: `plugin-trust/src/claims.test.ts`
- Modify: `plugin-trust/src/identity.test.ts`
- Modify: `plugin-trust/src/trust-graph.ts`
- Test: `plugin-trust/src/claims.test.ts`

**Steps:**
1. Add a failing regression test reproducing a valid signature with a spoofed agent ID (RED).
2. Verify the v2 key fingerprint through protocol-core before accepting the signature (GREEN).
3. Store legacy aliases separately from canonical v2 IDs.
4. Reject public-key replacement through `updateAgentPublicKey` unless a later rotation proof is present.
5. Run trust tests and typecheck.

**Definition of Done:**
- [ ] Spoofed agent IDs fail
- [ ] Correct key-bound IDs pass
- [ ] Legacy aliases cannot replace canonical identity
- [ ] Trust tests and typecheck pass

### Task 2: Add challenge freshness and replay prevention

**Objective:** Require peer-supplied challenge, audience, issue time, expiry, and one-time replay keys for v2 handshakes.

**Files:**
- Create: `plugin-trust/src/replay-cache.ts`
- Create: `plugin-trust/src/replay-cache.test.ts`
- Modify: `plugin-trust/src/handshake.ts`
- Modify: `plugin-trust/src/handshake.test.ts`
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/tools.test.ts`
- Modify: `plugin-trust/src/cli.ts`

**Steps:**
1. Add failing tests for a 2020 claim, reused nonce, wrong audience, future issue time, expired response, and accepted fresh response (RED).
2. Implement challenge issuance and bounded replay-cache storage (GREEN).
3. Bind the challenge and audience into the signed v2 payload.
4. Make tool and CLI flows explicit: request challenge, answer challenge, verify once.
5. Prune expired replay entries and cap storage growth.

**Definition of Done:**
- [ ] Stale, future, wrong-audience, and replayed claims fail
- [ ] Fresh one-time responses pass
- [ ] Replay state is bounded and persisted or conservatively reset
- [ ] Tests use a fake clock

### Task 3: Introduce versioned verification policy and hardened defaults

**Objective:** Require signed v2 claims by default while allowing an explicit, visibly weaker legacy compatibility mode.

**Files:**
- Modify: `plugin-trust/src/index.ts`
- Modify: `plugin-trust/openclaw.plugin.json`
- Modify: `plugin-trust/src/handshake.ts`
- Modify: `plugin-trust/src/index.test.ts`
- Modify: `plugin-trust/README.md`
- Modify: `docs/COMPATIBILITY.md`

**Steps:**
1. Add failing tests showing unsigned and unknown-version claims are accepted under current defaults (RED).
2. Replace boolean toggles with a verification policy such as `hardened-v2`, `v2-with-legacy-declarations`, or `legacy-unsafe` (GREEN).
3. Default new installs to hardened v2.
4. Emit prominent diagnostics when legacy mode is enabled.
5. Keep v1 data inspectable but prevent trust elevation.

**Definition of Done:**
- [ ] New installs reject unsigned v2 handshakes
- [ ] Legacy mode is explicit and visibly weaker
- [ ] Manifest and runtime defaults agree
- [ ] Migration behavior is documented

### Task 4: Derive trust only from verified evidence classes

**Objective:** Stop treating self-reported chain status and entry count as proof, and cap trust according to evidence strength.

**Files:**
- Modify: `plugin-trust/src/handshake.ts`
- Modify: `plugin-trust/src/handshake.test.ts`
- Modify: `plugin-trust/src/trust-graph.ts`
- Modify: `plugin-trust/src/trust-graph.test.ts`
- Modify: `plugin-trust/src/merkle-bridge.ts`
- Modify: `plugin-trust/src/merkle-bridge.test.ts`

**Steps:**
1. Add failing tests showing a self-asserted `chainIntact` claim currently reaches HIGH trust (RED).
2. Map identity, configuration, runtime, event, completeness, and behavioral evidence to explicit confidence ceilings (GREEN).
3. Treat signed fresh configuration as limited standing, not behavioral proof.
4. Label Merkle proof results as inclusion-under-claimed-root until externally anchored.
5. Remove evidence-count-only confidence inflation from handshake derivation.

**Definition of Done:**
- [ ] Self-assertion alone cannot produce HIGH trust
- [ ] Every confidence contribution has a verified evidence class
- [ ] Merkle semantics are precise
- [ ] Existing valid evidence paths remain usable

### Task 5: Replace ambiguous verification terminology and outputs

**Objective:** Make tools, CLI, and APIs report exactly what was verified while preserving a deprecation path for consumers of `fppVerified`.

**Files:**
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/tools.test.ts`
- Modify: `plugin-trust/src/cli.ts`
- Modify: `plugin-trust/README.md`
- Modify: `SKILL.md`
- Modify: `README.md`

**Steps:**
1. Add failing output tests for ambiguous `FPP handshake VERIFIED` and `fppVerified` responses (RED).
2. Return fields such as `identityVerified`, `configurationClaimVerified`, `freshnessVerified`, `evidenceLevel`, and `standing` (GREEN).
3. Retain `fppVerified` only as a deprecated false-or-derived compatibility field for one documented window.
4. Remove “behavioral compliance verified” implications from text output.
5. Document the migration contract.

**Definition of Done:**
- [ ] API output names the verified claim class
- [ ] Human output avoids blanket compliance language
- [ ] Compatibility behavior is versioned and tested
- [ ] Documentation matches runtime output

### Task 6: Require approval for unknown tools

**Objective:** Change unclassified capabilities from implicit allow to a conservative, configurable approval path.

**Files:**
- Modify: `plugin/src/risk-classifier.ts`
- Modify: `plugin/src/risk-classifier.test.ts`
- Modify: `scripts/self-test.ts`
- Modify: `test/fixtures/classifier-adversarial.json`
- Modify: `plugin/src/config.ts`
- Modify: `plugin/openclaw.plugin.json`

**Steps:**
1. Change the existing unknown-tool test to expect approval and verify it fails (RED).
2. Return an approval recommendation with a degraded-classification reason (GREEN).
3. Add an explicit operator override for known custom tools rather than a global fail-open default.
4. Cover renamed and nested high-impact tools in the independent corpus.
5. Measure and document false-positive effects.

**Definition of Done:**
- [ ] Unknown tools require approval by default
- [ ] Trusted custom-tool exceptions are explicit and scoped
- [ ] Self-test and adversarial corpus agree
- [ ] Benign known tools retain expected behavior

### Task 7: Fail safely on audit corruption and persistence failure

**Objective:** Prevent silent chain reset and apply conservative behavior when enforcement decisions cannot be recorded.

**Files:**
- Modify: `plugin/src/audit-log.ts`
- Modify: `plugin/src/audit-log.test.ts`
- Modify: `plugin/src/index.ts`
- Modify: `plugin/src/index.test.ts`
- Modify: `plugin/src/config.ts`
- Modify: `plugin/openclaw.plugin.json`
- Modify: `docs/TROUBLESHOOTING.md`

**Steps:**
1. Add failing tests for malformed tail, hash mismatch, unwritable path, and failed resolution logging (RED).
2. Make tail corruption an explicit error rather than returning the zero hash (GREEN).
3. Add `auditFailureBehavior` with conservative default for high-risk calls.
4. Emit an independently visible audit-gap diagnostic when post-approval outcome logging fails.
5. Verify recovery never overwrites or silently restarts the old chain.

**Definition of Done:**
- [ ] Corrupted tails stop append
- [ ] High-risk calls do not proceed silently without audit
- [ ] Post-resolution gaps are visible and recoverable
- [ ] Recovery instructions preserve original evidence

### Task 8: Harden strict-mode state and taxonomy handling

**Objective:** Avoid fail-open strict-mode behavior on malformed state and ensure every configured classification exists.

**Files:**
- Modify: `plugin/src/index.ts`
- Modify: `plugin/src/index.test.ts`
- Modify: `plugin-trust/src/strict-mode.ts`
- Modify: `plugin-trust/src/strict-mode.test.ts`
- Modify: `plugin/src/risk-classifier.ts`
- Modify: `plugin/src/config.ts`

**Steps:**
1. Add failing tests for malformed strict-mode JSON, expired entries, unknown classifications, and dead `http.public-read` overrides (RED).
2. Validate strict-mode files through a versioned schema (GREEN).
3. Apply a conservative session fallback when configured state is malformed.
4. Remove or implement taxonomy entries so every override is reachable.
5. Add structured diagnostics without logging sensitive session content.

**Definition of Done:**
- [ ] Malformed state cannot silently disable configured protection
- [ ] Every override references a valid classification
- [ ] Expiry remains deterministic
- [ ] Cross-plugin tests pass

### Task 9: Normalize configuration and migration diagnostics

**Objective:** Use one source of defaults and require explicit acknowledgement for dangerous overrides.

**Files:**
- Modify: `plugin/src/config.ts`
- Modify: `plugin/src/config.test.ts`
- Modify: `plugin/openclaw.plugin.json`
- Modify: `plugin-trust/src/index.ts`
- Modify: `plugin-trust/openclaw.plugin.json`
- Modify: `scripts/verify-install.ts`
- Modify: `scripts/verify-install.test.ts`

**Steps:**
1. Add failing tests for manifest/runtime drift, fail-open timeout, block downgrade, and unsafe legacy settings (RED).
2. Generate or validate manifests against runtime defaults (GREEN).
3. Require an explicit dangerous-mode acknowledgement for block downgrades or timeout allow.
4. Add install-verification warnings/errors for unsafe configurations.
5. Define migration output for existing installations without silently rewriting user config.

**Definition of Done:**
- [ ] Manifest and runtime defaults are identical
- [ ] Dangerous overrides require explicit acknowledgement
- [ ] Existing operators receive actionable migration diagnostics
- [ ] No user config is silently changed

### Task 10: Add end-to-end security regression coverage

**Objective:** Prove the demonstrated findings are closed across the actual tool and hook surfaces.

**Files:**
- Create: `plugin-trust/src/security-regressions.test.ts`
- Create: `plugin/src/security-regressions.test.ts`
- Modify: `test/fixtures/classifier-adversarial.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `docs/TROUBLESHOOTING.md`

**Steps:**
1. Run the original probes and capture failing tests for spoofed ID, 2020 claim, replay, unsigned v2, self-asserted HIGH trust, unknown tool allow, and chain reset (RED).
2. Complete only the minimal remaining integrations needed for all regressions to pass (GREEN).
3. Add malformed-input and benign-compatibility controls.
4. Run aggregate verification, coverage, and isolated package tests.
5. Update capability status only for guarantees proven by the tests.

**Definition of Done:**
- [ ] Every demonstrated finding has a regression test
- [ ] Security regressions pass in CI
- [ ] Benign compatibility controls pass
- [ ] Documentation claims no more than the tests prove

## Testing Strategy

- Follow strict RED/GREEN for each demonstrated vulnerability.
- Use fake clocks, deterministic nonces, temporary workspaces, and isolated plugin instances.
- Test v1 and v2 separately; never infer v2 assurance from successful v1 parsing.
- Exercise tool output, CLI output, hook registration, and persistence—not only pure helpers.
- Run the independent classifier corpus to track false positives and false negatives.

## Risks & Mitigations

- **Risk:** Hardened defaults break existing peer handshakes.
  **Mitigation:** Versioned v2 plus explicit declaration-only v1 compatibility mode.
- **Risk:** Unknown-tool approval creates excessive prompts.
  **Mitigation:** Scoped custom-tool allowlists with audit and clear provenance.
- **Risk:** Fail-closed audit policy disrupts low-risk work during filesystem faults.
  **Mitigation:** Risk-aware degraded modes and visible operator diagnostics.
- **Risk:** Trust scores drop after evidence ceilings are corrected.
  **Mitigation:** Treat this as correction of semantics, preserve raw evidence, and provide migration explanations.
