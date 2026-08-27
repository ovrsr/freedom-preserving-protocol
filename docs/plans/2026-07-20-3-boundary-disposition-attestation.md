# Instrumented-Boundary Disposition Attestation

**Status:** COMPLETE
**Created:** 2026-07-20
**Scope:**
- **In:** Add a positive, machine-readable receipt-verification conclusion named `instrumented-boundary-disposition`; expose its assumptions and limitations in trust-plugin output; align evidence semantics, RFC wording, examples, and canonical capability claims.
- **Out:** Creating a new top-level claim class, renaming `ConformanceReceiptV1`, claiming exact downstream parameter equality, claiming execution completeness or behavioral compliance, proving an uncompromised runtime, or upgrading gateway enforcement from `PROPOSED`.

## Summary

The repository accurately limits conformance receipts to Event-class, instrumented-boundary evidence, but its user-facing language emphasizes non-claims more clearly than the positive conclusion a valid signed receipt does support. RFC 0001 calls the outcome “consultation,” which undersells a cryptographically signed disposition record. Conversely, the critique’s phrase “cryptographic execution constraint” overstates current evidence because receipts do not prove that the downstream tool executed with exactly the digested parameters or that no uninstrumented path existed.

This feature keeps the existing `event` claim class and adds a narrower attestation kind: `instrumented-boundary-disposition`. When receipt schema, signature, expected policy/hash checks, and any supplied inclusion proof verify, the report states that the signer recorded disposition `D` and authorization `A` against action digest `H` under the bound policy/runtime metadata at the instrumented boundary. The same report carries explicit assumptions and non-conclusions. Invalid or unsigned-degraded receipts never receive a positive attestation.

Post-implementation review reproduced acceptance of an unrelated Merkle proof as valid inclusion for a supplied receipt. It also found that weak schema-valid content could receive a conclusion naming metadata that was absent, optional expected-value checks were collapsed, invalid reports retained nonzero trust ceilings, and human-facing output omitted material assumptions. Tasks 6–8 remediate those findings before this plan can return to `COMPLETE`.

The second post-implementation review found two remaining semantic blockers. First, a self-presented receipt can still receive the formal Event-class attestation when every caller-supplied expected context is omitted; the trust tool does not use its configured constitution hash as a default, and its text describes self-certified key consistency as “agent identity.” Second, inclusion is still reported as a “Merkle inclusion proof” under a root supplied by the same evidence bundle, while malformed receipt-log lines are silently skipped when constructing the tree. Tasks 9–10 require independently anchored verification context, fail-closed log parsing, and explicit separation of proof mathematics from trust in the root or signer.

A follow-up review found that strict proof export rejects an entire receipt log containing an allowed structurally valid `unsigned-degraded` entry. Task 11 preserves fail-closed structural and chain validation while retaining degraded entries as non-trust-elevating Merkle leaves.

## Architecture Notes

### Locked terminology

- **Formal claim class:** `event` (unchanged).
- **Evidence kinds:** cryptographic + interception-boundary.
- **Positive attestation kind:** `instrumented-boundary-disposition`.
- **Uncertainty label:** `proven_under_assumptions` for cryptographic validity; `boundary_attested` only when the verifier has trusted boundary evidence beyond a self-presented receipt.
- **Avoid:** unqualified “cryptographic execution constraint,” “exact parameter restriction,” “proof of compliance,” or “complete audit.”

### Maximum justified conclusion

> For this receipt, the identified signer recorded disposition D and authorization A against action digest H under the bound policy, constitution, classifier, configuration, and runtime metadata at an FPP instrumented boundary.

The report must separately disclose:

- whether the receipt signature was valid;
- each requested expected-value comparison independently;
- whether Merkle inclusion was supplied and cryptographically bound to this exact receipt-log entry;
- that the receipt does not prove downstream parameter equality;
- that it does not prove the action was the only route to the side effect;
- that it does not prove completeness, uncompromised runtime, or behavioral compliance.

### Compatibility

- `claimClass: "event"` and valid Event evidence ceilings remain unchanged; invalid reports have a zero/non-applicable confidence ceiling.
- The positive attestation is an additive field in `ReceiptEvidenceReport`.
- Existing emitted receipt wire format remains unchanged; parser validation is tightened for digest/date shape and a versioned inclusion-evidence bundle is additive.
- Consumers that ignore unknown report fields continue to work.

