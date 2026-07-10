# Conformance Receipts and Handshake Capsules

**Status:** PENDING
**Created:** 2026-07-10
**Scope:** In: signed conformance receipts, before/after tool-call correlation, receipt ledger and Merkle proofs, runtime/policy metadata, receipt verification tools, fresh v2 handshake capsules, coverage metrics, machine-readable adoption states, and signed release manifests. Out: universal behavioral-compliance claims, trusted-execution hardware, global receipt storage, contextual trust-policy redesign, amendment voting, ZK proofs, and post-quantum cryptography.

## Summary

Move FPP trust from unsupported declaration toward inspectable evidence. The enforcement plugin will emit signed, versioned conformance receipts linking a proposed action to classification, disposition, authorization, execution outcome, policy version, and audit commitment. The trust plugin will verify receipts and exchange fresh, challenge-bound trust-state capsules containing evidence roots and coverage—not raw private logs.

Receipts prove what the instrumented boundary observed and signed. They do not prove that every action passed through that boundary, that the runtime was uncompromised, or that a classification was morally correct.

This is Plan 6 of 7. It depends on Plans 2–5.

## Architecture Notes

- Use OpenClaw `before_tool_call` and `after_tool_call`; correlate on `toolCallId`, with `runId` and `sessionKey` as secondary context.
- A block is terminal in `before_tool_call` and finalizes immediately.
- Approval resolution records authorization state; actual execution outcome comes from `after_tool_call`.
- Pending receipts survive restart or become explicit audit-gap/orphan records.
- The enforcement plugin can operate without the trust plugin by loading/creating the compatible FPP agent identity key.
- Receipt roots are selectively disclosed; raw parameters and results are digested and minimized.
- Completeness remains a claim with coverage evidence, never an automatic conclusion.

## Feature Inventory

This plan extends and partially supersedes the current audit/handshake model.

| Existing file/function/behavior | New destination | Task |
|---|---|---|
| `plugin/src/index.ts` drops `toolCallId` from audit event | Correlated receipt context | Task 1 |
| `plugin/src/audit-log.ts::appendEnforcementEntry` writes unsigned decision entries | Compatibility audit plus signed receipt ledger | Tasks 2 and 3 |
| `before_tool_call` has no pending receipt state | Receipt lifecycle store | Task 1 |
| `onResolution` records approval outcome only | Authorization transition linked to execution | Task 4 |
| No `after_tool_call` registration | Final execution outcome hook | Task 4 |
| Trust identity exists only in `plugin-trust/` | Shared compatible signer in enforcement | Task 2 |
| `plugin-trust/src/merkle-bridge.ts` falls back across logs without evidence type | Typed receipt-root source | Tasks 3 and 6 |
| `fpp_attestation_export` exposes generic audit proof | Receipt-selective proof export | Task 6 |
| `ConstitutionalClaim` handshake payload | Fresh `TrustStateCapsuleV2` | Task 7 |
| Self-reported entry count/chain status | Coverage and gap metrics with explicit claim class | Task 8 |
| Markdown-only adoption record | Machine-readable adoption-state ledger | Task 9 |
| `scripts/verify-install.ts` reports layer presence | Adoption/enforcement/runtime state verification | Task 9 |
| Constitution signature does not bind binaries | Signed release manifest | Task 10 |
| No end-to-end receipt/capsule scenario | Cross-plugin integration suite | Task 11 |

Existing v1 audit logs remain readable and are never rewritten.

## Progress Tracking

- [ ] Task 1: Implement receipt lifecycle and correlation
- [ ] Task 2: Sign receipts with a compatible agent identity
- [ ] Task 3: Build the receipt ledger, chain verifier, and Merkle proofs
- [ ] Task 4: Correlate authorization and post-execution outcomes
- [ ] Task 5: Bind policy, runtime, and package metadata
- [ ] Task 6: Verify and selectively disclose receipts through the trust plugin
- [ ] Task 7: Implement fresh signed trust-state capsules
- [ ] Task 8: Compute coverage, completeness, and audit-gap metrics
- [ ] Task 9: Implement machine-readable adoption states
- [ ] Task 10: Generate and verify signed release manifests
- [ ] Task 11: Add cross-plugin end-to-end verification and documentation

**Total Tasks:** 11 | **Completed:** 0 | **Remaining:** 11

## Implementation Tasks

### Task 1: Implement receipt lifecycle and correlation

**Objective:** Create a deterministic state machine from proposed tool call through final outcome using host-authoritative correlation identifiers.

