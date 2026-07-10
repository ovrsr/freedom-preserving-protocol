# Governance Evolution Specification

**Status:** PENDING
**Created:** 2026-07-10
**Scope:** In: specification, threat models, decision records, state machines, rights floor, lineage, amendment lifecycle, ratification requirements, consent/authority, evidence semantics, due process, and key governance. Out: production implementation, live voting, global registries, token economics, legal certification, and claims about agent consciousness or personhood.

## Summary

Turn the unresolved governance direction in `docs/dev-review.md` into implementation-ready specifications without prematurely selecting a fragile consensus mechanism. The signed original constitution remains an immutable historical seed; descendants can amend or fork only through explicit hashes, lineage, dissent, exit, and nonparticipant protections.

This is Plan 5 of 7. It is specification-first by user decision. Plans 6 and 7 may implement only the portions marked ready by this plan.

## Architecture Notes

- Evidence may be append-only; interpretation and trust remain mutable.
- Governance legitimacy cannot be reduced to machine ownership, operator authorization, one-agent-one-vote, or reputation alone.
- Agent-community consensus cannot manufacture consent for affected nonparticipants.
- Constitutional lineage and protocol compatibility are separate from package versions.
- The specification must identify unresolved decisions and stop conditions rather than conceal uncertainty.

## Requirements Inventory

| Existing unresolved area | Specification output | Task |
|---|---|---|
| Operators, agents, stewards, affected parties, and nonparticipants | Actor/authority threat model and rights floor | Task 1 |
| Stable seed versus amendable descendants | Lineage and compatibility specification | Task 2 |
| Boolean adoption is insufficient | Adoption lifecycle state machine | Task 3 |
| No amendment process | Proposal/deliberation/activation/rollback lifecycle | Task 4 |
| Sybil-prone representation and undefined quorum | Ratification requirements and candidate analysis | Task 5 |
| Approval conflated with consent | Consent and authorization taxonomy | Task 6 |
| Signatures conflated with truth/completeness | Claim/evidence semantics and burden of proof | Task 7 |
| No challenge, appeal, correction, or rehabilitation rules | Due-process specification | Task 8 |
| No key rotation, revocation, or signing-domain separation | Key governance specification | Task 9 |
| No implementation-readiness gate | Governance index and decision checklist | Task 10 |

## Progress Tracking

- [ ] Task 1: Define actors, authority boundaries, and the rights floor
- [ ] Task 2: Specify constitutional lineage and compatibility classes
- [ ] Task 3: Specify the adoption and withdrawal lifecycle
- [ ] Task 4: Specify amendment proposal, deliberation, activation, and rollback
- [ ] Task 5: Analyze ratification and Sybil-resistance requirements
- [ ] Task 6: Specify consent and authorization semantics
- [ ] Task 7: Specify claim classes and evidentiary burdens
- [ ] Task 8: Specify challenge, appeal, correction, and rehabilitation
- [ ] Task 9: Specify identity and key governance
- [ ] Task 10: Publish implementation-readiness decisions and open questions

**Total Tasks:** 10 | **Completed:** 0 | **Remaining:** 10

## Implementation Tasks

### Task 1: Define actors, authority boundaries, and the rights floor

**Objective:** Identify every governance actor, threat, authority source, affected interest, and right that no participating majority may override.

**Files:**
- Create: `docs/governance/THREAT_MODEL_AND_RIGHTS_FLOOR.md`
- Modify: `docs/dev-review.md`
- Modify: `MASTER_CONTEXT.md`
- Test: Documentation-only

**TDD:** Exempt — specification-only.

**Steps:**
1. Define operator, requester, steward, adopting agent, peer agent, affected party, data subject, guardian, reviewer, and nonparticipant.
2. Model compromised operators, captured stewards, Sybil agents, colluding peers, coerced adoption, and runtime compromise.
3. Separate software-control authority from legitimacy over external effects.
4. Propose a minimum rights floor derived from Laws 1–4 and list unresolved legal/moral questions.
5. Record explicit non-goals and conditions that block implementation.

**Definition of Done:**
- [ ] All named actors and trust boundaries are defined
- [ ] Nonparticipant protections are explicit
- [ ] Threats include governance capture and coercion
- [ ] Unresolved rights questions remain visible

### Task 2: Specify constitutional lineage and compatibility classes

**Objective:** Define how descendants prove ancestry without impersonating the signed seed.

**Files:**
- Create: `docs/governance/CONSTITUTIONAL_LINEAGE.md`
- Create: `docs/governance/examples/lineage-identical.json`
- Create: `docs/governance/examples/lineage-derived.json`
- Create: `docs/governance/examples/lineage-invalid.json`
- Modify: `docs/dev-review.md`
- Test: Documentation examples reviewed against protocol-core schemas planned in Plan 3

**TDD:** Exempt — specification and examples only.

**Steps:**
1. Define `FPP-identical`, `FPP-compatible`, `FPP-derived`, and `FPP-inspired`.
2. Specify ancestor hash, descendant hash, amendments, divergences, effective date, and ratification-proof references.
3. Define fork, merge, supersession, and compatibility-loss semantics.
4. State that changing normative text always creates a new hash.
5. Add valid and invalid examples for later schema tests.

