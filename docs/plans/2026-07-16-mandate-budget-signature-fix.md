# Issue #5: Mandate Budget Self-Invalidates Signature

**Status:** COMPLETE
**Created:** 2026-07-16
**Depends on:** Plan 8 (mandate store), Plan 9 (quorum issuance), Plan 10 (enforcement-core extraction)
**Unblocks:** Multi-action budgeted operator/quorum mandates; honest revoke without signature death; diagnosable mandate integrity failures
**Scope:**
- **In:** Separate unsigned ledger for `remainingActions` + `revoked`; stop signing mutable fields for new mandates; dual-verify legacy signatures; auto-migrate already-broken on-disk mandates; `emitAuditGap` + structured audit diagnostics; quorum write/revoke/sign/digest alignment; TROUBLESHOOTING; patch bumps for protocol-core, enforcement-core, trust-core, and enforcement plugin.
- **Out (confirmed):** ClawHub publish; changing seed constitution hash; gateway RFC; removing `remainingActions` from the `StandingMandateV1` schema (field remains for issuance seed / human readability; ledger is authoritative at runtime).

## Summary

Budgeted standing mandates self-invalidate on first `debit()` because `remainingActions` lives inside the Ed25519-signed payload. `findCoverage()` then swallows verification failure and looks like “no mandate.” The same mutation pattern breaks revoke (`revoked: true` on the signed blob).

This plan separates the signed grant from the mutable ledger, stops signing mutable fields going forward, dual-verifies legacy signatures, auto-repairs already-debited stores when restore-to-`maxActions` verifies, and surfaces integrity failures via both `FPP AUDIT-GAP` and a chained audit entry.

## Locked design choices (2026-07-16)

| ID | Choice |
|----|--------|
| Q1-C | Unsigned ledger **and** exclude `remainingActions` / `revoked` from new signed payloads (dual-verify legacy). |
| Q2-A | Move `revoked` into the unsigned ledger in this plan. |
| Q3-C | Both `emitAuditGap` and a structured audit-log diagnostic entry. |
| Q4-A | Auto-migrate on reload when restore-`remainingActions`-to-`maxActions` verifies; seed ledger from the decremented value; emit diagnostic. |
| Q5-A | Extend `fpp-mandates.json` with a sibling `ledgers` map keyed by `mandateId`. |
| Q6-A | Code + tests + TROUBLESHOOTING; bump protocol-core, enforcement-core, trust-core, and enforcement plugin patch versions (publish later). |

## Architecture Notes

```
StandingMandateV1 (signed grant — immutable after put)
  signature covers mandateSigningFields(m):
    all fields except signature, budgets.remainingActions, revoked

MandateStoreFile (schemaVersion: 1, additive)
  mandates: StandingMandateV1[]
  ledgers: {
    [mandateId]: { remainingActions?: number, revoked?: boolean }
  }

findCoverage:
  dual-verify signature (new payload, else legacy full-minus-sig)
  validity window / scope
  ledger.revoked !== true
  ledger budget (undefined remaining ⇒ unlimited)
  on verify failure → diagnostic callback (gap + audit)

debit(mandateId):
  mutate ledgers[id].remainingActions only — never the signed mandate

revoke(mandateId):
  set ledgers[id].revoked = true — never mutate signed mandate

reload migration (Q4-A):
  if verify fails AND maxActions set:
    try remainingActions = maxActions → verify
    on success: freeze signed field at maxActions;
                seed ledger.remaining from prior on-disk remaining;
                diagnostic
```

**Quorum path:** `QuorumSessionManager` currently bypasses `MandateStore` with private `readStore`/`writeStore`/`writeMandate`/`revokeMandate`. Those must become ledger-aware and must sign via `mandateSigningFields`. `computeIntendedMandateDigest` excludes `remainingActions` so proposal digests match grant terms (not the mutable ledger). Open in-flight proposals minted under the old digest may fail finalize after upgrade — document in TROUBLESHOOTING (re-propose).

**Diagnostics wiring:** `MandateStore` stays file-IO pure via optional `onDiagnostic` callback. `createRuntimeAdapter` wires it to `emitAuditGap` + a chained audit entry (synthetic enforcement/diagnostic event with classification `fpp.mandate.integrity`).

**Backward compatibility:** Undebited legacy mandates (signed with `remainingActions` in payload) still verify via dual-verify. Already-debited broken files auto-migrate when restore-to-`maxActions` works (issuance always set `remainingActions === maxActions`). Mandates without `maxActions` that are already broken require re-issue.

