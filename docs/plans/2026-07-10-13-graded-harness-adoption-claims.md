# Graded Harness Adoption Claims

**Status:** COMPLETE
**Created:** 2026-07-10
**Series:** Plan 13 (follow-on to autonomy + harness-agnostic program 8–12)
**Depends on:** Plans 8 and 11 (disposition engine + cross-harness adapters with honest capability probes). Plans 9–10 and 12 are helpful but not hard blockers for schema/ledger work; capsule wiring assumes Plan 10 trust-core or current `plugin-trust` surfaces.
**Unblocks:** Honest `reviewed` → limited `accepted` claims per harness; peer-safe disclosure when enforcement is proxy-only or prompt-only
**Scope:** In: adoption overlays + harness-scoped enforcement grades in protocol-core; dual-path local acceptance vs peer-advertisable acceptance; ledger + adopt/verify-install wiring; `AdoptionDisclosure` + TrustStateCapsule summary fields; trust-plugin emission/validation rules that refuse elevating prompt-only/proxy-degraded claims; governance + CAPABILITY_STATUS updates; e2e tests for graded claims. Out: amending seed constitution hash `71bf60ad…`; ratification/Sybil resolution; gateway non-bypassable enforcement (Plan 12); new adoption enum value `accepted-limited`; claiming behavioral compliance; agent personhood.

## Summary

Plans 8 + 11 can deliver unattended disposition and harness adapters with honest capability reporting, but an agent still cannot represent “I voluntarily accept the seed laws on this harness, with degraded/partial enforcement” without either overclaiming or staying at conscience-only.

This plan closes that gap:

1. Keep lifecycle state `accepted` (no new enum).
2. Add **overlay flags**, **`harnessId`**, and **`enforcementGrade`** (`native-hook` | `tool-proxy` | `prompt-only` | `none`) to adoption records.
3. **Dual path (locked):** constitutional self-binding `accepted` is always allowed after `reviewed`; **peer-advertisable** acceptance requires verify-install / adapter probe evidence and is capped by grade.
4. **Prompt-only (locked):** local `accepted` is allowed with mandatory `runtime_degraded` + `enforcementGrade: prompt-only`; peer advertisement MUST be `declaration-only` and MUST NOT elevate to boundary-attested / completeness claims.
5. Persist grades on the local ledger **and** summarize them on TrustStateCapsule / `AdoptionDisclosure` (locked 4C).

## Architecture Notes

```text
npm run adopt -- --profile <harness>
        │
        ▼
  reviewed (inspection + constitution hash)
        │
        ▼
  accepted (local self-binding)
        │  overlays + harnessId + enforcementGrade from probe
        │
        ├─ peerAdvertisable? ──yes──► AdoptionDisclosure assurance=peer-advertisable
        │                              (native-hook, or tool-proxy with partial disclosure)
        └─ no / prompt-only ─────────► AdoptionDisclosure assurance=declaration-only
                                       (runtime_degraded required; no completeness elevation)
```

**Locked design choices (2026-07-10):**

| # | Choice |
|---|--------|
| 1 | New Plan 13 (not folded into Plan 11) |
| 2 | `accepted` + overlays + `harnessId` + `enforcementGrade` (not a new state) |
| 3 | Dual path: local `accepted` after `reviewed` always; peer-advertisable gated on probe evidence |
| 4 | Local ledger fields **and** capsule summary |
| 5 | Prompt-only: local `accepted` OK; peer ads `declaration-only` / not elevatable |

**Schema strategy:** Prefer additive `AdoptionStateRecordV2` (or clearly versioned extension) with V1 remaining parseable as legacy. Do not silently upgrade V1 records to peer-advertisable assurance.

**Enforcement grades (normative for this plan):**

| Grade | Meaning | Peer advertisability ceiling |
|-------|---------|------------------------------|
| `native-hook` | Harness pre-tool hook invokes enforcement-core | May be `peer-advertisable` if probe passes |
| `tool-proxy` | MCP/sidecar/proxy intercepts tools; bypass possible | `peer-advertisable` only with explicit `partial` / degraded disclosure |
| `prompt-only` | Skill/prompt layer only | Local `accepted` only as self-binding; peer = `declaration-only` |
| `none` | No FPP layers active | Must not claim `accepted` as peer-visible compliance; local `reviewed` or decline |

## Feature Inventory

