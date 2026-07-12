# Gateway Constitutional Layer RFC

**Status:** COMPLETE
**Created:** 2026-07-10
**Series:** Plan 12 of 12 (autonomy + harness-agnostic program)
**Depends on:** Plans 8–11 (disposition model + cores + adapters inform the RFC)
**Unblocks:** Path to non-bypassable tool-router enforcement (ecosystem-dependent)
**Scope:** In: in-repo RFC draft for a voluntary constitutional layer at the tool-router/gateway boundary; reference architecture binding enforcement-core dispositions (including unattended mandate/abstain); tamper-evident logging requirements; AOS Phase 2 coordination notes; CAPABILITY_STATUS/ROADMAP updates; submission checklist for OpenClaw Foundation (or successor) intake. Out: claiming the RFC is accepted; implementing proprietary gateway forks without upstream process; amending seed constitution hash `71bf60ad…`; replacing Law 2 corrigibility (operators must still be able to disable governance — RFC must preserve ultimate operator authority while making disablement auditable).

## Summary

Graduate roadmap item “Gateway-level enforcement RFC” from `DEFERRED` documentation into a concrete, reviewable RFC artifact in this repository, aligned with the unattended disposition model and harness-agnostic cores. Implementation inside upstream OpenClaw (or other gateways) remains contingent on foundation intake — this plan delivers the **specification and submission package**, plus any minimal local reference hooks that do not require upstream merge.

## Architecture Notes

- Working title: *Voluntary Constitutional Layer in the Gateway*.
- Gateway invokes the same disposition contract as `FppRuntimeAdapter` / enforcement-core at the tool-router boundary.
- Plugin disablement remains possible (Law 2) but MUST emit a signed, hash-chained “governance disabled” event.
- References: `arXiv:2603.11853` (OpenClaw PRISM), `arXiv:2603.16586` (runtime governance policies), AOS Phase 2.
- Unattended dispositions (`mandate`, `staged`, `abstain`, `emergency`) are first-class in the RFC — not only `requireApproval`.

## Feature Inventory

| Existing | Replacement / addition | Task |
|---|---|---|
| `docs/ROADMAP.md` §1 DEFERRED only | In-repo RFC + readiness checklist | Tasks 1–3 |
| `docs/CAPABILITY_STATUS.md` gateway row DEFERRED | Update when RFC draft lands (`PROPOSED`→keep until accepted; or `PARTIAL` for draft) | Task 5 |
| Plugin-only enforcement story | Gateway binding semantics documented | Task 2 |
| No submission package | Discussion template + artifact index | Task 4 |

## Progress Tracking

- [x] Task 1: RFC outline and normative requirements (disposition + Law 2)
- [x] Task 2: Reference architecture (enforcement-core at tool-router)
- [x] Task 3: Logging, disablement audit, and receipt binding requirements
- [x] Task 4: Foundation submission package and AOS coordination note
- [x] Task 5: ROADMAP / CAPABILITY_STATUS / MASTER_CONTEXT updates
- [x] Task 6: Optional local reference stub (feature-flagged, non-default)
- [x] Task 7: Public review checklist and verification of citations
- [x] Task 8: Explicit non-goals and threat model appendix

**Total Tasks:** 8 | **Completed:** 8 | **Remaining:** 0

## Implementation Tasks

### Task 1: RFC outline and normative requirements (disposition + Law 2)

**Objective:** Author the RFC skeleton with normative MUST/SHOULD for unattended disposition integration and operator corrigibility.

**Files:**
- Create: `docs/rfc/0001-voluntary-constitutional-layer.md`
- Test: `docs/rfc/0001-voluntary-constitutional-layer.test.ts` (structure lint: required sections present)

**Steps:**
1. RED: section linter fails until required headings exist.
2. GREEN: Motivation, Goals, Non-goals, Disposition mapping, Corrigibility, Security considerations.
3. No constitution text changes.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 2: Reference architecture (enforcement-core at tool-router)

