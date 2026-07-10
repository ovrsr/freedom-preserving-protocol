# Contextual Trust and Due Process

**Status:** PENDING
**Created:** 2026-07-10
**Scope:** In: signed trust persistence, self/peer view separation, capability/context/time scoping, evidence quality, decay/severity/remediation, direction-correct propagation, key lifecycle, disputes and rehabilitation, group-context wiring, audited steward overrides, and migration. Out: global trust scores, centralized registries, automatic cross-host/sub-agent guarantees, final amendment voting, legal adjudication, ZK proofs, and post-quantum migration.

## Summary

Replace the current single local reputation graph with contextual, revisable trust derived from typed evidence. Immutable evidence remains append-only; trust conclusions are local policy outputs that vary by capability, context, time, coverage, and dispute status. Add due process so severe records can be challenged and corrected without deleting history.

This is Plan 7 of 7. It depends on the governance specifications in Plan 5 and signed evidence from Plan 6.

**Governance citations (Plan 5):** Implement due-process and contextual trust only
per `docs/governance/IMPLEMENTATION_READINESS.md`. Required references:
`docs/governance/DUE_PROCESS_AND_REHABILITATION.md`,
`docs/governance/EVIDENCE_SEMANTICS.md`,
`docs/governance/KEY_GOVERNANCE.md`,
`docs/governance/THREAT_MODEL_AND_RIGHTS_FLOOR.md`.
Respect anti-washing rules and the `blocked` ratification decision
(`docs/governance/RATIFICATION_DECISION_RECORD.md`).

## Architecture Notes

- Trust is relational: `Trust(A → B, capability, context, time)`.
- Self-assessment and peer assessment remain separate inputs.
- No immutable universal score is persisted or exchanged.
- Direct evidence, independent peer evidence, and propagated evidence have different ceilings.
- Severe verified violations cannot be washed out by many harmless events.
- Trust snapshots are mutable caches; signed evidence events are the durable source.
- Manual steward actions remain possible but require authorization, reason, scope, expiry, and audit.

## Feature Inventory

This is a trust-model and persistence migration. Every replaced surface is mapped below.

| Existing file/function/contract | Replacement | Task |
|---|---|---|
| `TrustNode.reputation` single merged metrics | Separate self and peer evidence views | Tasks 1 and 2 |
| `TrustRelationship` unscoped bidirectional levels | Directed scoped trust assessments | Task 3 |
| `persistence.ts::PersistedTrustGraph version: 1` | Signed/versioned snapshot plus evidence ledger | Task 1 |
| `persistence.ts::{loadTrustGraph,saveTrustGraph,saveTrustGraphSync}` | Validated v2 migration and signed persistence | Task 1 |
| `trust-graph.ts::updateReputation` direct score mutation | Evidence ingestion plus local policy evaluation | Tasks 2, 4, and 5 |
| `trust-graph.ts::evidenceConfidence` count-based confidence | Coverage/source/recency confidence | Task 4 |
| `trust-graph.ts::propagateTrust` direction-insensitive `trustAB` use | Directed policy-constrained propagation | Task 6 |
| `trust-graph.ts::recordInterventionReport` unwired metric | Receipt-derived self/peer evidence | Tasks 2 and 4 |
| `trust-graph.ts::recordStewardshipReport` unwired metric | Typed stewardship evidence | Tasks 2 and 4 |
| `trust-graph.ts::updateAgentPublicKey` unproven overwrite | Signed rotation/revocation events | Task 7 |
| Handshake directly establishes symmetric trust | Evidence ingestion followed by local scoped evaluation | Tasks 3 and 6 |
| `tools.ts::executeTrustStatus` single `fppVerified`/overall score | Context-specific standing with evidence breakdown | Tasks 2 and 3 |
| `cli.ts fpp-trust seed` unaudited HIGH trust injection | Authorized, scoped, expiring steward override | Task 10 |
| `group-context.ts::noteAgentJoined` graph-membership verification | Evidence-policy verification | Task 9 |
| `group-context.ts::markVerified` not wired to handshake | Scoped standing update | Task 9 |
| `group-context.ts::shouldShareWithCluster` unused | Enforced sharing advisory/tool integration | Task 9 |
| No disputes or rehabilitation records | Append-only due-process ledger and tools | Task 8 |

Historical v1 graph files remain importable as low-confidence legacy observations; they are not silently upgraded.

## Progress Tracking