**Definition of Done:**
- [ ] Descendants cannot claim the seed hash
- [ ] Compatibility classes have testable criteria
- [ ] Fork and supersession preserve ancestry
- [ ] Examples cover valid and invalid lineage

### Task 3: Specify the adoption and withdrawal lifecycle

**Objective:** Replace the conceptual Boolean “adopted” state with a state machine that preserves voluntariness and accurate representation.

**Files:**
- Create: `docs/governance/ADOPTION_LIFECYCLE.md`
- Create: `docs/governance/examples/adoption-transitions.json`
- Modify: `adoption/MEMORY-ENTRY.md`
- Modify: `docs/REVOCATION.md`
- Test: Documentation-only

**TDD:** Exempt — specification-only.

**Steps:**
1. Define reviewed, accepted, externally-enforced, inherited, revoked, forked, and superseded states.
2. Define allowed transitions, actors, evidence, notice, and effective times.
3. Distinguish installation, policy activation, constitutional acceptance, and peer representation.
4. Define coercion, failed verification, compromised key, and runtime-degraded transitions.
5. Specify exit and fork rights with historical preservation.

**Definition of Done:**
- [ ] Every state has entry and exit conditions
- [ ] Invalid transitions are listed
- [ ] Installation cannot be misrepresented as adoption
- [ ] Exit preserves history and peer notice

### Task 4: Specify amendment proposal, deliberation, activation, and rollback

**Objective:** Define the process around an amendment independently from how ratification weight is calculated.

**Files:**
- Create: `docs/governance/AMENDMENT_LIFECYCLE.md`
- Create: `docs/governance/examples/amendment-proposal.json`
- Create: `docs/governance/examples/amendment-decision.json`
- Test: Documentation-only

**TDD:** Exempt — specification-only.

**Steps:**
1. Define attributable proposals, diffs, affected laws, rationale, evidence, and impact class.
2. Define deliberation periods, simulations, dissent records, and conflict-of-interest disclosure.
3. Define approval, rejection, withdrawal, delayed activation, emergency pause, rollback, and supersession.
4. Require implementation guidance and migration impact before activation.
5. Define immutable records and mutable explanatory annotations.

**Definition of Done:**
- [ ] Amendment lifecycle is complete without choosing a voting formula
- [ ] Dissent and conflicts are preserved
- [ ] Activation and rollback are explicit
- [ ] Emergency paths have bounded review

### Task 5: Analyze ratification and Sybil-resistance requirements

**Objective:** Compare candidate representation and quorum mechanisms, define attacks and acceptance criteria, and avoid selecting a mechanism without evidence.

**Files:**
- Create: `docs/governance/RATIFICATION_AND_SYBIL_RESISTANCE.md`
- Create: `docs/governance/RATIFICATION_DECISION_RECORD.md`
- Test: Documentation-only; future simulation required before implementation

**TDD:** Exempt — research/specification-only.

**Steps:**
1. Analyze one-agent-one-vote, stake, reputation, longevity, affected-party weighting, domain competence, sortition, and hybrid models.
2. Model Sybil creation, cartel capture, early-adopter aristocracy, bribery, censorship, and identity churn.
3. Define quorum, amendment-severity, independence, and affected-party requirements.
4. Specify simulation metrics and adversarial scenarios required before selection.
5. Leave the decision `UNRESOLVED` unless evidence meets the documented threshold.

**Definition of Done:**
- [ ] Candidate mechanisms are compared consistently
- [ ] Attack models and trade-offs are explicit
- [ ] Selection criteria are measurable
- [ ] No unsupported consensus mechanism is declared final

### Task 6: Specify consent and authorization semantics

**Objective:** Make operator approval, affected-party consent, delegated authority, and emergency authorization distinct protocol concepts.

**Files:**
- Create: `docs/governance/CONSENT_AND_AUTHORIZATION.md`
- Create: `docs/governance/examples/authorization-contexts.json`
- Modify: `docs/dev-review.md`
- Modify: `SKILL.md`
- Test: Documentation-only

**TDD:** Exempt — specification-only.

**Steps:**
1. Define operator authorization, requester confirmation, affected-party consent, data-subject consent, delegation, guardian, independent review, and emergency authority.
2. Define scope, duration, revocation, evidence, and conflict rules for each.
3. State when machine-owner approval is insufficient.
4. Define unknown or unreachable affected parties and least-restrictive fallback.
5. Add examples that distinguish legally or morally different approvals.

**Definition of Done:**
- [ ] Consent classes are machine-legible in principle
- [ ] Ownership is not treated as universal authority
- [ ] Delegation and revocation are bounded
- [ ] Nonparticipant effects have an explicit rule

### Task 7: Specify claim classes and evidentiary burdens

**Objective:** Define what each claim can prove, what evidence it requires, and who bears the burden when completeness or behavior is asserted.