**Objective:** Specify how a gateway loads enforcement-core (or equivalent WASM/JS) at the tool-router and maps results to allow/deny/stage/abstain without requiring a human approval UI.

**Files:**
- Modify: `docs/rfc/0001-voluntary-constitutional-layer.md`
- Create: `docs/rfc/diagrams/gateway-disposition.mmd` (mermaid source)

**Steps:**
1. Document sequence: tool request → classify → resolveDisposition → receipt → execute/skip.
2. Map OpenClaw and generic gateway terms.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 3: Logging, disablement audit, and receipt binding requirements

**Objective:** Require constitution hash + policy engine version in tamper-evident gateway logs; define disablement audit events.

**Files:**
- Modify: `docs/rfc/0001-voluntary-constitutional-layer.md`
- Create: `docs/rfc/examples/governance-disabled-event.json`

**Steps:**
1. Example events for enable/disable/mandate-load.
2. Align field names with protocol-core digests where possible.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 4: Foundation submission package and AOS coordination note

**Objective:** Produce a submission checklist and short coordination note for AOS Phase 2 / OpenClaw Discussions — without falsely claiming intake exists.

**Files:**
- Create: `docs/rfc/SUBMISSION.md`
- Create: `docs/rfc/AOS-COORDINATION.md`

**Steps:**
1. List prerequisites from ROADMAP; mark which are satisfied by this draft.
2. Provide copy-paste Discussion body template.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 5: ROADMAP / CAPABILITY_STATUS / MASTER_CONTEXT updates

**Objective:** Point deferred gateway item at the in-repo RFC; keep status honest (`PROPOSED` draft vs `DEFERRED` awaiting foundation).

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `MASTER_CONTEXT.md`

**Steps:**
1. Link RFC path; do not mark SHIPPED.
2. Note Plans 8–11 as prerequisites satisfied for *drafting*.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 6: Optional local reference stub (feature-flagged, non-default)

**Objective:** If feasible without upstream OpenClaw, add a **non-default** reference stub that demonstrates gateway-shaped invocation of enforcement-core for CI demos only.

**Files:**
- Create: `packages/gateway-reference/src/index.ts`
- Test: `packages/gateway-reference/src/index.test.ts`

**Steps:**
1. RED/GREEN: in-process tool-router fake calls disposition engine.
2. Document “not a production gateway.”
3. Skip packaging as OpenClaw plugin.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 7: Public review checklist and verification of citations

**Objective:** Verify arXiv and AOS references resolve; checklist for external review before filing upstream.

**Files:**
- Create: `docs/rfc/REVIEW_CHECKLIST.md`
- Test: `scripts/rfc-citation-check.ts` (optional fetch or static URL list)

**Steps:**
1. Confirm citation URLs/ids in RFC.
2. Checklist includes Law 1–5 impact review.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 8: Explicit non-goals and threat model appendix

**Objective:** RFC appendix: what gateway layer does not prove (behavioral compliance, completeness); align with THREAT_MODEL_AND_RIGHTS_FLOOR actors.

**Files:**
- Modify: `docs/rfc/0001-voluntary-constitutional-layer.md`
- Modify: `docs/governance/THREAT_MODEL_AND_RIGHTS_FLOOR.md` (pointer only if needed)

**Steps:**
1. Non-goals: no forced adoption; no removal of operator disable; no nonparticipant consent via gateway majority.
2. Cross-link claim classes from CAPABILITY_STATUS.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

## Testing Strategy

- Structural tests for RFC completeness; gateway-reference unit tests; citation check script.
- No claim of upstream acceptance in CI.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Foundation intake not ready | Plan delivers draft + checklist; status stays PROPOSED/DEFERRED |
| RFC over-promises behavioral proof | Explicit non-goals + claim classes |
| Law 2 violation via uncancellable gateway | Disablement MUST remain possible and audited |
| Drift from Plans 8–11 disposition model | RFC MUST reference protocol-core disposition enums |