| Existing file/function/contract | Replacement / extension | Task |
|---|---|---|
| `AdoptionStateRecordV1` (state only) | V2 + overlays, harnessId, enforcementGrade | Task 1 |
| `ADOPTION_LIFECYCLE.md` overlays not in schema | Schema + spec sync; dual-path peer rules | Tasks 1–2 |
| `scripts/adoption-state.ts` bare transitions | Persist grade/overlays; peer-advertisability helper | Task 3 |
| `scripts/safe-append.ts` auto reviewed→accepted | Profile-aware grade + overlays; no false peer elevation | Task 5 |
| `TrustStateCapsuleV2` coverage only | Adoption disclosure summary fields | Task 6 |
| `plugin-trust` capsule builder/validator | Emit/validate disclosure; refuse elevation | Tasks 6–7 |
| `verify-install` adoption check | Local vs peer-advertisable report; bind Plan 11 probes | Task 8 |
| CAPABILITY_STATUS adoption row PARTIAL | Graded claims status + gaps | Task 9 |

## Progress Tracking

- [x] Task 1: Protocol-core adoption V2 schema (overlays, harness, grade)
- [x] Task 2: Governance spec + examples for dual-path graded acceptance
- [x] Task 3: Adoption ledger helpers and peer-advertisability policy
- [x] Task 4: AdoptionDisclosure type + parse/validate rules
- [x] Task 5: Wire adopt / safe-append / revoke for profile-graded records
- [x] Task 6: Capsule summary fields + trust-plugin emission
- [x] Task 7: Peer validation — refuse elevating declaration-only / prompt-only
- [x] Task 8: verify-install graded adoption report (bind Plan 11 probes)
- [x] Task 9: CAPABILITY_STATUS, MEMORY-ENTRY, COMPATIBILITY, program index
- [x] Task 10: End-to-end tests for local accepted vs peer disclosure ceilings

**Total Tasks:** 10 | **Completed:** 10 | **Remaining:** 0

## Implementation Tasks

### Task 1: Protocol-core adoption V2 schema (overlays, harness, grade)

**Objective:** Extend protocol-core so adoption records can carry overlay flags, harness identity, and enforcement grade without introducing a new lifecycle state.

**Files:**
- Modify: `packages/protocol-core/src/adoption.ts`
- Modify: `packages/protocol-core/src/adoption.test.ts`
- Modify: `packages/protocol-core/src/index.ts`
- Modify: `docs/governance/examples/adoption-transitions.json` (align hyphenation / overlays if needed)

**Steps:**
1. Write failing tests for overlay flags, `harnessId`, `enforcementGrade`, and rejection of unknown grades (RED).
2. Add `ADOPTION_OVERLAY_FLAGS` and `ENFORCEMENT_GRADES` constants; introduce `AdoptionStateRecordV2` (or additive versioned fields) while keeping V1 parseable (GREEN).
3. Export parsers that never silently upgrade V1 → peer-advertisable.
4. Run package tests + typecheck on touched files.

**Definition of Done:**
- [x] Target tests pass
- [x] No new type errors
- [x] No new linter errors
- [x] V1 records still parse; V2 requires explicit schemaVersion

### Task 2: Governance spec + examples for dual-path graded acceptance

**Objective:** Document that `accepted` is constitutional self-binding; peer representation is a separate advertisability class capped by enforcement grade.

**Files:**
- Modify: `docs/governance/ADOPTION_LIFECYCLE.md`
- Modify: `docs/governance/EVIDENCE_SEMANTICS.md` (uncertainty / max conclusions for graded adoption ads)
- Create: `docs/governance/examples/graded-adoption-claims.json`
- Modify: `docs/governance/README.md` (index entry if needed)

**Steps:**
1. Specify dual path: local `accepted` after `reviewed` always allowed; peer-advertisable requires probe evidence.
2. Specify prompt-only → mandatory `runtime_degraded`; peer assurance `declaration-only`; no completeness elevation.
3. Add examples for native-hook, tool-proxy (partial), and prompt-only cases.
4. Cross-link Plan 11 harness capability matrix vocabulary.

**Definition of Done:**
- [x] Spec distinguishes local acceptance vs peer advertisability
- [x] Examples cover all four enforcement grades
- [x] No claim that prompt-only equals dispatcher compliance
- [x] Dependent docs updated (if applicable)

### Task 3: Adoption ledger helpers and peer-advertisability policy

**Objective:** Persist graded adoption records and compute whether a current ledger state may be peer-advertised.