## Progress Tracking

- [x] Task 1: Add machine-readable positive receipt attestation
- [x] Task 2: Expose bounded positive wording in the trust tool
- [x] Task 3: Extend governance evidence semantics and examples
- [x] Task 4: Reframe the gateway RFC claim cross-link
- [x] Task 5: Reconcile public and canonical capability wording
- [x] Task 6: Bind Merkle inclusion to the exact receipt entry
- [x] Task 7: Gate conclusions on validated metadata and explicit expectations
- [x] Task 8: Align tool output, docs, and confidence semantics
- [x] Task 9: Require anchored verification context for positive attestations
- [x] Task 10: Make inclusion and signer trust semantics fail closed
- [x] Task 11: Preserve allowed unsigned-degraded receipt-log entries
- [x] Task 12: Cover receipt roots through proof and capsule tools

**Total Tasks:** 12 | **Completed:** 12 | **Remaining:** 0

## Implementation Tasks

### Task 1: Add machine-readable positive receipt attestation

**Objective:** Extend independent receipt verification with a structured positive conclusion that is emitted only when the receipt evidence is valid.

**Files:**
- Modify: `packages/trust-core/src/receipt-verifier.ts`
- Modify: `packages/trust-core/src/receipt-verifier.test.ts`
- Modify: `packages/trust-core/src/index.ts`
- Test: `test/conformance-receipt-e2e.test.ts`

**Steps:**
1. RED: add verifier tests asserting a valid signed receipt returns an attestation with kind `instrumented-boundary-disposition`, `claimClass: "event"`, the bound action digest/disposition/authorization/policy metadata, a maximum conclusion, assumptions, and limitations.
2. RED: assert invalid signatures, unsigned-degraded receipts, schema failures, policy/hash mismatches, and invalid inclusion proofs return no positive attestation.
3. RED: distinguish a valid signed receipt from a valid receipt with verified Merkle inclusion without implying that either proves log completeness.
4. RED: assert `whatWasNotProven` includes downstream parameter equality, uninstrumented/bypass paths, completeness, uncompromised runtime, and behavioral compliance.
5. Run focused trust-core and receipt E2E tests and confirm the new fields fail because the report currently exposes only generic verified/non-proven strings.
6. GREEN: add an exported attestation type and populate it only after the existing `valid` calculation succeeds; derive values exclusively from the schema-validated receipt.
7. Preserve existing evidence class, confidence ceiling, signature verification, and inclusion behavior.
8. Run trust-core tests, receipt E2E tests, typecheck, and linter diagnostics.

**Definition of Done:**
- [x] Valid receipts produce a structured bounded attestation
- [x] Invalid or unsigned receipts produce no positive attestation
- [x] Bound action/disposition/policy fields come from semantically validated signed content
- [x] Merkle-included evidence is bound to the exact supplied receipt entry
- [x] Invalid evidence has no trust-elevating confidence ceiling
- [x] Trust-core and E2E tests/typechecks pass
- [x] No new linter errors

### Task 2: Expose bounded positive wording in the trust tool

**Objective:** Present the affirmative receipt conclusion before the limitations while keeping both visible in machine-readable and text output.