**Files:**
- Create: `plugin/src/receipt-store.ts`
- Create: `plugin/src/receipt-store.test.ts`
- Modify: `plugin/src/index.ts`
- Modify: `plugin/src/index.test.ts`
- Modify: `plugin/src/config.ts`
- Test: `plugin/src/receipt-store.test.ts`

**Steps:**
1. Add failing tests for allow, block, approval, missing `toolCallId`, duplicate callback, and concurrent calls (RED).
2. Implement a bounded pending-receipt store keyed by `toolCallId` with documented fallback correlation (GREEN).
3. Capture action digest, classification, disposition, agent/run/session context, and timestamps without storing raw secrets.
4. Finalize blocked actions immediately and leave executable actions pending.
5. Define deterministic idempotency and timeout behavior.

**Definition of Done:**
- [ ] Concurrent tool calls cannot cross-link receipts
- [ ] Blocked calls finalize exactly once
- [ ] Missing identifiers produce explicit reduced-confidence state
- [ ] Pending storage is bounded

### Task 2: Sign receipts with a compatible agent identity

**Objective:** Let the enforcement plugin issue key-bound signed receipts independently of whether the trust plugin is installed.

**Files:**
- Create: `plugin/src/receipt-signer.ts`
- Create: `plugin/src/receipt-signer.test.ts`
- Modify: `plugin/src/config.ts`
- Modify: `plugin/openclaw.plugin.json`
- Modify: `plugin/src/index.ts`
- Modify: `plugin-trust/src/identity.ts`
- Test: `plugin/src/receipt-signer.test.ts`

**Steps:**
1. Add failing tests for signer round-trip, key/ID mismatch, malformed key, shared-key compatibility, and disabled signing (RED).
2. Load the protocol-core identity format at the configured shared path (GREEN).
3. Sign canonical receipt payloads only after finalization.
4. Record algorithm, canonicalization version, key fingerprint, and signature.
5. Make unsigned degraded receipts explicit and non-trust-elevating.

**Definition of Done:**
- [ ] Enforcement-only installs can sign receipts
- [ ] Trust plugin verifies the same identity format
- [ ] Mismatched identities fail
- [ ] Unsigned degraded receipts are clearly labeled

### Task 3: Build the receipt ledger, chain verifier, and Merkle proofs

**Objective:** Persist finalized receipts in a typed append-only ledger with fail-closed chain handling and selective proof support.

**Files:**
- Create: `plugin/src/receipt-log.ts`
- Create: `plugin/src/receipt-log.test.ts`
- Create: `scripts/receipt-verify.ts`
- Create: `scripts/receipt-verify.test.ts`
- Create: `scripts/receipt-proof.ts`
- Create: `scripts/receipt-proof.test.ts`
- Modify: `package.json`
- Modify: `plugin/src/config.ts`

**Steps:**
1. Add failing tests for append, signature verification, chain tamper, malformed tail, Merkle proof, and typed-log confusion (RED).
2. Implement the v2 receipt ledger using protocol-core digests and Merkle primitives (GREEN).
3. Keep the legacy enforcement audit log as a compatibility view during migration.
4. Add CLI verification and proof generation without exposing raw action parameters.
5. Update the root verification command to inspect both log types when present.

**Definition of Done:**
- [ ] Receipts are signed, chained, and selectively provable
- [ ] Corruption stops append
- [ ] Legacy logs remain readable
- [ ] CLI tools distinguish receipt and heartbeat roots

### Task 4: Correlate authorization and post-execution outcomes

**Objective:** Complete receipts with the actual approval resolution and `after_tool_call` result/error/duration.

**Files:**
- Modify: `plugin/src/index.ts`
- Modify: `plugin/src/index.test.ts`
- Modify: `plugin/src/receipt-store.ts`
- Modify: `plugin/src/receipt-store.test.ts`
- Modify: `plugin/src/receipt-log.ts`
- Test: `plugin/src/index.test.ts`

**Steps:**
1. Add failing tests for approved-success, approved-error, denied, timeout, cancelled, allow-success, allow-error, missing after-hook, and duplicate after-hook (RED).
2. Register `after_tool_call` and correlate with pending state (GREEN).
3. Digest minimized result/error metadata rather than persisting sensitive output.
4. On shutdown/startup, mark unreconciled pending entries as explicit orphan/audit-gap events.
5. Verify callback errors cannot silently erase evidence.

**Definition of Done:**
- [ ] Every terminal path has one final status
- [ ] Approval is separate from execution success
- [ ] Orphaned calls become visible gaps
- [ ] Sensitive tool output is not copied into receipts

### Task 5: Bind policy, runtime, and package metadata

**Objective:** Make each receipt identify the constitution, classifier/ruleset, plugin build, configuration, and supported runtime that produced it.