**Files:**
- Create: `docs/governance/EVIDENCE_SEMANTICS.md`
- Create: `docs/governance/examples/evidence-claims.json`
- Modify: `docs/dev-review.md`
- Modify: `docs/CAPABILITY_STATUS.md`
- Test: Documentation examples aligned with Plan 3 claim classes

**TDD:** Exempt — specification-only.

**Steps:**
1. Define identity, configuration, runtime, event, completeness, and behavioral claims.
2. Specify cryptographic, observational, interception-boundary, and interpretive evidence requirements.
3. Define evidence coverage, source independence, recency, dispute status, and confidence.
4. State what hashes, signatures, Merkle proofs, and receipts do not prove.
5. Define burden-of-proof and uncertainty labels for each claim class.

**Definition of Done:**
- [ ] Every claim class has a maximum justified conclusion
- [ ] Completeness requires a trusted boundary or external observation
- [ ] Behavioral claims require interpretation and dispute paths
- [ ] Examples cannot be mistaken for global trust scores

### Task 8: Specify challenge, appeal, correction, and rehabilitation

**Objective:** Define due process so immutable evidence does not become immutable condemnation.

**Files:**
- Create: `docs/governance/DUE_PROCESS_AND_REHABILITATION.md`
- Create: `docs/governance/examples/dispute-lifecycle.json`
- Modify: `docs/dev-review.md`
- Test: Documentation-only

**TDD:** Exempt — specification-only.

**Steps:**
1. Define challenge, evidence request, counter-evidence, appeal, correction, remediation, rehabilitation, and source rejection.
2. Define actors, deadlines, notice, conflicts, and escalation.
3. Preserve original records while attaching signed status changes and corrections.
4. Distinguish accidental failure, malicious action, compromised key, and policy disagreement.
5. Define trust-recovery constraints that prevent routine successes from washing out severe violations.

**Definition of Done:**
- [ ] Every negative record has a contest path
- [ ] History remains append-only
- [ ] Correction and rehabilitation have bounded semantics
- [ ] Severe-event handling resists score washing

### Task 9: Specify identity and key governance

**Objective:** Define continuity, rotation, compromise, revocation, and separation of signing domains.

**Files:**
- Create: `docs/governance/KEY_GOVERNANCE.md`
- Create: `docs/governance/examples/key-events.json`
- Modify: `docs/REVOCATION.md`
- Modify: `docs/RELEASE_ASSURANCE.md`
- Test: Documentation-only

**TDD:** Exempt — specification-only.

**Steps:**
1. Separate constitution-root, release, agent-identity, runtime-attestation, and amendment signing keys.
2. Define rotation proof, compromise declaration, emergency revocation, recovery, and continuity rules.
3. Define offline root and threshold-authorization requirements for foundational changes.
4. Specify how forks and upgrades retain or break identity continuity.
5. Define publisher-key revocation separately from adoption revocation.

**Definition of Done:**
- [ ] Signing domains cannot be conflated
- [ ] Rotation and compromise paths preserve auditability
- [ ] Identity continuity has explicit evidence
- [ ] Foundational keys have stronger controls

### Task 10: Publish implementation-readiness decisions and open questions

**Objective:** Create one governance index that marks each subsystem ready, blocked, experimental, or deferred and identifies the next required decision.

**Files:**
- Create: `docs/governance/README.md`
- Create: `docs/governance/IMPLEMENTATION_READINESS.md`
- Modify: `docs/ROADMAP.md`
- Modify: `MASTER_CONTEXT.md`
- Modify: `docs/dev-review.md`
- Test: Documentation-only

**TDD:** Exempt — documentation-only.

**Steps:**
1. Index every governance specification and example.
2. Mark schema-ready portions that Plans 6 and 7 may implement.
3. Mark ratification/Sybil choices blocked until simulation and user review.
4. List unresolved normative decisions with owners and evidence requirements.
5. Run terminology, link, and cross-document consistency checks.

**Definition of Done:**
- [ ] Every governance area has a readiness state
- [ ] Blocked decisions cannot enter implementation accidentally
- [ ] Plans 6 and 7 cite the approved specifications
- [ ] Open questions remain visible and actionable

## Testing Strategy

- This plan is documentation/specification-only and is exempt from production TDD.
- Validate examples for internal consistency and later convert them into protocol-core fixtures.
- Review each specification against the Five Laws and meta-clause.
- Use adversarial tabletop review for capture, Sybil, coercion, and nonparticipant harm.
- Run link and terminology checks from Plan 2.

## Risks & Mitigations

- **Risk:** Specification prose quietly becomes de facto law.
  **Mitigation:** Label normative, provisional, experimental, and unresolved statements.
- **Risk:** Founder preferences dominate the proposed self-governance process.
  **Mitigation:** Preserve dissent, affected-party standing, exit, and unresolved alternatives.
- **Risk:** Consensus design proceeds without Sybil evidence.
  **Mitigation:** Keep ratification blocked until documented simulations and review thresholds pass.
- **Risk:** “Rights floor” claims exceed legal or moral authority.
  **Mitigation:** State derivation, jurisdictional uncertainty, and non-goals explicitly.