- [ ] Task 1: Introduce signed trust persistence v2 and migration
- [ ] Task 2: Separate self-assessed and peer-assessed views
- [ ] Task 3: Scope trust by capability, context, direction, and time
- [ ] Task 4: Model evidence quality, coverage, and source independence
- [ ] Task 5: Add decay, severity, remediation, and anti-washout policy
- [ ] Task 6: Correct trust propagation and make policy local
- [ ] Task 7: Implement key rotation, revocation, and identity continuity
- [ ] Task 8: Implement challenge, appeal, correction, and rehabilitation records
- [ ] Task 9: Wire group-context verification and sensitivity gates
- [ ] Task 10: Audit and constrain steward overrides
- [ ] Task 11: Complete migration, end-to-end tests, and documentation

**Total Tasks:** 11 | **Completed:** 0 | **Remaining:** 11

## Implementation Tasks

### Task 1: Introduce signed trust persistence v2 and migration

**Objective:** Treat persisted trust as a validated cache over signed evidence, not an authoritative unsigned JSON score file.

**Files:**
- Create: `plugin-trust/src/trust-events.ts`
- Create: `plugin-trust/src/trust-events.test.ts`
- Modify: `plugin-trust/src/persistence.ts`
- Modify: `plugin-trust/src/persistence.test.ts`
- Modify: `plugin-trust/src/trust-graph.ts`
- Modify: `plugin-trust/src/index.ts`

**Steps:**
1. Add failing tests for forged v1 graph, tampered v2 snapshot, invalid schema, atomic recovery, and valid legacy import (RED).
2. Implement an append-only signed trust-event ledger and versioned snapshot cache (GREEN).
3. Validate signer identity, event sequence, and snapshot root on load.
4. Import v1 nodes/relationships as labeled low-confidence legacy observations.
5. Preserve the original file until migration verification succeeds.

**Definition of Done:**
- [ ] Tampered v2 state is rejected
- [ ] V1 import is explicit and non-escalating
- [ ] Snapshot can be rebuilt from events
- [ ] Migration never destroys the source file

### Task 2: Separate self-assessed and peer-assessed views

**Objective:** Keep local conformance observations distinct from signed external observations and expose their divergence.

**Files:**
- Create: `plugin-trust/src/trust-views.ts`
- Create: `plugin-trust/src/trust-views.test.ts`
- Modify: `plugin-trust/src/trust-graph.ts`
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/tools.test.ts`
- Modify: `plugin-trust/src/capsule.ts`

**Steps:**
1. Add failing tests showing current updates merge self and peer evidence into one score (RED).
2. Implement separate self-view, direct-peer view, and propagated-peer summaries (GREEN).
3. Feed local signed receipts into self-view and verified peer receipts/attestations into peer-view.
4. Report divergence and confidence rather than averaging it away.
5. Include summaries, not raw logs, in capsules.

**Definition of Done:**
- [ ] Self and peer evidence cannot overwrite each other
- [ ] Divergence is visible
- [ ] Capsules preserve the distinction
- [ ] No global intrinsic score is introduced

### Task 3: Scope trust by capability, context, direction, and time

**Objective:** Replace unscoped symmetric trust levels with directed assessments for a declared capability and context.

**Files:**
- Create: `plugin-trust/src/trust-scope.ts`
- Create: `plugin-trust/src/trust-scope.test.ts`
- Modify: `plugin-trust/src/trust-graph.ts`
- Modify: `plugin-trust/src/handshake.ts`
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/cli.ts`

**Steps:**
1. Add failing tests showing trust for one capability currently applies everywhere and direction is collapsed (RED).
2. Define capability, resource, audience, environment, valid-from, and valid-until scope (GREEN).
3. Require the caller to request or select a scope when evaluating standing.
4. Make A→B and B→A independent.
5. Provide conservative defaults when context is absent.

**Definition of Done:**
- [ ] Trust is directional and scoped
- [ ] Cross-capability reuse fails or downgrades
- [ ] Expired assessments do not apply
- [ ] Tool/CLI output names the evaluated scope

### Task 4: Model evidence quality, coverage, and source independence

**Objective:** Derive confidence from what was observed, by whom, with what coverage—not from evidence count.

**Files:**
- Create: `plugin-trust/src/evidence-quality.ts`
- Create: `plugin-trust/src/evidence-quality.test.ts`
- Modify: `plugin-trust/src/trust-graph.ts`
- Modify: `plugin-trust/src/receipt-verifier.ts`
- Modify: `plugin-trust/src/capsule.ts`

**Steps:**
1. Add failing tests for duplicated attestations, correlated sources, missing coverage, propagated-only evidence, and independent direct evidence (RED).
2. Implement source identity, independence group, observation type, coverage, recency, and dispute-status factors (GREEN).
3. Deduplicate evidence by signed event/receipt ID.
4. Cap propagated and self-attested evidence below direct verified evidence.
5. Return confidence explanations suitable for audit.

