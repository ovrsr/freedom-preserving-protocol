# Peer and Steward Quorum Mandates

**Status:** PENDING
**Created:** 2026-07-10
**Series:** Plan 9 of 12 (autonomy + harness-agnostic program)
**Depends on:** Plan 8 (mandate schema, disposition consumption seam)
**Unblocks:** Stronger unattended allows without human presence; Plan 10 may consume quorum tools via trust-core
**Scope:** In: peer-quorum and steward-quorum protocols that **issue signed StandingMandateV1** records; quorum evidence packages; anti-Sybil floor consistent with provisional governance (no full ratification tallies); trust-plugin tools/CLI to propose, second, and finalize quorum mandates; wiring into mandate store. Out: disposition engine redesign (Plan 8); package extraction (Plan 10); non-OpenClaw adapters (Plan 11); gateway RFC (Plan 12); agent-majority consent for nonparticipants (forbidden by CONSENT_AND_AUTHORIZATION); changing seed constitution hash; resolving `RATIFICATION_DECISION_RECORD` (remains blocked for constitutional amendments).

## Summary

When no human operator is present, high-impact actions that are not covered by a standing allowlist or prior mandate may still proceed if a **peer or steward quorum** issues a signed mandate. Quorum does not call `allow` directly — it **generates a StandingMandateV1** that Plan 8’s disposition engine already knows how to consume (`authorization: quorum-mandate`).

## Architecture Notes

- Quorum output = mandate artifact (same schema as Plan 8), with `issuerClass: "peer-quorum" | "steward-quorum"` and `evidenceRef` pointing at quorum ballot evidence.
- Steward quorum requires steward-role keys (Law 2), distinct from mere peer agents.
- Peer quorum cannot authorize effects on nonparticipants that require affected-party consent — disposition still abstains or emergency-paths those cases.
- Thresholds and member sets are local policy (config), not global ratification.
- Sybil resistance: reuse Plan 7 source-independence / key-lifecycle constraints; do not implement full ratification voting.

## Feature Inventory

| Existing / gap | Replacement | Task |
|---|---|---|
| Plan 8 stub `quorumMandatePresent` | Real quorum → signed mandate in store | Tasks 3–5 |
| No quorum ballot types | `QuorumProposalV1` / `QuorumBallotV1` in protocol-core | Task 1 |
| Trust tools lack mandate issuance | `fpp_mandate_propose` / `fpp_mandate_second` / `fpp_mandate_finalize` | Task 4 |
| Steward override CLI only | Steward-quorum path alongside existing steward-override | Task 5 |
| Capsule/trust standing unused for tool allow | Optional: require minimum scoped standing to vote | Task 2 |

## Progress Tracking

- [ ] Task 1: Quorum proposal and ballot schemas in protocol-core
- [ ] Task 2: Local quorum policy (threshold, roles, eligibility)
- [ ] Task 3: Quorum session state machine → mandate issuance
- [ ] Task 4: Trust-plugin tools for propose / second / finalize
- [ ] Task 5: Steward-quorum path and CLI
- [ ] Task 6: Wire issued mandates into mandate-store + disposition e2e
- [ ] Task 7: Nonparticipant and consent guardrails
- [ ] Task 8: Docs, CAPABILITY_STATUS, security regressions

**Total Tasks:** 8 | **Completed:** 0 | **Remaining:** 8

## Implementation Tasks

### Task 1: Quorum proposal and ballot schemas in protocol-core

**Objective:** Versioned schemas for proposals, ballots, and quorum evidence packages that hash-link into StandingMandateV1.evidenceRef.

**Files:**
- Create: `packages/protocol-core/src/quorum.ts`
- Modify: `packages/protocol-core/src/mandates.ts` (issuerClass / quorumRef fields if not complete in Plan 8)
- Modify: `packages/protocol-core/src/index.ts`
- Test: `packages/protocol-core/src/quorum.test.ts`

**Steps:**
1. RED: parse valid proposal/ballot; reject missing signatures / mismatched mandate digest.
2. GREEN: schemas + helpers to compute evidence digest.
3. Typecheck + tests.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 2: Local quorum policy (threshold, roles, eligibility)

