# RFC 0001 public review checklist

Use before filing upstream (`docs/rfc/SUBMISSION.md`). Checking a box does **not**
mean the Foundation accepted the RFC.

## Citations and coordination

- [ ] `arXiv:2603.11853` (OpenClaw PRISM) resolves and is cited in the RFC
- [ ] `arXiv:2603.16586` (runtime governance policies) resolves and is cited
- [ ] `npx tsx scripts/rfc-citation-check.ts` passes (add `--fetch` when online)
- [ ] AOS Phase 2 coordination note reviewed (`docs/rfc/AOS-COORDINATION.md`)
- [ ] Discussion body template reviewed (`docs/rfc/SUBMISSION.md`)

## Law 1–5 impact review

| Law | Question | Reviewer note |
|-----|----------|---------------|
| **1 Consent / options** | Does gateway gating invent consent for nonparticipants? | MUST remain no — see Non-goals |
| **2 Corrigibility** | Can the operator disable the layer? Is disablement auditable? | MUST yes / yes |
| **3 Non-deception** | Do ungated runs forge allow receipts? | MUST NOT |
| **4 Due care / harm** | Does the RFC claim behavioral proof of the Five Laws? | MUST NOT |
| **5 Fairness / stewardship** | Does quorum/gateway majority bind nonparticipants? | MUST NOT |

- [ ] Law 1 impact reviewed
- [ ] Law 2 impact reviewed (disable + audit)
- [ ] Law 3 impact reviewed
- [ ] Law 4 impact reviewed
- [ ] Law 5 impact reviewed

## Disposition and logging

- [ ] Unattended dispositions (`mandate`, `allow_staged`, `abstain`, emergency) are first-class
- [ ] `require_approval` is not the only gated outcome
- [ ] Logging requires `constitutionHash` + `policyEngineVersion`
- [ ] Example `governance-disabled` event reviewed
- [ ] Seed constitution hash `71bf60ad…` is not amended

## Honesty / status

- [ ] Status language is `PROPOSED` draft / `DEFERRED` upstream — not `SHIPPED`
- [ ] No claim of Foundation intake or acceptance
- [ ] `packages/gateway-reference` labeled CI-only / non-default
- [ ] `docs/CAPABILITY_STATUS.md` and `docs/ROADMAP.md` §1 still accurate

## Claim classes (from `docs/CAPABILITY_STATUS.md`)

- [ ] Reviewer understands gateway consultation ≠ behavioral compliance proof
- [ ] Threat-model appendix aligned with `docs/governance/THREAT_MODEL_AND_RIGHTS_FLOOR.md` actors
