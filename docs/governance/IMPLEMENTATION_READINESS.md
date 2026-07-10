# Governance Implementation Readiness

**Status:** Authoritative gate for Plans 6 and 7 (and later) regarding governance.
**Date:** 2026-07-10
**Index:** [README.md](./README.md)

## Readiness vocabulary

| State | Meaning |
|-------|---------|
| `ready-for-reference` | Specs may be cited; little/no schema encoding yet |
| `schema-ready` | Field shapes/enums may be encoded in protocol-core / plugins |
| `experimental` | May be coded behind explicit experimental labels only |
| `blocked` | Must not enter production protocol behavior |
| `deferred` | Acknowledged; not near-term |

---

## Area readiness matrix

| Area | State | May Plans 6–7 implement? | Blocker / next decision |
|------|-------|--------------------------|-------------------------|
| Actors / rights floor | `ready-for-reference` | Cite only; no “rights engine” | Legal mapping remains `UNRESOLVED` |
| Constitutional lineage | `schema-ready` | Yes — lineage metadata + validation examples | Compatibility profile vectors still provisional |
| Adoption lifecycle states | `schema-ready` | Yes — machine-readable states/transitions | Keep distinct from installation |
| Amendment process records | `schema-ready` | Yes — proposal/decision/dissent records **without tallies** | Activation still needs ratification proof ref |
| Ratification / Sybil mechanism | `blocked` | **No** production quorum/vote formula | Simulations + `RATIFICATION_DECISION_RECORD.md` update |
| Consent / authorization classes | `schema-ready` | Yes — class labels on receipts/approvals | Jurisdiction mapping deferred |
| Evidence / claim classes | `schema-ready` | Yes — align with Plan 3/6 claim discriminators | Completeness stays high-burden |
| Due process records | `schema-ready` | Yes — challenge/appeal/correction/rehab types | SLA deadlines unresolved |
| Key governance events | `schema-ready` | Yes — rotation/compromise/revocation event shapes | Threshold `m-of-n` unresolved |
| Signed release manifests | `deferred` → Plan 6 scope | Plan 6 may implement when its tasks say so | Follow `KEY_GOVERNANCE.md` domains |

---

## Hard blocks (cannot enter implementation accidentally)

1. **Selecting** one-agent-one-vote, stake, reputation, or any hybrid as “the FPP ratification method” while `RATIFICATION_DECISION_RECORD.md` is `UNRESOLVED`.
2. Treating operator approval as universal consent for nonparticipants.
3. Advertising installation or `externally_enforced` as voluntary `accepted` adoption.
4. Treating signatures/Merkle proofs as behavioral compliance or completeness.
5. Rewriting historical evidence in place instead of append-only correction.
6. Collapsing signing domains (e.g., agent key as constitution-root).
7. Score-washing severe events via routine success averages.

---

## Unresolved normative decisions

| ID | Decision | Owner | Evidence required |
|----|----------|-------|-------------------|
| U-1 | Ratification / representation mechanism | Project stewards + independent reviewer | Simulations per `RATIFICATION_AND_SYBIL_RESISTANCE.md` §4–5 |
| U-2 | Exact deliberation durations by impact class | Governance spec owners | Operational trial data |
| U-3 | Steward legitimacy when operator/user/platform conflict | Stewards + affected-party input | Case studies; dual-control patterns |
| U-4 | Machine-readable compatibility requirement vectors | Lineage + amendment owners | Profile draft + adversarial review |
| U-5 | Threshold `m-of-n` for offline roots | Key governance owners | Threat model for publisher compromise |
| U-6 | Dispute SLA defaults | Due-process owners | Deployment size assumptions |
| U-7 | Whether rights-floor weakening can ever be ratified | Constitutional community | Extraordinary process design — currently stop-conditioned |

---

## Consistency checklist (Plan 5 close-out)

- [x] Every governance area has a readiness state above
- [x] Blocked ratification cannot be mistaken for schema-ready process records
- [x] Examples exist for lineage, adoption, amendment, authz, evidence, dispute, keys
- [x] `docs/dev-review.md` editorial notes point at `docs/governance/`
- [x] Plans 6 and 7 cite these specifications (dependency notes)
- [x] Open questions remain listed (not deleted)

### Terminology alignment

| Term | Canonical home |
|------|----------------|
| Claim classes | `EVIDENCE_SEMANTICS.md` + `docs/CAPABILITY_STATUS.md` |
| Adoption states | `ADOPTION_LIFECYCLE.md` |
| Compatibility classes | `CONSTITUTIONAL_LINEAGE.md` |
| Revocation classes | `docs/REVOCATION.md` + `KEY_GOVERNANCE.md` |
| Consent classes | `CONSENT_AND_AUTHORIZATION.md` |