**Files:**
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/tools.test.ts`

**Steps:**
1. RED: add tool tests proving a valid receipt response names `instrumented-boundary-disposition`, includes the action digest/disposition/authorization conclusion, and retains the behavioral/completeness disclaimer.
2. RED: add failure tests proving invalid receipts never print “attested,” “constrained,” or an affirmative disposition conclusion.
3. RED: assert the text does not claim exact downstream parameters, complete interception, or behavioral compliance.
4. Run the focused tools test and confirm the positive wording assertions fail against the current generic “Receipt verified” response.
5. GREEN: format the structured verifier attestation into concise text, then state the limitations; return the full report unchanged in structured tool data.
6. Keep output lengths within OpenClaw tool constraints and do not expose raw tool parameters.
7. Run plugin-trust tests, typecheck, and linter diagnostics.

**Definition of Done:**
- [x] Valid tool output communicates the positive disposition attestation
- [x] Assumptions and all material limitations remain explicit and adjacent
- [x] Invalid receipts never receive affirmative language
- [x] No raw parameters or secrets are disclosed
- [x] Plugin-trust tests and typecheck pass
- [x] No new linter errors

### Task 3: Extend governance evidence semantics and examples

**Objective:** Define the positive attestation within the existing Event class and cryptographic/interception-boundary evidence model.

**Files:**
- Modify: `docs/governance/EVIDENCE_SEMANTICS.md`
- Modify: `docs/governance/examples/evidence-claims.json`
- Create: `docs/governance/EVIDENCE_SEMANTICS.test.ts`

**Steps:**
1. RED: add a structure test requiring the exact attestation name, Event-class mapping, maximum conclusion, evidence kinds, assumptions, and prohibited conclusions.
2. RED: validate the example JSON and assert its receipt example cannot omit completeness, downstream-parameter, bypass, or behavioral limitations.
3. Run the new documentation test and confirm it fails because no boundary-disposition entry exists.
4. GREEN: add a positive receipt subsection that distinguishes byte/signature integrity, boundary observation, and completeness burdens.
5. Add an Event-class receipt example with `proven_under_assumptions`; reserve `boundary_attested` for evidence that actually establishes a trusted boundary.
6. Avoid adding a seventh top-level claim class; cross-reference existing receipt verifier behavior.
7. Run the new structure test and repository script/document tests.

**Definition of Done:**
- [x] Evidence semantics define the positive attestation precisely
- [x] Event claim class remains authoritative
- [x] Evidence-kind and uncertainty-label use is internally consistent
- [x] Example includes affirmative conclusion and all required limitations
- [x] Documentation structure tests pass
- [x] No broken links or new linter errors

### Task 4: Reframe the gateway RFC claim cross-link

**Objective:** Replace weak “consultation” wording with precise policy-evaluation and disposition-attestation language without expanding gateway proof claims.

**Files:**
- Modify: `docs/rfc/0001-voluntary-constitutional-layer.md`
- Modify: `docs/rfc/0001-voluntary-constitutional-layer.test.ts`
- Modify: `docs/rfc/REVIEW_CHECKLIST.md`

**Steps:**
1. RED: extend the RFC structure test to require an `instrumented-boundary-disposition` row with positive and prohibited conclusions.
2. RED: assert the RFC no longer uses unqualified “consultation occurred” as its maximum positive claim and does not contain an unqualified “cryptographic execution constraint” assertion.
3. Run the RFC test and confirm failure against the current claim table.
4. GREEN: describe gateway policy evaluation as producing a disposition record and add a claim cross-link row for a valid signed receipt with matching action/policy metadata.
5. State that exact downstream parameters become claimable only if a future execute-time digest comparison is separately implemented and evidenced.
6. Update reviewer guidance to check both claim strength and claim ceiling.
7. Run RFC and document tests.

**Definition of Done:**
- [x] RFC has a defensible affirmative receipt claim supported by verifier inputs
- [x] “Consultation” is replaced where it understates recorded disposition
- [x] “Execution constraint” is not used beyond current evidence
- [x] Exact downstream parameters remain an explicit non-claim
- [x] RFC tests pass
- [x] No broken links or new linter errors

### Task 5: Reconcile public and canonical capability wording

**Objective:** Surface the positive claim consistently while preserving `PARTIAL` receipt coverage and `PROPOSED` gateway status.

**Files:**
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `README.md`
- Modify: `plugin/README.md`
- Modify: `plugin-trust/README.md`

**Steps:**
1. Update the conformance-receipt capability row to name the positive Event-class attestation and its exact ceiling; keep status `PARTIAL`.
2. Add concise public wording that receipts cryptographically bind a recorded disposition to an action digest and policy/runtime metadata for calls traversing the active boundary.
3. Keep completeness, bypass, downstream-parameter equality, and behavioral compliance limitations in the same section rather than relegating them to a remote disclaimer.
4. Ensure gateway wording remains proposed/deferred and plugin/harness coverage remains graded.
5. Cross-check present-tense statements against verifier tests and `docs/CAPABILITY_STATUS.md`.
6. Run relevant document-safe tests and inspect the diff for status or assurance inflation.

**Definition of Done:**
- [x] Public docs state only the positive receipt value established by supplied evidence
- [x] Assumptions and limitations remain visible and technically exact
- [x] Conformance receipts remain `PARTIAL`
- [x] Gateway enforcement remains `PROPOSED` / upstream `DEFERRED`
- [x] Plugin and trust docs use the same attestation name
- [x] Documentation checks pass with no new linter errors

### Task 6: Bind Merkle inclusion to the exact receipt entry

**Objective:** Replace standalone proof acceptance with a versioned inclusion bundle whose entry preimage, receipt, entry hash, proof leaf, log kind, and expected root all verify as one object.

**Files:**
- Modify: `packages/protocol-core/src/receipts.ts`
- Modify: `packages/protocol-core/src/receipts.test.ts`
- Modify: `packages/protocol-core/src/index.ts`
- Modify: `packages/enforcement-core/src/receipt-log.ts`
- Modify: `packages/enforcement-core/src/receipt-log.test.ts`
- Modify: `packages/trust-core/src/receipt-verifier.ts`
- Modify: `packages/trust-core/src/receipt-verifier.test.ts`
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/tools.test.ts`
- Test: `test/conformance-receipt-e2e.test.ts`