## Feature Inventory

| Existing file/function/contract | Replacement / change | Task |
|---|---|---|
| `verifyMandateSignature` signs full object minus `signature` | Dual-verify: `mandateSigningFields` then legacy | 1–2 |
| `debit()` mutates `mandate.budgets.remainingActions` | Mutate `ledgers[id].remainingActions` only | 2 |
| `findCoverage` `catch { continue }` silent | Diagnostic callback + skip | 2, 5 |
| `validateMandateValidity` `revoked` on signed blob | Authoritative `ledgers[id].revoked`; stop mutating signed `revoked` | 2, 3, 4 |
| `QuorumSessionManager.revokeMandate` sets `revoked: true` on mandate | Ledger-only revoke | 4 |
| `QuorumSessionManager.writeMandate` / finalize sign | Sign with `mandateSigningFields`; seed ledger | 3–4 |
| `computeIntendedMandateDigest` includes `remainingActions` | Digest budgets without `remainingActions` | 3 |
| Test `signMandate` helpers (enforcement, tool-proxy, e2e) | Sign via shared fields helper | 6 |
| No migration for broken stores | Auto-migrate on reload (Q4-A) | 2 |
| TROUBLESHOOTING quorum abstain row | Budget/signature self-invalidate + migration notes | 7 |
| Package versions 1.0.0 / plugin 1.1.9 | Patch bumps + `PACKAGE_VERSION` constants | 8 |

## Progress Tracking

- [x] Task 1: Shared signing fields + dual-verify helpers (protocol-core)
- [x] Task 2: MandateStore ledger, immutable debit, migration, coverage regression
- [x] Task 3: Quorum intended digest + finalize sign with new payload
- [x] Task 4: Quorum writeMandate seed ledger + revokeMandate ledger-only
- [x] Task 5: Diagnostics — `onDiagnostic` + audit entry + runtime-adapter wire
- [x] Task 6: Align test helpers + cross-package / e2e coverage
- [x] Task 7: TROUBLESHOOTING (+ brief CAPABILITY_STATUS/COMPATIBILITY if needed)
- [x] Task 8: Patch version bumps (protocol / enforcement / trust / plugin)

**Total Tasks:** 8 | **Completed:** 8 | **Remaining:** 0

## Implementation Tasks

### Task 1: Shared signing fields + dual-verify helpers (protocol-core)

**Objective:** Canonical unsigned payload for new mandates excludes `signature`, `budgets.remainingActions`, and `revoked`. Provide dual-verify so legacy signatures (payload includes `remainingActions`) still work.

**Files:**
- Modify: `packages/protocol-core/src/mandates.ts`
- Modify: `packages/protocol-core/src/index.ts` (exports)
- Test: `packages/protocol-core/src/mandates.test.ts`

**Steps:**
1. RED: `mandateSigningFields` omits mutable fields; canonicalize differs when only `remainingActions` changes; dual-verify accepts legacy-shaped signatures and new-shaped signatures.
2. GREEN: implement helpers (no Ed25519 dependency required in unit tests beyond canonicalize shape, or use protocol-core `verifySignature` if already exported).
3. Export types for store file ledger entries if they belong in protocol-core (shared by enforcement + trust); otherwise keep file type in enforcement-core and duplicate the additive `ledgers` shape in trust-core with a comment pointing at the canonical definition — prefer one shared `MandateStoreFile` type in protocol-core.
4. Run `npm test -w @ovrsr/fpp-protocol-core` and typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Helpers exported from protocol-core index

### Task 2: MandateStore ledger, immutable debit, migration, coverage regression

**Objective:** Fix Issue #5: after N debits within budget, `findCoverage` still returns the mandate and the on-disk signature still verifies. Auto-migrate already-broken stores per Q4-A.

**Files:**
- Modify: `packages/enforcement-core/src/mandate-store.ts`
- Modify: `packages/enforcement-core/src/index.ts` (export ledger types / `revoke` if public)
- Test: `packages/enforcement-core/src/mandate-store.test.ts`

**Steps:**
1. RED regression: put budgeted mandate → `findCoverage` ok → `debit` → `findCoverage` still ok → `getRemaining` decremented; signature verify still true against frozen mandate blob.
2. RED: over-budget via ledger returns null; unlimited (`remainingActions` undefined in ledger) still covers.
3. RED: revoke via store API → coverage null while signed blob unchanged / still verifies.
4. RED: load pre-broken file (`remainingActions` decremented under legacy signature) → reload migrates → coverage works with ledger remaining = prior decremented value.
5. GREEN: extend store file with `ledgers`; `put` seeds ledger; `debit`/`getRemaining`/`hasBudget`/`findCoverage` use ledger; dual-verify; migration on reload; never mutate signed mandate fields after successful `put` (except migration restore of `remainingActions` to `maxActions`).
6. Run enforcement-core tests + typecheck.

