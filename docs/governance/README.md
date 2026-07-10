# Governance Specifications

**Plan:** `docs/plans/2026-07-10-5-governance-evolution-specification.md`
**Status gate:** [`IMPLEMENTATION_READINESS.md`](./IMPLEMENTATION_READINESS.md)

These documents turn unresolved governance direction from `docs/dev-review.md` into implementation-ready specifications. They are **not** production code and do **not** select a fragile consensus mechanism.

Label reminder: statements inside are marked `NORMATIVE (seed)`, `PROVISIONAL`, `UNRESOLVED`, or `NON-GOAL` as appropriate. Do not treat provisional prose as ratified law.

## Index

| Spec | Topic | Readiness (see gate) |
|------|-------|----------------------|
| [THREAT_MODEL_AND_RIGHTS_FLOOR.md](./THREAT_MODEL_AND_RIGHTS_FLOOR.md) | Actors, threats, authority, rights floor | `ready-for-reference` |
| [CONSTITUTIONAL_LINEAGE.md](./CONSTITUTIONAL_LINEAGE.md) | Lineage + compatibility classes | `schema-ready` |
| [ADOPTION_LIFECYCLE.md](./ADOPTION_LIFECYCLE.md) | Adoption/withdrawal state machine | `schema-ready` |
| [AMENDMENT_LIFECYCLE.md](./AMENDMENT_LIFECYCLE.md) | Proposal → activation/rollback process | `schema-ready` (process only) |
| [RATIFICATION_AND_SYBIL_RESISTANCE.md](./RATIFICATION_AND_SYBIL_RESISTANCE.md) | Candidate mechanisms + attacks | `blocked` |
| [RATIFICATION_DECISION_RECORD.md](./RATIFICATION_DECISION_RECORD.md) | Formal `UNRESOLVED` decision | `blocked` |
| [CONSENT_AND_AUTHORIZATION.md](./CONSENT_AND_AUTHORIZATION.md) | Consent/authorization taxonomy | `schema-ready` |
| [EVIDENCE_SEMANTICS.md](./EVIDENCE_SEMANTICS.md) | Claim classes + evidentiary burdens | `schema-ready` |
| [DUE_PROCESS_AND_REHABILITATION.md](./DUE_PROCESS_AND_REHABILITATION.md) | Challenge, appeal, correction, rehab | `schema-ready` |
| [KEY_GOVERNANCE.md](./KEY_GOVERNANCE.md) | Signing domains + key lifecycle | `schema-ready` |

## Examples

| File | Purpose |
|------|---------|
| [examples/lineage-identical.json](./examples/lineage-identical.json) | Valid seed-identical lineage |
| [examples/lineage-derived.json](./examples/lineage-derived.json) | Valid derived lineage |
| [examples/lineage-invalid.json](./examples/lineage-invalid.json) | Invalid seed impersonation |
| [examples/adoption-transitions.json](./examples/adoption-transitions.json) | Adoption transition table |
| [examples/amendment-proposal.json](./examples/amendment-proposal.json) | Amendment proposal shape |
| [examples/amendment-decision.json](./examples/amendment-decision.json) | Decision with unresolved ratification |
| [examples/authorization-contexts.json](./examples/authorization-contexts.json) | Distinct authorization classes |
| [examples/evidence-claims.json](./examples/evidence-claims.json) | Per-class max conclusions |
| [examples/dispute-lifecycle.json](./examples/dispute-lifecycle.json) | Append-only dispute path |
| [examples/key-events.json](./examples/key-events.json) | Key rotation/compromise events |

## Downstream plans

- **Plan 6** (`docs/plans/2026-07-10-6-conformance-receipts-and-handshake-capsules.md`) — may implement schema-ready adoption states, evidence/claim labels, and receipt semantics; must not implement ratification tallies.
- **Plan 7** (`docs/plans/2026-07-10-7-contextual-trust-and-due-process.md`) — may implement due-process records, contextual evidence quality, and key-lifecycle events; must respect anti-washing and blocked ratification.