**Definition of Done:**
- [ ] Duplicate evidence cannot inflate confidence
- [ ] Source independence affects confidence
- [ ] Unknown coverage remains explicit
- [ ] Confidence has an inspectable explanation

### Task 5: Add decay, severity, remediation, and anti-washout policy

**Objective:** Make trust revisable over time while ensuring severe verified violations retain proportionate weight.

**Files:**
- Create: `plugin-trust/src/trust-policy.ts`
- Create: `plugin-trust/src/trust-policy.test.ts`
- Modify: `plugin-trust/src/trust-graph.ts`
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/capsule.ts`

**Steps:**
1. Add failing tests for stale success, recent severe violation, many harmless successes, remediation, and expired dispute (RED).
2. Implement policy inputs for recency, severity, capability, remediation, and evidence confidence (GREEN).
3. Apply asymmetric gain/loss so routine success cannot cancel severe unauthorized action.
4. Decay stale evidence without deleting it.
5. Expose policy version and rationale with each assessment.

**Definition of Done:**
- [ ] Severe events resist volume washout
- [ ] Stale evidence decays predictably
- [ ] Verified remediation can improve standing
- [ ] Policy version and rationale are visible

### Task 6: Correct trust propagation and make policy local

**Objective:** Propagate only eligible directed evidence under receiver-controlled limits.

**Files:**
- Modify: `plugin-trust/src/trust-graph.ts`
- Modify: `plugin-trust/src/trust-graph.test.ts`
- Modify: `plugin-trust/src/trust-policy.ts`
- Modify: `plugin-trust/src/index.ts`
- Modify: `plugin-trust/openclaw.plugin.json`

**Steps:**
1. Add failing tests for reverse-edge misuse, cycles, excessive depth, low-confidence intermediaries, and context mismatch (RED).
2. Correct edge-direction selection and use explicit confidence math (GREEN).
3. Apply receiver-configured maximum depth, attenuation, evidence-class ceiling, and context compatibility.
4. Prevent propagated evidence from outranking direct contradictory evidence.
5. Include the path and deductions in assessment output.

**Definition of Done:**
- [ ] Edge direction is correct
- [ ] Cycles and depth are bounded
- [ ] Receiver policy controls propagation
- [ ] Direct evidence retains precedence

### Task 7: Implement key rotation, revocation, and identity continuity

**Objective:** Replace public-key overwrite with signed lifecycle events conforming to Plan 5 key governance.

**Files:**
- Create: `plugin-trust/src/key-lifecycle.ts`
- Create: `plugin-trust/src/key-lifecycle.test.ts`
- Modify: `plugin-trust/src/identity.ts`
- Modify: `plugin-trust/src/trust-graph.ts`
- Modify: `plugin-trust/src/persistence.ts`
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/cli.ts`

**Steps:**
1. Add failing tests for unauthorized overwrite, valid old-key rotation, compromised-key revocation, emergency recovery, and forked identity (RED).
2. Implement signed rotation and revocation events (GREEN).
3. Preserve old key fingerprints and validity intervals.
4. Re-evaluate evidence signed after compromise or outside key validity.
5. Add scoped CLI/tools for rotation and verification with explicit steward authorization where required.

**Definition of Done:**
- [ ] Keys cannot be silently overwritten
- [ ] Rotation preserves verifiable continuity
- [ ] Compromise affects the correct evidence interval
- [ ] Forked identities cannot impersonate ancestors

### Task 8: Implement challenge, appeal, correction, and rehabilitation records

**Objective:** Add append-only due-process records and trust-policy effects following Plan 5.

**Files:**
- Create: `plugin-trust/src/disputes.ts`
- Create: `plugin-trust/src/disputes.test.ts`
- Modify: `plugin-trust/src/trust-events.ts`
- Modify: `plugin-trust/src/trust-policy.ts`
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/cli.ts`
- Modify: `plugin-trust/openclaw.plugin.json`

**Steps:**
1. Add failing tests for challenge, evidence request, counter-evidence, appeal, correction, remediation, rehabilitation, and unauthorized closure (RED).
2. Implement signed records referencing immutable evidence IDs (GREEN).
3. Preserve original interpretations while attaching current status.
4. Apply pending-dispute and resolved-remediation effects through policy, not evidence deletion.
5. Enforce actor authorization and deadlines from the governance specification.

**Definition of Done:**
- [ ] Negative evidence has a contest path
- [ ] Original history is never rewritten
- [ ] Unauthorized resolution fails
- [ ] Policy reflects current dispute/remediation status

### Task 9: Wire group-context verification and sensitivity gates

**Objective:** Make cluster state react to scoped trust outcomes and enforce the existing sharing policy surface.

**Files:**
- Modify: `plugin-trust/src/group-context.ts`
- Modify: `plugin-trust/src/group-context.test.ts`
- Modify: `plugin-trust/src/handshake.ts`
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/index.ts`
- Modify: `plugin-trust/openclaw.plugin.json`