**Steps:**
1. RED: pair valid signed receipt A with a valid proof for unrelated entry B and assert verification fails with no positive attestation.
2. RED: reject missing/wrong `logKind`, mismatched entry receipt, wrong entry hash, proof leaf unequal to entry hash, altered timestamp/previous hash, and expected-root mismatch.
3. RED: prove a bundle exported from a real receipt log recomputes the entry hash, verifies its proof, and binds to the exact supplied receipt without claiming completeness.
4. Run focused receipt-log/verifier/E2E tests and confirm the current verifier accepts an unrelated proof based only on path/root validity.
5. GREEN: define and export `ReceiptInclusionEvidenceV1` containing the minimum receipt-log entry preimage plus a typed Merkle proof; require `logKind: "conformance-receipt"`.
6. GREEN: export the bundle from receipt-log/trust tooling and have the verifier canonical-compare the supplied receipt with `entry.receipt`, recompute the entry hash, require `proof.leaf === entry.hash`, then verify path/root.
7. Deprecate standalone inclusion proof input for positive inclusion claims; it may remain parseable only as insufficient legacy evidence.
8. Run affected package tests, E2E, typechecks, and linter diagnostics.

**Definition of Done:**
- [x] Proof for entry B cannot attest receipt A
- [x] Log kind is mandatory and exact
- [x] Entry preimage and hash are recomputed by the verifier
- [x] Proof leaf equals the recomputed entry hash
- [x] Inclusion remains explicitly distinct from completeness
- [x] Target tests/typechecks pass with no new linter errors

### Task 7: Gate conclusions on validated metadata and explicit expectations

**Objective:** Emit a positive conclusion only for semantically valid receipt fields and report every requested comparison independently, with zero confidence for invalid evidence.

**Files:**
- Modify: `packages/protocol-core/src/receipts.ts`
- Modify: `packages/protocol-core/src/receipts.test.ts`
- Modify: `packages/trust-core/src/receipt-verifier.ts`
- Modify: `packages/trust-core/src/receipt-verifier.test.ts`
- Modify: `packages/trust-core/src/index.ts`
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/tools.test.ts`

**Steps:**
1. RED: reject malformed/non-64-hex `actionDigest`, invalid `issuedAt`, and partial governance mode/epoch bindings.
2. RED: assert a signed but schema/semantic-invalid receipt returns no attestation and `confidenceCeiling: 0` (or an explicit non-applicable equivalent), never Event-level `0.75`.
3. RED: add independent expected inputs for action digest, signer/agent ID, policy ID/version, implementation version, constitution hash, classifier ruleset hash, and effective config hash; assert each mismatch is separately reported.
4. RED: prove the maximum conclusion names only metadata present, signed, semantically valid, and—when an expectation was requested—matched; absent optional metadata cannot appear in the conclusion.
5. Run focused protocol/verifier/tool tests and confirm weak receipts and collapsed policy/hash state violate these cases.
6. GREEN: tighten receipt parsing for digest/date/governance-pair invariants without rejecting previously valid emitted receipts.
7. GREEN: add an attestation-eligibility validator over signed content, structured per-field comparison results, and zero/non-applicable confidence for invalid reports.
8. GREEN: build the maximum conclusion from the eligible verified field set rather than a fixed claim about constitution/classifier/configuration/runtime metadata.
9. Run affected package tests, typechecks, and linter diagnostics.

**Definition of Done:**
- [x] Weak digest/date/governance-pair receipts fail validation
- [x] Invalid reports carry no trust-elevating ceiling
- [x] Expected values are independently checked and disclosed
- [x] Conclusion text never names absent or unchecked metadata
- [x] Existing valid emitted receipts remain compatible
- [x] Target tests/typechecks pass with no new linter errors

### Task 8: Align tool output, docs, and confidence semantics

**Objective:** Make human-facing and normative wording match the remediated verifier’s exact evidence, assumptions, and ceiling.

**Files:**
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/tools.test.ts`
- Modify: `docs/governance/EVIDENCE_SEMANTICS.md`
- Modify: `docs/governance/EVIDENCE_SEMANTICS.test.ts`
- Modify: `docs/governance/examples/evidence-claims.json`
- Modify: `docs/rfc/0001-voluntary-constitutional-layer.md`
- Modify: `docs/rfc/0001-voluntary-constitutional-layer.test.ts`
- Modify: `docs/rfc/REVIEW_CHECKLIST.md`
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `README.md`
- Modify: `plugin/README.md`
- Modify: `plugin-trust/README.md`