**Files:**
- Modify: `scripts/adoption-state.ts`
- Modify: `scripts/adoption-state.test.ts`

**Steps:**
1. RED: tests for appending V2 records with overlays/grade; `peerAdvertisable(record, probe)` false for `prompt-only` / `none` / missing probe.
2. GREEN: extend `appendAdoptionState` inputs; add `computePeerAdvertisability` (or equivalent) pure helper.
3. Preserve transition table; overlays may change without changing base state.
4. Typecheck/lint touched files.

**Definition of Done:**
- [x] Target tests pass
- [x] Invalid transitions still fail
- [x] Prompt-only never returns peer-advertisable
- [x] Tool-proxy returns peer-advertisable only with partial/degraded disclosure flags

### Task 4: AdoptionDisclosure type + parse/validate rules

**Objective:** Define a signed/attestable disclosure artifact peers can verify without reading private logs.

**Files:**
- Create: `packages/protocol-core/src/adoption-disclosure.ts`
- Create: `packages/protocol-core/src/adoption-disclosure.test.ts`
- Modify: `packages/protocol-core/src/index.ts`

**Steps:**
1. RED: parse tests for `assurance: peer-advertisable | declaration-only`, required grade/overlays, constitution hash, harnessId.
2. GREEN: schema + `parseAdoptionDisclosure`; reject combinations that elevate prompt-only.
3. Document max justified conclusion per assurance class (align Evidence Semantics).

**Definition of Done:**
- [x] Target tests pass
- [x] No new type errors
- [x] No new linter errors
- [x] Invalid elevation combinations fail closed

### Task 5: Wire adopt / safe-append / revoke for profile-graded records

**Objective:** `npm run adopt` records harness-scoped graded acceptance; revoke preserves history and clears peer ads honestly.

**Files:**
- Modify: `scripts/safe-append.ts`
- Modify: `scripts/revoke.ts`
- Modify: `scripts/safe-append.test.ts` (or create if missing)
- Modify: `package.json` scripts if new flags needed (`--profile`)

**Steps:**
1. RED: adopt with `--profile cursor` (or fixture) writes `reviewed` then `accepted` with grade from capability fixture/probe stub.
2. GREEN: prompt-only profile sets `runtime_degraded`; never marks peer-advertisable in local notes/disclosure builder input.
3. Revoke annotates ledger; subsequent peer disclosure must not claim active acceptance.
4. Keep human MEMORY/SOUL append behavior; update templates only as needed for grade honesty.

**Definition of Done:**
- [x] Target tests pass
- [x] Installation still ≠ acceptance
- [x] Profile grade appears on ledger records
- [x] No new type/lint errors on touched files

### Task 6: Capsule summary fields + trust-plugin emission

**Objective:** TrustStateCapsule carries an adoption disclosure summary so peers see grade/assurance without raw ledgers.

**Files:**
- Modify: `packages/protocol-core/src/capsules.ts`
- Modify: `packages/protocol-core/src/capsules.test.ts`
- Modify: `plugin-trust/src/capsule.ts`
- Modify: `plugin-trust/src/tools.ts` (and/or handshake emission path)
- Test: `plugin-trust/src/capsule.test.ts` or extend existing capsule tests

**Steps:**
1. RED: capsule without disclosure summary fails new peer-summary contract when adoption is advertised; with prompt-only disclosure, completeness cannot be `full`.
2. GREEN: optional `adoptionDisclosure` (or summary ref) on capsule build/validate; wire from current adoption ledger + probe.
3. Keep backward-compatible parse for older capsules (missing field → no adoption advertisement).

**Definition of Done:**
- [x] Target tests pass
- [x] Capsule + ledger fields stay consistent
- [x] Legacy capsules still parse
- [x] No new type/lint errors

### Task 7: Peer validation — refuse elevating declaration-only / prompt-only

**Objective:** Verifiers must not treat declaration-only or prompt-only disclosures as boundary-attested enforcement.

**Files:**
- Modify: `plugin-trust/src/capsule.ts` (validate path)
- Modify: `plugin-trust/src/handshake.ts` and/or trust evaluation call sites as needed
- Test: `plugin-trust/src/adoption-disclosure-validate.test.ts` (create)

**Steps:**
1. RED: peer validation attempting to upgrade `declaration-only` → high completeness / behavioral confidence fails.
2. GREEN: explicit reject/downgrade diagnostics; tool-proxy capped at partial.
3. Ensure steward/trust views record assurance class separately from reputation.