**Definition of Done:**
- [ ] Issue #5 regression test passes
- [ ] Migration test passes
- [ ] No new type errors
- [ ] No new linter errors

### Task 3: Quorum intended digest + finalize sign with new payload

**Objective:** New quorum-issued mandates sign `mandateSigningFields`; proposal `mandateDigest` agrees on grant terms without `remainingActions`.

**Files:**
- Modify: `packages/trust-core/src/quorum-session.ts`
- Test: `packages/trust-core/src/quorum-session.test.ts`
- Test: `packages/trust-core/src/security-regressions.test.ts` (digest/sign expectations if any)

**Steps:**
1. RED: `computeIntendedMandateDigest` identical for budgets that differ only in `remainingActions`; finalize signature verifies via new signing fields; MandateStore dual-verify accepts issued mandate.
2. GREEN: strip `remainingActions` inside digest value; finalize uses `mandateSigningFields` (+ `publicKey`) as the signed message.
3. Keep `remainingActions` on the issued mandate object for ledger seeding (`=== maxActions` as today).
4. Run trust-core tests + typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors

### Task 4: Quorum writeMandate seed ledger + revokeMandate ledger-only

**Objective:** Quorum finalize/revoke write the shared store format correctly without invalidating signatures.

**Files:**
- Modify: `packages/trust-core/src/quorum-session.ts` (`MandateStoreFile`, `writeMandate`, `revokeMandate`, `readStore`)
- Test: `packages/trust-core/src/quorum-session.test.ts`

**Steps:**
1. RED: after finalize, store JSON has `ledgers[mandateId].remainingActions`; after revoke, signed mandate lacks authoritative revoke mutation — `ledgers[id].revoked === true`; enforcement `MandateStore.findCoverage` returns null; signature still verifies.
2. GREEN: implement ledger-aware read/write/revoke; preserve unknown future fields when rewriting the file when practical.
3. Run trust-core tests; optionally a thin integration asserting enforcement-core `MandateStore` can read a quorum-written file.

**Definition of Done:**
- [ ] Target tests pass
- [ ] Revoke no longer mutates signed `revoked` as the sole mechanism
- [ ] No new type errors
- [ ] No new linter errors

### Task 5: Diagnostics — onDiagnostic + audit entry + runtime-adapter wire

**Objective:** Signature verification failures and successful migrations are distinguishable from “no mandate” via `FPP AUDIT-GAP` and a chained audit-log entry (Q3-C).

**Files:**
- Modify: `packages/enforcement-core/src/mandate-store.ts` (`MandateStoreOptions.onDiagnostic`)
- Modify: `packages/enforcement-core/src/audit-log.ts` (diagnostic append helper or documented synthetic `EnforcementEvent` shape)
- Modify: `packages/enforcement-core/src/runtime-adapter.ts` (wire callback)
- Test: `packages/enforcement-core/src/mandate-store.test.ts`
- Test: `packages/enforcement-core/src/audit-log.test.ts` and/or `runtime-adapter.test.ts`

**Steps:**
1. RED: verify failure in `findCoverage` invokes diagnostic with mandateId + reason; migration emits diagnostic; audit helper appends chainable entry (classification `fpp.mandate.integrity` or dedicated kind — pick one and document; prefer additive kind only if existing verifiers tolerate it; otherwise synthetic enforcement event with clear reason).
2. GREEN: implement callback + adapter wiring (`emitAuditGap` + audit append); never throw from diagnostics.
3. Run enforcement-core tests + typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] Gap string and audit entry both produced in unit coverage
- [ ] No new type errors
- [ ] No new linter errors

### Task 6: Align test helpers + cross-package / e2e coverage

**Objective:** All `signMandate` helpers and e2e fixtures sign the new payload so green builds don’t reintroduce legacy-only signing.

**Files:**
- Modify: `packages/enforcement-core/src/mandate-store.test.ts` (already updated in Task 2 — ensure helper uses shared fields)
- Modify: `packages/tool-proxy/src/index.test.ts`
- Modify: `test/cross-harness-adapters-e2e.test.ts`
- Modify: `test/quorum-mandate-e2e.test.ts` (if present and signs locally)
- Modify: `plugin-trust/src/tools.ts` only if propose path must document that `remainingActions` is ledger seed, not signed term (behavior may already set `remainingActions: maxActions` — no change unless digest call sites need stripping)

