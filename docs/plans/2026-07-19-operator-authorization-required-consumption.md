# Operator Authorization Required-Only Consumption

**Status:** COMPLETE
**Created:** 2026-07-19
**Issue:** [#6](https://github.com/ovrsr/freedom-preserving-protocol/issues/6)
**Scope:**
- **In:** Consume a steward operator authorization only when it changes the final tool-boundary result from block/approval to allow; prove broad grants do not debit ordinary allows; document the resulting consumption semantics.
- **Out:** Changing signed authorization wire formats, ledger atomicity, scope matching, hard floors, authorization quotas, classifier classifications, or live gateway deployment.

## Summary

Issue #6 reports that a broad admitted operator authorization loses uses on benign confirmation calls. The current runtime performs `lookupStewardOperatorCoverage()` before resolving disposition and installs any matching operator grant as `liveMandate`. Since mandates take precedence over ordinary allow paths, the runtime chooses the operator mandate and calls `consumeIfValid()` even when the same action would already be permitted by `standingAllowOn`, an explicit classifier allow, or another ordinary allow disposition.

The remediation changes selection order, not authorization validity: resolve the baseline disposition without steward coverage first. Only if that baseline maps to a blocking or approval result may a valid steward candidate be applied and consumed. The existing hard-floor-first disposition behavior remains authoritative. A qualifying operator authorization is still revalidated and atomically recorded before the final allow.

## Architecture Notes

Current behavior:

```text
classify action
  -> find ordinary mandate + matching steward grant
  -> resolve disposition with steward grant
  -> operator grant wins mandate precedence
  -> consume steward authorization
```

Target behavior:

```text
classify action
  -> resolve baseline without steward grant
  -> baseline already allows: return it; do not inspect/consume steward grant
  -> baseline blocks or requires approval: look up matching steward grant
  -> resolve with the grant
  -> atomically consume only if the operator grant supplies final allow
```

`legacyDecisionFromDisposition()` defines whether a disposition actually permits tool execution: `allow`, `allow_staged`, and `allow_minimal` map to `allow`; `deny`/`abstain` map to `block`; and `require_approval` maps to `approval`. Required-only selection must use this execution result rather than only testing for a literal `disposition === "allow"`, so a grant does not debit when any ordinary allow-capable disposition already permits the call.

Existing non-operator mandates retain their current precedence and debit behavior. A matching steward grant may be considered only after the baseline result is non-allowing; no fallback may bypass a classifier or configured hard floor.

## Feature Inventory

| Existing surface | Required treatment | Task |
|---|---|---|
| `createEnforcementRuntime().onBeforeToolCall()` | Resolve ordinary disposition before operator coverage; consult/consume steward authorization only when baseline is non-allowing | 1 |
| Steward coverage runtime tests | Add regression coverage for broad `exec.benign` grants and preserve required-action, hard-floor, and atomic-consumption behavior | 1 |
| Steward authorization architecture guide | Define use consumption as required-only and distinguish it from authorization admission | 2 |
| Troubleshooting operator-authorization guidance | Explain why routine allowed confirmations do not decrement `remainingUses` | 2 |

## Progress Tracking

- [x] Task 1: Gate steward consumption on required authorization
- [x] Task 2: Document required-only authorization use semantics

**Total Tasks:** 2 | **Completed:** 2 | **Remaining:** 0

## Implementation Tasks

### Task 1: Gate steward consumption on required authorization

**Objective:** Preserve all current fail-closed and atomic-consumption guarantees while preventing an eligible steward authorization from overriding and debiting an already permitted ordinary execution path.

**Files:**
- Modify: `packages/enforcement-core/src/runtime-adapter.ts`
- Test: `packages/enforcement-core/src/steward-coverage.test.ts`

**Steps:**
1. RED: add a runtime regression fixture for an admitted standing grant whose scope includes `exec.benign`. Configure an ordinary allow-capable path for that classification, invoke a benign confirmation call, and assert it returns allow with no `authorization_consumed` ledger event and unchanged `remainingUses`.
2. RED: cover each ordinary allow-capable baseline relevant to the disposition ladder—standing allowlist, classifier allow, and staged/reversible allow—so required-only determination is based on the execution decision rather than a single disposition literal.
3. RED: retain or add paired tests proving a matching operator grant is consumed exactly once when the ordinary result is block or require-approval, and that a configured/classifier hard floor remains denied and unconsumed even when the grant matches.
4. Run the focused steward coverage test and confirm the new assertions fail because the runtime currently performs steward lookup before baseline resolution.
5. GREEN: in `onBeforeToolCall()`, calculate the ordinary disposition from existing non-operator mandate, config, emergency, and strict-override inputs. Skip steward lookup entirely when `legacyDecisionFromDisposition(baseline)` is `allow`; otherwise look up coverage, re-resolve with a matched operator mandate, and retain the existing `consumeIfValid()`-before-final-allow flow.
6. Ensure a failed atomic consume recomputes only from non-operator coverage and never converts a baseline block/approval into an implicit allow; retain current audit evidence only for an authorization actually consumed.
7. Run the focused tests, enforcement-core test suite, and enforcement-core typecheck.

**Definition of Done:**
- [x] A matching broad grant does not consume a use for an ordinary benign allow
- [x] Ordinary standing, classifier, and staged/reversible allow paths do not debit operator grants
- [x] An otherwise blocked or approval-gated matching action consumes exactly one grant use before allow
- [x] Hard floors remain deny and leave matching grants unconsumed
- [x] Consumption-race/failure recomputation remains fail closed
- [x] Enforcement-core target tests and typecheck pass
- [x] No new linter errors (N/A unless a lint script is added)

### Task 2: Document required-only authorization use semantics

**Objective:** Make grant operators aware that admission records a grant but does not itself consume it, and that covered calls decrement uses only when the grant is required to permit execution.

**Files:**
- Modify: `docs/architecture/steward-operator-authorization.md`
- Modify: `docs/TROUBLESHOOTING.md`

**Steps:**
1. Update the maintainer sequence and architecture narrative to distinguish admission from transactional consumption at a necessary authorization boundary.
2. Document that broad grants do not decrement for ordinary allow-capable calls such as benign confirmations, while a call that requires the operator grant still consumes one use before execution.
3. Explicitly state that matching alone is insufficient for consumption, but hard floors remain unbypassable and unconsumed.
4. Check every referenced command or behavior against the implementation and focused test outputs; do not make live-gateway deployment claims.
5. Validate changed Markdown links/anchors using the repository’s available documentation-safe checks or a focused read-only equivalent.

**Definition of Done:**
- [x] Architecture documentation accurately describes required-only consumption
- [x] Troubleshooting guidance explains unchanged use counts for routine allowed confirmations
- [x] Documentation preserves hard-floor and atomic-consumption constraints
- [x] No live deployment claim is added without fresh live evidence
- [x] No broken documentation links introduced

## Testing Strategy

### RED evidence

```bash
npx tsx --test packages/enforcement-core/src/steward-coverage.test.ts
```

The new regression assertions must fail against the current eager operator-coverage selection because matching ordinary `exec.benign` calls append `authorization_consumed`.

### GREEN and regression evidence

```bash
npx tsx --test packages/enforcement-core/src/steward-coverage.test.ts
npm test -w @ovrsr/fpp-enforcement-core
npm run typecheck -w @ovrsr/fpp-enforcement-core
```

Implementation verification must demonstrate all new regression cases passing, including no-consumption ordinary allows, required-action consumption, hard-floor precedence, and failed-consumption fallback.

## Risks & Mitigations

- **Accidentally debiting on an alternate allow:** Derive requiredness from the existing `legacyDecisionFromDisposition()` execution mapping, not from one selected disposition name.
- **Bypassing a hard floor:** Calculate baseline through `resolveDisposition()` so its hard-floor check remains first and never attempt stewardship after a final ordinary deny caused by that floor.
- **Breaking atomicity:** Keep `AuthorizationService.consumeIfValid()` as the sole state-changing claim immediately before authorization-derived allow.
- **Changing existing mandate behavior:** Baseline lookup continues to use the existing mandate store; this remediation only changes when the parallel steward path is added.
- **Misleading operators:** Update permanent architecture and troubleshooting documentation in the same change and avoid claiming live deployment verification.

## Handoff

Review the selection boundary and test matrix. After approval, run:

`/implement docs/plans/2026-07-19-operator-authorization-required-consumption.md`