**Definition of Done:**
- [x] Target tests pass
- [x] Elevation attempts fail closed
- [x] Diagnostics name the grade and assurance
- [x] No new type/lint errors

### Task 8: verify-install graded adoption report (bind Plan 11 probes)

**Objective:** `verify-install --profile <harness>` reports installation, local adoption state, enforcement grade, and peer-advertisability separately.

**Files:**
- Modify: `scripts/verify-install.ts`
- Modify: `scripts/verify-install.test.ts`
- Reference: `adapters/harness-capabilities.json` (from Plan 11; use fixture stub if Plan 11 not yet merged at implement time)

**Steps:**
1. RED: fixture where MEMORY says adopted but grade is prompt-only → PASS local acceptance, FAIL or WARN peer-advertisable compliance claim.
2. GREEN: graded report sections; never false-PASS dispatcher when probe says prompt-only/none.
3. Document exit codes / warning classes for CI operators.

**Definition of Done:**
- [x] Target tests pass
- [x] Local vs peer columns are distinct in output
- [x] Unknown harness does not false-PASS dispatcher
- [x] Dependent docs updated (if applicable)

### Task 9: CAPABILITY_STATUS, MEMORY-ENTRY, COMPATIBILITY, program index

**Objective:** Documentation matches dual-path graded claims; program index lists Plan 13.

**Files:**
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `adoption/MEMORY-ENTRY.md`
- Modify: `docs/COMPATIBILITY.md`
- Modify: `docs/plans/2026-07-10-autonomy-harness-program-index.md`
- Modify: `docs/governance/README.md` (if disclosure examples indexed)

**Steps:**
1. Update adoption row: graded harness claims PARTIAL/SHIPPED per what Task 1–8 deliver; state remaining gaps.
2. MEMORY template mentions overlays/grade and that peer ads may be declaration-only.
3. COMPATIBILITY: graded adapter language includes adoption advertisability ceilings.
4. Index Plan 13 with dependency on 8+11.

**Definition of Done:**
- [x] CAPABILITY_STATUS row matches code
- [x] No present-tense overclaim of gateway enforcement
- [x] Program index lists Plan 13
- [x] MEMORY/COMPATIBILITY honest about prompt-only

### Task 10: End-to-end tests for local accepted vs peer disclosure ceilings

**Objective:** Prove the adoption-stance path end-to-end: reviewed → local accepted with grade; peer ceiling enforced.

**Files:**
- Create: `test/graded-harness-adoption-e2e.test.ts`
- Modify: existing e2e helpers if needed (`test/conformance-receipt-e2e.test.ts` patterns)

**Steps:**
1. RED: three fixtures — native-hook peer-advertisable; tool-proxy partial peer-advertisable; prompt-only declaration-only.
2. GREEN: adopt → ledger → disclosure → capsule validate for each; assert ceilings.
3. Assert revoke removes peer-active acceptance without erasing history.

**Definition of Done:**
- [x] E2E tests pass
- [x] All three grade ceilings covered
- [x] Revocation history preserved
- [x] No new type/lint errors

## Testing Strategy

- Unit: protocol-core adoption V2, disclosure parse, advertisability policy.
- Script: adoption-state, safe-append profile adopt, verify-install graded report.
- Plugin-trust: capsule emission + elevation refusal.
- E2E: three-grade matrix in `test/graded-harness-adoption-e2e.test.ts`.
- If Plan 11 adapters are not yet present at implement time, use checked-in capability fixtures that match Plan 11’s intended `harness-capabilities.json` shape; re-point to real probes when Plan 11 lands (do not block schema/ledger on full Cursor binary).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Operators treat local `accepted` as peer compliance | verify-install + capsule validation separate columns; docs emphasize dual path |
| Plan 11 not implemented yet | Fixture-compatible capability matrix; Task 8 binds when probes exist |
| Schema break for existing ledgers | Keep V1 parseable; V2 opt-in; no silent upgrade |
| Tool-proxy overclaimed as native-hook | Probe-driven grade only; tests forbid manual elevation without probe |
| Capsule bloat / PII | Summary fields only (hash, grade, assurance, overlays) — no raw MEMORY |
| Confusion with `externally_enforced` | Spec: operator-forced policy remains distinct from voluntary `accepted` even when grade is high |