**Steps:**
1. RED: assert valid tool text displays `proven_under_assumptions`, the evidence actually checked, and all material limitations including uncompromised runtime and bypass paths.
2. RED: assert failed reports use failure/insufficient wording, expose zero/non-applicable confidence, and never print “attested” or boundary traversal as fact.
3. RED: make documentation tests validate the positive claim row structurally—required evidence, maximum conclusion, and prohibited conclusions in the same object/row—not by document-wide word presence.
4. Run focused tool and document tests and confirm current output/docs overstate self-presented boundary evidence.
5. GREEN: format the structured verifier result with assumptions and limitations adjacent; distinguish signer-recorded receipt evidence from independently trusted boundary evidence.
6. GREEN: update evidence semantics, RFC, review checklist, capability status, and public docs so “traversed the active boundary” is conditional on trusted boundary evidence.
7. Keep receipts `PARTIAL` and gateway enforcement `PROPOSED` / upstream `DEFERRED`.
8. Run tool tests, document tests, E2E, affected suites, typecheck, and linter diagnostics.

**Definition of Done:**
- [x] Tool output states assumptions and all material limitations
- [x] Invalid output has no affirmative attestation language or nonzero ceiling
- [x] Self-presented signatures are not described as independent boundary proof
- [x] Documentation tests validate claim semantics, not keyword presence
- [x] Canonical capability statuses remain conservative
- [x] Target tests/typechecks pass with no new linter errors

### Task 9: Require anchored verification context for positive attestations

**Objective:** Emit an Event-class positive attestation only when the receipt is checked against independently supplied trusted context, and distinguish self-certified signer-key consistency from trusted signer identity.