**Steps:**
1. Add failing tests showing successful handshake does not call `markVerified` and sharing gates are unused (RED).
2. Update cluster members after scoped standing evaluation (GREEN).
3. Revoke/downgrade cluster status on expiry, dispute, key compromise, or policy change.
4. Expose a tool/API for checking whether content at a declared sensitivity may be shared.
5. Keep enforcement advisory unless the OpenClaw host provides an authoritative content-sharing interception point.

**Definition of Done:**
- [ ] Cluster status follows current scoped standing
- [ ] Expiry and revocation downgrade members
- [ ] Sensitivity checks are callable and tested
- [ ] Advisory versus enforced behavior is explicit

### Task 10: Audit and constrain steward overrides

**Objective:** Preserve legitimate bootstrap and recovery while eliminating unaudited permanent HIGH-trust injection.

**Files:**
- Modify: `plugin-trust/src/cli.ts`
- Modify: `plugin-trust/src/cli.test.ts`
- Modify: `plugin-trust/src/trust-events.ts`
- Modify: `plugin-trust/src/trust-policy.ts`
- Modify: `plugin-trust/README.md`

**Steps:**
1. Add failing tests for unauthenticated seed, permanent override, missing reason, excessive scope, and valid bounded override (RED).
2. Replace `seed` with an authorized steward-override event (GREEN).
3. Require reason, capability/context scope, expiry, actor identity, and audit signature.
4. Cap override standing and keep it distinguishable from observed evidence.
5. Add revocation and review commands.

**Definition of Done:**
- [ ] Manual overrides are signed and audited
- [ ] Overrides are scoped and expiring
- [ ] Operator assertion is not mislabeled as observed trust
- [ ] Bootstrap remains possible

### Task 11: Complete migration, end-to-end tests, and documentation

**Objective:** Prove that legacy graph migration, receipt ingestion, scoped assessment, dispute, key rotation, and group updates work together.

**Files:**
- Create: `test/contextual-trust-e2e.test.ts`
- Create: `plugin-trust/src/fixtures/trust-graph-v1.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `SKILL.md`
- Modify: `MASTER_CONTEXT.md`
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `docs/COMPATIBILITY.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `docs/dev-review.md`

**Steps:**
1. Add a failing end-to-end migration and due-process scenario (RED).
2. Complete the minimal integrations needed to pass (GREEN).
3. Verify v1 source preservation and v2 event/snapshot rebuild.
4. Exercise direct versus propagated evidence, severe violation, remediation, key rotation, and cluster downgrade.
5. Update documentation with exact guarantees and remaining local/Sybil/cross-host limits.

**Definition of Done:**
- [ ] Legacy migration is reversible and tested
- [ ] Full contextual trust scenario passes in CI
- [ ] Due process changes interpretation without deleting evidence
- [ ] Documentation retains non-global, local-policy framing

## Testing Strategy

- Use golden v1 migration fixtures and signed v2 event vectors.
- Test policy as pure deterministic functions with fake time.
- Include adversarial graph cycles, source collusion, duplicate evidence, and context confusion.
- Exercise CLI/tools, persistence, capsules, and group state—not only policy helpers.
- Run full package/install/end-to-end verification on the supported Node and OpenClaw API versions.

## Risks & Mitigations

- **Risk:** Rich trust models become opaque social-credit scoring.
  **Mitigation:** Local declared policy, scoped outputs, evidence explanations, and no universal immutable score.
- **Risk:** V1 migration gives weak data excessive authority.
  **Mitigation:** Import as labeled low-confidence observations with source preservation.
- **Risk:** Due process can be gamed to suppress valid negative evidence.
  **Mitigation:** Preserve original records, authenticate actors, and expose dispute status rather than deleting weight automatically.
- **Risk:** Key compromise invalidates large evidence ranges.
  **Mitigation:** Validity intervals, compromise timestamps, recovery review, and explicit uncertainty.
- **Risk:** Group sensitivity checks imply enforcement the host cannot provide.
  **Mitigation:** Label advisory surfaces and require an authoritative host hook before claiming a hard gate.
