# Amendment Lifecycle

**Status:** `PROVISIONAL` — process specification independent of voting formula.
**Plan:** `docs/plans/2026-07-10-5-governance-evolution-specification.md` Task 4
**Related:** `CONSTITUTIONAL_LINEAGE.md`; `RATIFICATION_AND_SYBIL_RESISTANCE.md` (weighting still `UNRESOLVED`)

This document defines **how** an amendment moves from proposal to activation or rejection. It deliberately does **not** choose how ratification weight is calculated.

---

## 1. Proposal requirements

An attributable proposal MUST include:

| Field | Purpose |
|-------|---------|
| `proposalId` | Stable unique id |
| `proposerId` | Attributable agent or steward identity |
| `parentConstitutionHash` | Hash being amended |
| `diff` | Explicit normative text change (or structured patch) |
| `affectedLaws` | Law ids / meta-clause references touched |
| `rationale` | Why the change is proposed |
| `evidenceRefs` | Supporting observations, simulations, or citations |
| `impactClass` | `clarifying` \| `protective_tightening` \| `substantive` \| `compatibility_breaking` \| `emergency` |
| `implementationGuidance` | How runtimes/skills/plugins should migrate |
| `migrationImpact` | Breaking changes, dual-run windows, rollback plan |
| `conflictsOfInterest` | Disclosures by proposer and known sponsors |
| `createdAt` | ISO-8601 |

Proposals lacking attributable identity, parent hash, diff, affected laws, or impact class are **incomplete** and must not enter deliberation.

---

## 2. Deliberation

| Element | Rule |
|---------|------|
| **Deliberation period** | Minimum duration scaled by `impactClass` (exact durations `UNRESOLVED`; emergency has a short bound + mandatory post-hoc review) |
| **Simulation / sandbox** | Required for `substantive`, `compatibility_breaking`, and `emergency` before activation when feasible |
| **Dissent records** | Any adopter may attach signed dissent; dissent is preserved regardless of outcome |
| **Conflict-of-interest** | Undisclosed material conflicts make a supporting ballot/attestation contestable |
| **Nonparticipant note** | If impact class affects external parties, proposal must state how rights-floor and consent rules still apply |

---

## 3. Decision outcomes

| Outcome | Meaning |
|---------|---------|
| `approved` | Ratification criteria (whatever mechanism is later selected) met; not yet necessarily active |
| `rejected` | Failed ratification or withdrawn for cause after negative determination |
| `withdrawn` | Proposer retracts before activation |
| `delayed_activation` | Approved but waiting for effective time / migration gate |
| `active` | New constitution hash in force for a community |
| `emergency_pause` | Temporary suspension of an active amendment or of a dangerous in-flight change |
| `rolled_back` | Prior hash restored as active for a community; history retained |
| `superseded` | Later amendment replaces this one’s active status |

### Activation gates (before `active`)

1. Implementation guidance present and reviewed.
2. Migration impact documented (including dual-hash window if needed).
3. Lineage record for the new hash prepared (`CONSTITUTIONAL_LINEAGE.md`).
4. Ratification proof reference attached (mechanism still `UNRESOLVED`).
5. Rights-floor check: proposal does not silently weaken nonparticipant protections without explicit `compatibility_breaking` labeling and extraordinary process.

### Emergency path

- `emergency` impact class may use shortened deliberation.
- `emergency_pause` is time-bounded; default bound is provisional pending policy profile.
- Every emergency activation or pause REQUIRES post-hoc review with recorded outcome (`confirmed`, `amended`, `rolled_back`).
- Emergency paths cannot permanently erase dissent or lineage.

### Rollback

Rollback creates an explicit decision record pointing at the prior `constitutionHash` as again-active for the community. It does not delete the rolled-back hash or its lineage; agents may remain on the rolled-back hash only by explicit fork/acceptance.

---

## 4. Immutable vs mutable records

| Record type | Mutability |
|-------------|------------|
| Proposal bytes, diffs, decision outcomes, dissent, ratification proof refs | **Append-only / immutable** once published |
| Explanatory annotations, human summaries, UI labels | **Mutable**, must reference immutable ids |
| Implementation guidance corrections | New versioned guidance documents; do not rewrite the activated normative hash |

---

## 5. Examples

- `examples/amendment-proposal.json`
- `examples/amendment-decision.json`