**Files:**
- Modify: `packages/trust-core/src/receipt-verifier.ts`
- Modify: `packages/trust-core/src/receipt-verifier.test.ts`
- Modify: `packages/trust-core/src/index.ts`
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/tools.test.ts`
- Modify: `plugin-trust/src/index.ts`
- Test: `test/conformance-receipt-e2e.test.ts`
- Modify: `docs/governance/EVIDENCE_SEMANTICS.md`
- Modify: `docs/governance/EVIDENCE_SEMANTICS.test.ts`

**Steps:**
1. RED: verify a structurally valid, correctly self-signed receipt with no expected constitution/policy context and assert it may report cryptographic self-consistency but receives no Event-class positive attestation.
2. RED: provide expected constitution hash, policy ID, and policy version independently; assert all must match before `instrumented-boundary-disposition` is emitted, with separate comparison results for missing, unrequested, matched, and mismatched values.
3. RED: call `executeReceiptVerify()` without `expectedConstitutionHash` and assert the tool supplies `deps.constitutionHash`; omit expected policy context and assert the output clearly says positive attestation was withheld pending an independent policy expectation.
4. RED: verify a receipt whose embedded public key hashes to its embedded `agentId` without an independently expected agent ID; assert output says “self-certified signer key/identifier” and never “agent identity verified.”
5. RED: pass and match `expectedAgentId`; assert the report says the supplied identifier matched while still not implying legal/person identity or trusted key provenance.
6. Run focused verifier/tool/E2E tests and confirm the current all-optional expectation path and identity wording fail these cases.
7. GREEN: add an explicit trusted-verification-context/eligibility result; separate receipt validity from positive-attestation eligibility and require independently anchored constitution plus policy identity/version for the Event conclusion.
8. GREEN: default the tool’s expected constitution from trusted plugin dependencies, preserve explicit caller overrides only when policy permits, and make policy context required for positive output rather than silently trusting receipt fields.
9. GREEN: rename signature/agent checks in structured and human output to self-consistency or expected-identifier matching, retaining raw compatibility fields only with deprecation notes if needed.
10. Run affected package suites, E2E, documentation tests, typecheck, build, and linter diagnostics.

**Definition of Done:**
- [x] Unanchored self-signed receipts receive no Event-class positive attestation
- [x] Constitution, policy ID, and policy version are independently matched for positive output
- [x] Trust-plugin verification uses its configured constitution hash by default
- [x] Self-certified key consistency is not described as trusted agent identity
- [x] Structured results distinguish validity, context matching, and attestation eligibility
- [x] Focused and affected tests, E2E, docs tests, build, and typechecks pass with no new linter errors

### Task 10: Make inclusion and signer trust semantics fail closed

**Objective:** Treat Merkle verification as inclusion under an explicitly anchored root, reject malformed or unverifiable receipt-log input instead of omitting it, and prevent proof/signature mathematics from being presented as independent source trust.

**Files:**
- Modify: `packages/trust-core/src/receipt-verifier.ts`
- Modify: `packages/trust-core/src/receipt-verifier.test.ts`
- Modify: `packages/enforcement-core/src/receipt-log.ts`
- Modify: `packages/enforcement-core/src/receipt-log.test.ts`
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/tools.test.ts`
- Test: `test/conformance-receipt-e2e.test.ts`
- Modify: `docs/governance/EVIDENCE_SEMANTICS.md`
- Modify: `docs/rfc/0001-voluntary-constitutional-layer.md`
- Modify: `plugin-trust/README.md`

**Steps:**
1. RED: supply a mathematically valid proof and matching leaf under an attacker-chosen root with no independent `expectedReceiptRoot`; assert the report says `proofValidUnderClaimedRoot` but not verified/anchored inclusion and grants no higher confidence.
2. RED: supply an independently expected root that matches and then mismatches the bundle root; assert only the matched case receives `rootAnchored: true`, and the mismatch invalidates inclusion.
3. RED: insert malformed JSON, wrong-kind entries, broken canonical hashes, chain gaps, invalid signatures, and duplicate/mixed receipt entries into a receipt log; assert root/proof generation fails closed with an indexed diagnostic instead of silently skipping data.
4. RED: prove proof export distinguishes the locally calculated root from an independently trusted checkpoint and does not label its own returned root authoritative.
5. RED: assert human and structured output separates signature validity, self-certified signer binding, exact-entry proof validity, root anchoring, and log completeness.
6. Run focused receipt-log/verifier/tool tests and confirm the current claimed-root acceptance and skip-on-parse behavior fail these cases.
7. GREEN: replace permissive leaf collection with a strict typed receipt-log parser that validates every relevant line, canonical hash, previous-hash link, signature, and duplicate/index invariant before deriving leaves.
8. GREEN: require an independently supplied expected root/checkpoint for `inclusionVerified`; retain a lower-level proof-math result for compatibility without trust elevation.
9. GREEN: update proof export, attestation text, RFC, and evidence documentation to say “inclusion under supplied root” unless root anchoring is independently established, and repeat that neither inclusion nor signature proves completeness or signer trust.
10. Run focused suites, affected package suites, E2E, docs tests, typecheck, build, and linter diagnostics.

**Definition of Done:**
- [x] A caller-controlled root cannot produce anchored inclusion
- [x] Malformed or unverifiable receipt-log input fails root/proof generation closed
- [x] Exact-entry proof validity and independent root anchoring are separate fields
- [x] Signature validity and signer trust are separate fields
- [x] Tool and documentation wording matches the structured trust distinctions
- [x] Focused and affected tests, E2E, docs tests, build, and typechecks pass with no new linter errors

### Task 11: Preserve allowed unsigned-degraded receipt-log entries

**Objective:** Permit structurally valid `unsigned-degraded`, non-trust-elevating receipts to remain in the append-only Merkle log while continuing to reject malformed, tampered, or unsupported receipt entries.