**Files:**
- Create: `plugin/src/runtime-manifest.ts`
- Create: `plugin/src/runtime-manifest.test.ts`
- Modify: `plugin/src/risk-classifier.ts`
- Modify: `plugin/src/config.ts`
- Modify: `plugin/src/receipt-store.ts`
- Modify: `plugin/package.json`
- Modify: `plugin/openclaw.plugin.json`

**Steps:**
1. Add failing tests showing policy/config changes do not currently alter a receipt identifier (RED).
2. Compute deterministic hashes for classifier corpus/ruleset, effective config, package build, and constitution (GREEN).
3. Record OpenClaw/plugin API compatibility and degraded runtime state.
4. Exclude secrets and machine-specific paths from hashes.
5. Add version-change vectors proving materially different policy gets a different identifier.

**Definition of Done:**
- [ ] Receipts bind constitution and executable policy versions
- [ ] Configuration changes are detectable
- [ ] Hash inputs exclude secrets and irrelevant host data
- [ ] Runtime compatibility is explicit

### Task 6: Verify and selectively disclose receipts through the trust plugin

**Objective:** Let peers verify receipt signatures, schemas, chain roots, and inclusion proofs without receiving the full ledger.

**Files:**
- Create: `plugin-trust/src/receipt-verifier.ts`
- Create: `plugin-trust/src/receipt-verifier.test.ts`
- Modify: `plugin-trust/src/merkle-bridge.ts`
- Modify: `plugin-trust/src/merkle-bridge.test.ts`
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/tools.test.ts`
- Modify: `plugin-trust/src/index.ts`
- Modify: `plugin-trust/openclaw.plugin.json`

**Steps:**
1. Add failing tests for valid receipt, wrong signer, wrong policy hash, tampered proof, unknown schema, and cross-log root confusion (RED).
2. Implement typed receipt verification through protocol-core (GREEN).
3. Add receipt export/proof and receipt verification tools with privacy-preserving defaults.
4. Return precise claim/evidence classes and confidence ceilings.
5. Keep raw ledger disclosure opt-in and scoped.

**Definition of Done:**
- [ ] Receipt signatures and proofs are independently checked
- [ ] Log/root types cannot be confused
- [ ] Tool output names exactly what was verified
- [ ] Raw private logs are not exposed by default

### Task 7: Implement fresh signed trust-state capsules

**Objective:** Replace the legacy claim payload with a challenge-bound capsule containing identity, lineage, runtime, evidence roots, and validity.

**Files:**
- Create: `plugin-trust/src/capsule.ts`
- Create: `plugin-trust/src/capsule.test.ts`
- Modify: `plugin-trust/src/handshake.ts`
- Modify: `plugin-trust/src/handshake.test.ts`
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/cli.ts`

**Steps:**
1. Add failing tests for nonce, audience, expiry, runtime hash, receipt root, lineage, and selective-proof references (RED).
2. Build and sign `TrustStateCapsuleV2` from verified local state (GREEN).
3. Validate capsules through the hardened challenge/replay policy.
4. Keep self-view, peer-view summary, evidence roots, and coverage separate.
5. Deprecate legacy offer/verify payloads through the versioned compatibility path.

**Definition of Done:**
- [ ] Capsules are fresh, signed, scoped, and versioned
- [ ] Runtime and evidence roots are bound
- [ ] Self and peer summaries remain distinguishable
- [ ] Legacy claims cannot masquerade as capsules

### Task 8: Compute coverage, completeness, and audit-gap metrics

**Objective:** Quantify what the instrumented boundary observed while refusing to infer completeness from event volume alone.

**Files:**
- Create: `plugin/src/coverage-metrics.ts`
- Create: `plugin/src/coverage-metrics.test.ts`
- Modify: `plugin/src/receipt-log.ts`
- Modify: `plugin-trust/src/capsule.ts`
- Modify: `plugin-trust/src/capsule.test.ts`
- Modify: `scripts/verify-install.ts`

**Steps:**
1. Add failing tests for complete fixture interval, missing after-hook, audit write failure, plugin downtime, restart gap, and unknown total denominator (RED).
2. Compute observed coverage, gap count, interval bounds, and confidence separately (GREEN).
3. Represent unknown denominator as unknown—not 100%.
4. Include severe recent-event indicators without exposing raw details.
5. Bind metric definitions and version to the capsule.

**Definition of Done:**
- [ ] Coverage and confidence are separate
- [ ] Unknown completeness remains unknown
- [ ] Audit gaps reduce confidence
- [ ] Metric version is explicit

### Task 9: Implement machine-readable adoption states

