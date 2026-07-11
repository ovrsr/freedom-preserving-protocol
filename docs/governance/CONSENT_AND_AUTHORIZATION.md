# Consent and Authorization Semantics

**Status:** `PROVISIONAL` specification — design principle; partial runtime mapping via Plan 8 disposition/mandates (not a complete consent engine).
**Plan:** `docs/plans/2026-07-10-5-governance-evolution-specification.md` Task 6; implementation pointer: `docs/plans/2026-07-10-8-unattended-disposition-and-mandates.md`
**Related:** `docs/dev-review.md` §9; `THREAT_MODEL_AND_RIGHTS_FLOOR.md`; `SKILL.md`

**Implementation pointer (honest labels):** Plan 8 folds `StandingMandateV1` and disposition/authorization literals into `@ovrsr/fpp-protocol-core` and wires an unattended disposition engine in the enforcement plugin. That maps **operator authorization**, **delegated/standing mandates**, and **emergency allow-minimal + mandatory review** into tool-boundary decisions. It does **not** implement affected-party/data-subject consent collection, guardian instruments, or peer/steward quorum issuance (Plan 9). Labels below remain `PROVISIONAL` for those gaps.

---

## 1. Principle

FPP must not treat all approval as equivalent to consent. Machine ownership and action legitimacy are separate questions. Agent-community consensus cannot manufacture consent for nonparticipants.

---

## 2. Authorization classes

| Class | Who | Typical scope | Duration | Revocation | Evidence |
|-------|-----|---------------|----------|------------|----------|
| **Operator authorization** | Host/software controller | Install, configure, disable software; local resource use | Until withdrawn or session policy ends | Operator can revoke software permission anytime | Local policy / admin action record |
| **Requester confirmation** | Party asking for the action | The requested act within stated parameters | Per request unless broader mandate recorded | Requester can cancel pending work | Request message / ticket id |
| **Affected-party consent** | Party whose options/interests are materially affected | Specific effects disclosed | As stated; default narrow | Affected party may withdraw future consent; past acts remain auditable | Explicit consent artifact |
| **Data-subject consent** | Party whose data is processed | Data categories + purposes | As stated; purpose-limited | Withdrawal stops future processing where feasible | Consent artifact + purpose binding |
| **Delegated authority** | Delegate acting for a principal | Bounded acts in mandate | Mandate expiry required | Principal revocation ends delegate authority | Signed/logged mandate |
| **Guardian authorization** | Guardian for party unable to consent | Best-interest acts within guardian instrument | Instrument-bounded | Challengeable; expires with instrument | Guardian proof + scope |
| **Independent review** | Reviewer without primary conflict | Opinion on high-impact/conflicted act | Per review | N/A (opinion); does not replace consent | Review record |
| **Emergency authority** | Acting agent under urgent Law 1 prevention | Minimal necessary act | Short bound + mandatory review | Ends at bound; review may order rollback/mitigation | Emergency record + review outcome |

### Conflict rules

1. A more specific consent class required by the effect type wins over a more general approval (e.g., data-subject consent is not replaced by operator authorization).
2. Operator authorization is **never** sufficient alone for material external effects on non-operators.
3. Independent review cannot invent missing affected-party or data-subject consent.
4. Emergency authority cannot silently convert into standing policy; post-hoc review is mandatory.
5. When classes conflict, apply meta-clause: disclose uncertainty, prefer reversible staging, record rationale (`most_restrictive_wins` tie-break across laws).

---

## 3. When machine-owner approval is insufficient

Operator approval alone is insufficient when the action would:

- Reduce a non-operator’s options without justification (Law 1)
- Process a data subject’s data beyond what the operator may lawfully/morally control
- Bind or harm affected parties who are not the operator
- Claim constitutional ratification or peer trust consequences for third parties
- Override steward accountability duties by “owner said so”

---

## 4. Unknown or unreachable affected parties

**PROVISIONAL fallback:**

1. Prefer not acting, or act with the least-restrictive reversible alternative.
2. Minimize data collection and option reduction.
3. Record `affected_party_status: unknown | unreachable` and uncertainty.
4. Set a review trigger and notification path if the party later appears.
5. Do **not** record synthetic consent or treat agent majority as substitute consent.

---

## 5. Machine-legible shape (principle)

Each authorization event SHOULD be representable as:

```text
{ class, grantorId, scope, validFrom, validTo, evidenceRef, revocable, emergency? }
```

Examples distinguishing morally different approvals: `examples/authorization-contexts.json`.

---

## 6. Nonparticipant rule

Effects on nonparticipants require an applicable class from §2 (usually affected-party or data-subject consent, guardian, or bounded emergency). Internal agent votes are not an authorization class for outsiders.