**Files:**
- Modify: `packages/trust-core/src/receipt-verifier.ts`
- Modify: `packages/trust-core/src/receipt-verifier.test.ts`

**Steps:**
1. RED: write an unsigned-degraded receipt followed by a valid signed receipt and assert root and exact-entry inclusion-evidence export succeed for the signed entry.
2. GREEN: distinguish an allowed degraded receipt from an invalid signature when validating strict log entries; keep structural, hash-chain, and entry-hash validation mandatory.
3. Run focused trust-core tests, package typecheck, and linter diagnostics.

**Definition of Done:**
- [x] A valid unsigned-degraded entry remains a Merkle leaf
- [x] A later valid signed entry can produce a root and inclusion evidence
- [x] Invalid signed or malformed entries still reject proof export
- [x] Focused trust-core tests and typecheck pass with no new linter errors

### Task 12: Cover receipt roots through proof and capsule tools

**Objective:** Prove the trust-plugin proof-export and capsule surfaces remain usable with a mixed signed/degraded receipt log, without weakening failure behavior for malformed evidence.

**Files:**
- Modify: `plugin-trust/src/tools.test.ts`

**Steps:**
1. RED: provide a receipt log containing an allowed unsigned-degraded entry followed by a signed entry, then assert proof export and capsule offer return structured results.
2. GREEN: rely on strict receipt-log validation that retains only the explicitly allowed degraded form as a non-trust-elevating leaf.
3. Run focused trust-plugin tests, package typecheck, and linter diagnostics.

**Definition of Done:**
- [x] Proof export works for a later signed entry in a mixed valid/degraded log
- [x] Capsule offer exposes the mixed-log root without throwing
- [x] Focused trust-plugin tests and typecheck pass with no new linter errors

## Testing Strategy

### RED evidence

```bash
npx tsx --test packages/trust-core/src/receipt-verifier.test.ts
npx tsx --test plugin-trust/src/tools.test.ts
npx tsx --test test/conformance-receipt-e2e.test.ts
npx tsx --test docs/governance/EVIDENCE_SEMANTICS.test.ts
npx tsx --test docs/rfc/0001-voluntary-constitutional-layer.test.ts
```

New tests must fail because the positive attestation and wording are absent, not because existing receipt fixtures are invalid.

### GREEN and regression evidence

```bash
npm test -w @ovrsr/fpp-trust-core
npm test -w @ovrsr/openclaw-fpp-trust
npx tsx --test test/conformance-receipt-e2e.test.ts
npm run test:scripts
npm run typecheck
```

Verification must inspect both positive output and prohibited conclusions. A test that only searches for the new label is insufficient.

## Risks & Mitigations

- **Marketing language outruns evidence:** Generate the maximum conclusion only from semantically valid, signed, and explicitly checked fields; keep assumptions and limitations adjacent.
- **New claim-class confusion:** Retain `claimClass: "event"`; the new value is an attestation kind, not a seventh class.
- **Invalid receipt gets affirmative output:** Populate the attestation only after all requested checks succeed and return zero/non-applicable confidence otherwise.
- **Unrelated Merkle proof accepted:** Require a typed receipt-log entry preimage, recomputed entry hash, exact proof leaf, typed log kind, and expected root.
- **Merkle inclusion mistaken for completeness:** Report bound inclusion separately and repeat that a claimed root does not prove all events were logged.
- **Action digest mistaken for execution equality:** Explicitly state it binds parameters seen by the instrumented boundary, not necessarily downstream invocation.
- **Gateway status inflation:** Keep gateway RFC proposed/deferred and scope present-tense claims to shipped plugin/harness receipt verification.
- **All expectations omitted:** Separate cryptographic receipt validity from positive-attestation eligibility and require independently supplied constitution/policy context.
- **Self-certification presented as identity trust:** Describe key-to-identifier derivation as self-consistency unless an expected identifier and trusted key source are supplied.
- **Attacker-chosen Merkle root:** Expose proof validity under a claimed root separately and require an independent expected checkpoint before calling inclusion anchored.
- **Malformed lines disappear from the tree:** Fail root/proof construction with a location-specific diagnostic; never skip malformed ledger input.

## Handoff

Review the attestation name, maximum conclusion, and explicit non-claims. After approval, run:

`/implement docs/plans/2026-07-20-3-boundary-disposition-attestation.md`