**Objective:** Persist and verify the adoption lifecycle defined by Plan 5 rather than relying on static Markdown checkboxes.

**Files:**
- Create: `scripts/adoption-state.ts`
- Create: `scripts/adoption-state.test.ts`
- Modify: `scripts/safe-append.ts`
- Modify: `scripts/revoke.ts`
- Modify: `scripts/verify-install.ts`
- Modify: `scripts/verify-install.test.ts`
- Modify: `adoption/MEMORY-ENTRY.md`
- Modify: `docs/REVOCATION.md`

**Steps:**
1. Add failing tests for reviewed, accepted, externally-enforced, inherited, revoked, forked, superseded, and invalid transitions (RED).
2. Append signed or hash-chained adoption-state records through protocol-core (GREEN).
3. Make adopt/revoke scripts update records idempotently while preserving human-readable memory.
4. Have install verification distinguish installation, adoption, enforcement, and degraded runtime.
5. Preserve exit and fork history.

**Definition of Done:**
- [ ] Adoption is no longer represented as a Boolean
- [ ] Invalid transitions fail
- [ ] Human and machine-readable records agree
- [ ] Revocation preserves history

### Task 10: Generate and verify signed release manifests

**Objective:** Bind distributed artifacts to source, constitution, policy, dependencies, tests, and supported runtime.

**Files:**
- Create: `scripts/release-manifest.ts`
- Create: `scripts/release-manifest.test.ts`
- Create: `scripts/release-manifest-verify.ts`
- Create: `scripts/release-manifest-verify.test.ts`
- Modify: `scripts/clawhub-publish.sh`
- Modify: `scripts/verify-pack.sh`
- Modify: `docs/RELEASE_ASSURANCE.md`
- Modify: `package.json`

**Steps:**
1. Add failing tests for tampered package hash, wrong source commit, stale lock hash, wrong test-corpus hash, unsupported runtime, and wrong signing domain (RED).
2. Generate a manifest binding all fields defined in protocol-core (GREEN).
3. Sign with a release key distinct from constitution and agent identity keys.
4. Verify manifests before publish and include them in package assurance artifacts.
5. Document offline key custody, rotation, and revocation prerequisites from Plan 5.

**Definition of Done:**
- [ ] Manifest binds source and all distributable artifacts
- [ ] Signing domains are separated
- [ ] Verification detects tampering and stale metadata
- [ ] Publish refuses an invalid manifest

### Task 11: Add cross-plugin end-to-end verification and documentation

**Objective:** Demonstrate one full known-risk action lifecycle from classification through receipt proof and fresh peer capsule verification.

**Files:**
- Create: `test/conformance-receipt-e2e.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `SKILL.md`
- Modify: `MASTER_CONTEXT.md`
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `docs/COMPATIBILITY.md`
- Modify: `docs/TROUBLESHOOTING.md`

**Steps:**
1. Add a failing integration scenario spanning both plugins and protocol-core (RED).
2. Exercise block, approval-success, execution-error, proof export, receipt verification, and capsule exchange (GREEN).
3. Add negative cases for replay, wrong signer, wrong policy, missing outcome, and audit gap.
4. Run isolated package installation before the end-to-end suite.
5. Update capability claims only to the demonstrated boundary.

**Definition of Done:**
- [ ] Full receipt/capsule lifecycle passes in CI
- [ ] Negative integrity cases fail as expected
- [ ] Independent plugin installation remains supported
- [ ] Documentation states the completeness limitation

## Testing Strategy

- Use host-authoritative IDs and fake OpenClaw hook events for deterministic correlation.
- Test every terminal lifecycle path and crash/orphan state.
- Use golden receipt/capsule/release-manifest vectors from protocol-core.
- Keep sensitive parameters/results out of fixtures except explicit redaction tests.
- Install packed artifacts with `--ignore-scripts` before cross-plugin tests.

## Risks & Mitigations

- **Risk:** Receipt signing is mistaken for behavioral truth.
  **Mitigation:** Claim-class limits in schemas, APIs, and documentation.
- **Risk:** Correlation fails when host identifiers are absent.
  **Mitigation:** Reduced-confidence fallback plus explicit gaps; never silently join ambiguous calls.
- **Risk:** Receipts leak tool parameters or results.
  **Mitigation:** Digest/minimize by default and test redaction.
- **Risk:** Shared agent keys widen compromise impact.
  **Mitigation:** File permissions, signing-domain separation, rotation records, and optional dedicated runtime subkeys.
- **Risk:** Release signing creates operational key burden.
  **Mitigation:** Follow Plan 5 key governance and block automation until custody requirements are met.
