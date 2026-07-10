# Ratification Decision Record

**Decision ID:** `FPP-GOV-RATIFICATION-2026-07-10`
**Status:** `UNRESOLVED`
**Date:** 2026-07-10
**Plan:** `docs/plans/2026-07-10-5-governance-evolution-specification.md` Task 5
**Analysis:** `RATIFICATION_AND_SYBIL_RESISTANCE.md`

---

## Decision

**No ratification / representation mechanism is selected.**

The project retains amendment lifecycle, lineage, dissent, exit, and rights-floor specifications without a production voting formula.

---

## Options considered

1. One-agent-one-vote
2. Stake-weighted
3. Reputation-weighted
4. Longevity-weighted
5. Affected-party weighting
6. Domain-competence weighting
7. Sortition
8. Hybrid multi-factor

See comparative table and attack models in `RATIFICATION_AND_SYBIL_RESISTANCE.md`.

---

## Why unresolved

- No simulation evidence meeting the documented acceptance criteria.
- Sybil-resistant eligibility for agents remains an open research/engineering problem in this ecosystem.
- Selecting a fragile mechanism now would create false legitimacy and governance capture risk.
- Founder preference must not silently become protocol law.

---

## Evidence required to reopen

1. Simulation report with metrics listed in §5 of `RATIFICATION_AND_SYBIL_RESISTANCE.md`.
2. Independent adversarial review notes.
3. Explicit user/steward acknowledgment recorded by updating this file’s Status.
4. Rights-floor compatibility statement for nonparticipants.

---

## Binding consequence for implementers

| Action | Allowed? |
|--------|----------|
| Implement amendment proposal/deliberation record schemas | Yes (process only) |
| Implement production quorum tally as “the FPP method” | **No** while Status is `UNRESOLVED` |
| Experiment behind feature flags labeled experimental | Yes, if not advertised as ratified protocol |
| Mark Plans 6–7 tasks as depending on this decision | Required |

---

## Supersession

This record may only move to `PROVISIONAL-SELECTED` or `REJECTED-ALTERNATIVES` via an append-only update section below, never by silent rewrite.

### Update log

| Date | Change | Author role |
|------|--------|-------------|
| 2026-07-10 | Initial `UNRESOLVED` record | Plan 5 specification |