**Steps:**
1. RED/adjust: helpers call `mandateSigningFields` (or equivalent) before `signMessage`.
2. Add or extend e2e: budgeted mandate allows ≥2 tool calls under unattended disposition without falling through to abstain after first debit.
3. Run affected package tests + root e2e targets used by CI for mandates/quorum.

**Definition of Done:**
- [ ] Cross-package sign helpers aligned
- [ ] Multi-debit e2e or integration coverage green
- [ ] No new type errors

### Task 7: TROUBLESHOOTING (+ brief status/compat notes)

**Objective:** Operators can diagnose “abstain after one allow” as mandate signature/budget ledger issues, know about auto-migration, and know to re-propose open quorum sessions after upgrade.

**Files:**
- Modify: `docs/TROUBLESHOOTING.md` (unattended / quorum sections)
- Modify: `docs/CAPABILITY_STATUS.md` and/or `docs/COMPATIBILITY.md` only if a claim about mandate budgets/signing must stay honest

**Steps:**
1. Document symptoms (allow then abstain for same mandate; double audit for same toolCallId).
2. Document ledger field, migration behavior, and “re-propose open quorum” after digest change.
3. Update the existing quorum abstain troubleshooting row if it omits signature self-invalidate.

**Definition of Done:**
- [ ] TROUBLESHOOTING updated
- [ ] No contradictory capability claims left stale

### Task 8: Patch version bumps

**Objective:** Consumable packages advertise the fix for publish later (Q6-A).

**Files:**
- Modify: `packages/protocol-core/package.json` + `PACKAGE_VERSION` in `src/index.ts` → `1.0.1`
- Modify: `packages/enforcement-core/package.json` + `PACKAGE_VERSION` → `1.0.1`
- Modify: `packages/trust-core/package.json` + `PACKAGE_VERSION` (if exported) → `1.0.1`
- Modify: `plugin/package.json` (+ lock sync) → `1.1.10`; dependency pins on cores → `1.0.1` as required by workspace publish practice
- Modify: `plugin-trust/package.json` dependency pins on trust/protocol if they declare exact versions and must track the digest/sign fix

**Steps:**
1. Bump versions and constants.
2. Sync plugin lockfile root version via project’s usual `npm install --package-lock-only` pattern (with `--ignore-engines` if needed).
3. Confirm `npm test` for touched workspaces still passes after bumps (no publish in this plan).

**Definition of Done:**
- [ ] Versions bumped consistently
- [ ] Touched workspace tests still pass
- [ ] No publish attempted

## Testing Strategy

- **Unit (protocol-core):** signing-field omission; dual-verify acceptance of legacy vs new payloads.
- **Unit (enforcement-core):** Issue #5 regression (debit → still covered); ledger exhaustion; revoke-via-ledger; auto-migration of broken file; diagnostic callback fired.
- **Unit (trust-core):** digest ignores `remainingActions`; finalize verifies under new rules; revoke writes ledger; enforcement store can consume quorum-written file.
- **Integration / e2e:** ≥2 allows under one budgeted mandate without post-debit abstain.
- **TDD order:** every production change starts from a failing test in the owning package.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Open quorum proposals have old `mandateDigest` including `remainingActions` | Document re-propose; digest change is intentional and scoped |
| Broken mandate without `maxActions` cannot auto-migrate | Diagnostic + TROUBLESHOOTING: re-issue mandate |
| Quorum and MandateStore diverge on file shape | Shared `MandateStoreFile` type in protocol-core; Task 4/2 both write `ledgers` |
| Diagnostic audit kind breaks external verifiers | Prefer synthetic enforcement-shaped entry unless verifiers already allow unknown kinds; confirm against existing audit tests |
| Dual-verify accepts tampered `remainingActions` on legacy blobs | Expected for legacy; ledger is authoritative for budget after migration/put; new signatures ignore the field |

## Definition of Done (plan-level)

- [ ] Budgeted mandate survives multiple `findCoverage` + `debit` cycles with valid signature
- [ ] Revoke uses ledger; signed blob remains verifiable
- [ ] Broken on-disk mandates with `maxActions` auto-migrate
- [ ] Signature failures emit AUDIT-GAP + audit entry
- [ ] Quorum finalize/revoke aligned
- [ ] Docs updated; patch versions bumped; tests green