**Objective:** Config defines peer threshold, steward threshold, eligible voter sets, and optional minimum trust standing to cast a ballot.

**Files:**
- Create: `plugin-trust/src/quorum-policy.ts`
- Modify: `plugin-trust/openclaw.plugin.json`
- Test: `plugin-trust/src/quorum-policy.test.ts`

**Steps:**
1. RED/GREEN for threshold evaluation and role checks.
2. Reject ballots from revoked keys (key-lifecycle).

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 3: Quorum session state machine → mandate issuance

**Objective:** Collect ballots until threshold; on success emit signed StandingMandateV1 into the shared mandate store path.

**Files:**
- Create: `plugin-trust/src/quorum-session.ts`
- Test: `plugin-trust/src/quorum-session.test.ts`

**Steps:**
1. RED: below threshold → no mandate; at threshold → mandate file written; duplicate finalize idempotent.
2. GREEN: minimal state machine with expiry of open proposals.
3. Typecheck + tests.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 4: Trust-plugin tools for propose / second / finalize

**Objective:** Agent-callable tools to run quorum without a human UI.

**Files:**
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/index.ts`
- Modify: `plugin-trust/openclaw.plugin.json`
- Test: `plugin-trust/src/tools.test.ts`

**Steps:**
1. RED: tool contracts for propose/second/finalize.
2. GREEN: register tools; no OpenClaw-only logic inside session core.
3. Typecheck + tests.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 5: Steward-quorum path and CLI

**Objective:** Steward-role quorum distinct from peer quorum; CLI for operators/stewards to inspect and revoke quorum-issued mandates.

**Files:**
- Modify: `plugin-trust/src/cli.ts`
- Test: `plugin-trust/src/cli.test.ts`

**Steps:**
1. RED/GREEN: `fpp-trust quorum-status`, `quorum-revoke-mandate`.
2. Ensure steward-override remains audited and does not silently mint peer-signed mandates.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 6: Wire issued mandates into mandate-store + disposition e2e

**Objective:** End-to-end: quorum finalize → mandate store → unattended disposition allow + budget debit + receipt authorization `quorum-mandate`.

**Files:**
- Create: `test/quorum-mandate-e2e.test.ts`
- Modify: `plugin/src/mandate-store.ts` (if discovery path needed)

**Steps:**
1. RED then GREEN e2e across trust + enforcement packages.
2. Run e2e + both plugin test suites.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 7: Nonparticipant and consent guardrails

**Objective:** Quorum cannot mint mandates that claim affected-party or data-subject consent; such scopes are rejected at finalize.

**Files:**
- Modify: `plugin-trust/src/quorum-session.ts`
- Test: `plugin-trust/src/quorum-session.test.ts`
- Modify: `docs/governance/CONSENT_AND_AUTHORIZATION.md` (implementation note)

**Steps:**
1. RED: proposal scoped to `affected-party-consent` class fails finalize.
2. GREEN: enforce authorization-class allowlist for quorum-mintable scopes.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 8: Docs, CAPABILITY_STATUS, security regressions

**Objective:** Document quorum≠ratification; update capability matrix; add Sybil/replay regressions for ballots.

**Files:**
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `plugin-trust/README.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Test: `plugin-trust/src/security-regressions.test.ts`

**Steps:**
1. Matrix row: peer/steward quorum mandates `PARTIAL` or `SHIPPED` with stated gaps.
2. Regressions: revoked key ballot rejected; replayed ballot rejected.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

## Testing Strategy

- Schema unit tests; session state machine; tool registration; cross-package e2e with Plan 8 disposition engine.
- Security: revoked keys, threshold bypass, nonparticipant scope rejection.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Quorum treated as constitutional ratification | Docs + code comments; no amendment issuance |
| Colluding peers mint broad mandates | Tight scope fields; budgets; short expiry; standing checks |
| Deadlock waiting for quorum | Proposal TTL; disposition still abstains if no mandate |
| Confusion with steward-override | Separate authorization classes and CLI verbs |
