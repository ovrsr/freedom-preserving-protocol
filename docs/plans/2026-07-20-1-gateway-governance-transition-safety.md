# Gateway Governance Transition Safety

**Status:** COMPLETE
**Created:** 2026-07-20
**Scope:**
- **In:** Specify and demonstrate deterministic gateway governance transitions; add a monotonic governance epoch to disposition receipts; implement bounded quiescing, transition-abort reconciliation, durable disable/enable event ordering, and concurrent-route tests in the non-production gateway reference package.
- **Out:** Upstream OpenClaw gateway integration, claiming gateway enforcement is shipped, replacing plugin/harness enforcement, unbounded graceful draining, cancelling side effects already executing inside a downstream tool, or changing the seed constitution.

## Summary

RFC 0001 requires a tamper-evident `governance-disabled` event before ungated execution resumes, but it does not define what happens to admitted, queued, approval-held, or in-flight calls while governance changes state. The reference gateway currently captures a disposition and immediately invokes the downstream tool without a transition barrier. A rapid toggle could therefore separate the policy state used for a receipt from the state present at invoke time.

This feature adds an explicit `enabled → draining → disabled` state machine and a monotonic governance epoch. Disablement stops admission, permits a bounded drain, marks only not-yet-invoked leftovers with a transition-specific terminal outcome, durably appends the disable event, and only then exposes the ungated state. Every governed invoke rechecks the captured epoch immediately before calling the downstream tool. Re-enablement appends its event before admitting governed calls under the next epoch.

Post-implementation review reproduced a critical mismatch: a call already executing could complete its side effect after the drain deadline while its receipt remained `governance_transition_aborted`. Review also found unfiltered receipt abortion, swallowed receipt-persistence failures, startup on a corrupt governance ledger, and event append/state-publication ambiguity. Tasks 8–10 remediate those findings before this plan can return to `COMPLETE`.

The second post-implementation review found remaining blockers after Tasks 8–10: duplicate `toolCallId` values overwrite active-call ownership and can leave an executing call invisible to drain; `require_approval` throws without resolving the pending receipt; draining waits only on the deadline rather than waking when activity reaches zero; receipt-log appends trust a stored tail hash without validating the existing chain; governance-ledger reload accepts a different constitution/policy context and an existing zero-byte ledger as genesis; and the runtime schema still accepts unpaired governance fields. Tasks 11–12 are a second remediation pass for these concrete failures.

A follow-up review found an asynchronous receipt-creation race: disable can reconcile a route before that route's delayed `onBeforeToolCall()` creates its pending receipt, leaving the subsequently created receipt pending forever. Task 13 makes transition-abort terminalization race-safe.

The implementation remains a CI reference and RFC proof point. `docs/CAPABILITY_STATUS.md` must continue to classify gateway enforcement as `PROPOSED` / upstream `DEFERRED`.

## Architecture Notes

### Locked transition model

```text
enabled(epoch=N)
  -> disable requested
draining(epoch=N)
  -> stop admitting new governed calls
  -> wait no longer than drainTimeoutMs
  -> finalize leftovers as governance_transition_aborted
  -> durably append governance-disabled(epoch=N+1)
disabled(epoch=N+1)
  -> ungated calls may execute; no synthetic allow receipts
  -> enable requested
  -> durably append governance-enabled(epoch=N+2)
enabled(epoch=N+2)
```

- The gateway owns governance mode and epoch; enforcement-core only carries the captured epoch into pending and signed receipts.
- `route()` captures the current epoch before policy evaluation and compares it again at the last responsible moment before `invoke()`.
- Calls admitted under epoch `N` may finish during the bounded drain only while the gateway remains in `draining(N)`. Calls that have not crossed invoke by the deadline are rejected and reconciled explicitly.
- Calls that crossed the invoke boundary are never relabeled aborted. If any remain executing at the deadline, the disable attempt fails without appending `governance-disabled`; governance returns to `enabled(N)` after preserving per-call cancellation for work that was explicitly aborted.
- Each active call has a monotonic phase (`evaluating` → `ready` → `invoking` → terminal). Only `evaluating` / `ready` calls from the draining epoch are eligible for transition abort.
- Disable failure is fail closed: if receipt reconciliation or governance-event persistence fails, the router does not enter `disabled` and does not execute ungated.
- Enable failure leaves the router disabled.
- “Durable” in the reference package means the governance ledger append and verification complete successfully before state publication. It does not imply remote witnessing or tamper prevention.
- Approval-held calls are pending work and cannot make drain unbounded. They are transition-aborted at the deadline.

### Compatibility

- Governance fields added to `ConformanceReceiptV1` are optional for existing receipt readers and required only for calls carrying gateway governance context.
- Existing plugin and harness adapters do not synthesize a governance epoch and retain their current behavior.
- The gateway-reference constructor remains non-default and CI-only. Its existing `enabled` package feature flag must not be confused with runtime governance mode.

## Feature Inventory

| Existing surface | Required treatment | Task |
|---|---|---|
| `ConformanceReceiptV1` and protocol-core exports | Add optional governance mode/epoch binding and shared governance event/state contracts | 1 |
| `FppToolCallContext` / `ReceiptStore` / signed receipt builder | Carry a captured epoch without changing non-gateway callers; support transition-specific reconciliation | 2 |
| Gateway governance audit | Add a verified append-only ledger seam whose append must complete before mode publication | 3 |
| `createGatewayReferenceRouter()` | Replace the static routing-only behavior with explicit mode, epoch, disable, enable, and bounded-drain operations while preserving the package feature flag | 4 |
| Concurrent route/invoke boundary | Reject stale-epoch calls at the final pre-invoke check and prove rapid toggles cannot create mixed-state execution | 5 |
| RFC sequence, example, checklist, and reference README | Define normative transition semantics and keep the reference implementation status honest | 6 |
| Canonical capability status | Record the reference proof without upgrading gateway enforcement to shipped | 7 |
| Active-call phase and transition reconciliation | Abort only pre-invoke calls from the draining epoch; never relabel an executing side effect | 8 |
| Governance-ledger commit/startup semantics | Make append atomic, validate exact state transitions, and refuse startup on unverifiable state | 9 |
| Receipt persistence and gateway-binding contracts | Propagate reconciliation write failures, pair mode/epoch fields, and remove unsupported “reference proof” claims | 10 |
| Active-call identity, approval terminalization, and drain wakeup | Reject duplicate live call IDs, resolve approval-held receipts, and wake draining on activity changes | 11 |
| Durable receipt-chain and governance-context integrity | Validate the existing receipt chain before append, bind ledger reload to configured context, reject empty existing ledgers, and enforce governance field pairing in runtime schema validation | 12 |
| Asynchronous receipt creation during transition abort | Ensure a call cancelled before delayed policy evaluation cannot leave a new receipt pending | 13 |

## Progress Tracking

- [x] Task 1: Add governance transition contracts
- [x] Task 2: Bind governance epoch to receipt lifecycle
- [x] Task 3: Add the reference governance event ledger
- [x] Task 4: Implement bounded quiesce and audited enable/disable
- [x] Task 5: Prove concurrent and rapid-toggle safety
- [x] Task 6: Amend RFC architecture and reference documentation
- [x] Task 7: Reconcile canonical capability claims
- [x] Task 8: Separate pre-invoke cancellation from executing calls
- [x] Task 9: Make governance ledger commit and startup fail closed
- [x] Task 10: Enforce durable filtered reconciliation and receipt binding
- [x] Task 11: Close active-call lifecycle and drain races
- [x] Task 12: Bind durable logs and schemas to verified context
- [x] Task 13: Terminalize delayed receipt creation after transition abort

**Total Tasks:** 13 | **Completed:** 13 | **Remaining:** 0

## Implementation Tasks

### Task 1: Add governance transition contracts

**Objective:** Define reusable, runtime-validated governance modes, epochs, and transition events without implying that gateway enforcement is currently shipped.

**Files:**
- Create: `packages/protocol-core/src/governance.ts`
- Create: `packages/protocol-core/src/governance.test.ts`
- Modify: `packages/protocol-core/src/receipts.ts`
- Modify: `packages/protocol-core/src/receipts.test.ts`
- Modify: `packages/protocol-core/src/index.ts`

**Steps:**
1. RED: add protocol-core tests for `enabled`, `draining`, and `disabled` state records; non-negative monotonic epochs; `governance-enabled` / `governance-disabled` event parsing; and rejection of malformed modes, epochs, actors, hashes, and event kinds.
2. RED: add receipt tests proving optional `governanceEpoch` and `governanceMode` fields accept valid gateway-bound receipts and reject invalid values while legacy receipts remain valid.
3. Run the focused protocol-core tests and confirm they fail because the governance contracts and receipt fields do not exist.
4. GREEN: implement TypeBox schemas, parsers, and exported TypeScript types in `governance.ts`; reuse existing digest/signature primitives rather than introducing a new cryptographic implementation.
5. GREEN: extend `ConformanceReceiptV1Schema` additively and export the new contracts from protocol-core.
6. Run focused tests, the protocol-core suite, typecheck, and linter diagnostics on touched files.

**Definition of Done:**
- [x] Governance state and transition events are runtime validated
- [x] Epochs cannot be negative or non-integral
- [x] Existing receipts without governance fields remain valid
- [x] Gateway-bound receipts reject invalid mode/epoch bindings
- [x] Protocol-core tests and typecheck pass
- [x] No new linter errors

### Task 2: Bind governance epoch to receipt lifecycle

**Objective:** Carry gateway governance context from the tool-call boundary through pending records, transition reconciliation, and signed conformance receipts without altering ordinary plugin/harness behavior.

**Files:**
- Modify: `packages/enforcement-core/src/runtime-adapter.ts`
- Modify: `packages/enforcement-core/src/receipt-store.ts`
- Modify: `packages/enforcement-core/src/receipt-store.test.ts`
- Modify: `packages/enforcement-core/src/index.ts`
- Modify: `plugin/src/index.ts`
- Test: `plugin/src/index.test.ts`

**Steps:**
1. RED: add receipt-store tests proving a proposed call retains its captured `governanceEpoch` / `governanceMode`, and that transition reconciliation produces `status: "orphan"` with outcome `governance_transition_aborted` rather than the generic shutdown outcome.
2. RED: add signed-receipt assertions proving gateway context is included in the canonical signed payload when present and omitted for legacy plugin calls.
3. Run the focused enforcement and plugin tests and confirm the new assertions fail for missing governance context.
4. GREEN: add optional governance context to `FppToolCallContext`, `ProposeInput`, and `PendingReceiptRecord`; pass it through `onBeforeToolCall()` and both signed-receipt builders.
5. GREEN: generalize reconciliation with an explicit, allowlisted reason or dedicated transition method; do not permit arbitrary caller-controlled receipt outcomes.
6. Verify raw tool parameters remain absent, signature round trips remain valid, and existing receipt fixtures require no governance fields.
7. Run focused suites, enforcement-core and plugin typechecks, and linter diagnostics.

**Definition of Done:**
- [x] Gateway mode and epoch survive before/after receipt correlation
- [x] Transition-aborted receipts are distinguishable from shutdown/timeout/overflow gaps
- [x] Signed payloads bind governance context when supplied
- [x] Legacy plugin and harness receipts remain isolated from gateway transition reconciliation
- [x] Enforcement-core and plugin target tests/typechecks pass
- [x] No new linter errors

### Task 3: Add the reference governance event ledger

**Objective:** Provide the gateway reference with a hash-chained, signed-event persistence seam that can prove append-before-state-publication ordering and fail closed on malformed or unwritable state.

**Files:**
- Create: `packages/gateway-reference/src/governance-ledger.ts`
- Create: `packages/gateway-reference/src/governance-ledger.test.ts`
- Modify: `packages/gateway-reference/src/index.ts`

**Steps:**
1. RED: add tests for genesis and chained enable/disable events, monotonic epochs, signature verification through an injected signer/verifier, corrupt-tail rejection, append failure, and reload of the authoritative last state.
2. RED: assert that an event is not reported durable until the complete JSONL record has been written and re-read/verified.
3. Run the gateway-reference tests and confirm failure because no governance ledger exists.
4. GREEN: implement a small append-only JSONL ledger using protocol-core canonicalization and digest domains; inject signing/verification so the reference package does not own private-key custody.
5. GREEN: use lock + temporary-file/atomic-replace behavior consistent with repository ledgers, preserve restrictive file permissions where supported, and fail closed on existing lock or invalid chain.
6. Export only the interfaces needed by the reference router; keep the package marked private and non-production.
7. Run package tests, typecheck, and linter diagnostics.

**Definition of Done:**
- [x] Governance events are hash chained and signature verified
- [x] Corrupt, locked, or unwritable ledgers fail closed through router startup and transitions
- [x] Last mode and epoch reload deterministically
- [x] Event append has an unambiguous all-or-nothing commit result
- [x] Gateway-reference tests and typecheck pass
- [x] No new linter errors

### Task 4: Implement bounded quiesce and audited enable/disable

**Objective:** Turn the reference router into a deterministic state machine whose disable/enable operations enforce admission, drain deadlines, reconciliation, and durable-event ordering.

**Files:**
- Modify: `packages/gateway-reference/src/index.ts`
- Test: `packages/gateway-reference/src/index.test.ts`

**Steps:**
1. RED: add router tests for initial enabled state, `enabled → draining → disabled`, rejection of new governed calls during drain, bounded completion of existing calls, explicit transition-abort reconciliation after timeout, and `disabled → enabled`.
2. RED: add failure tests proving ledger append or receipt reconciliation failure leaves the router in the prior safe mode and never opens ungated routing.
3. RED: prove disabled calls execute ungated only after the verified disable event and do not call enforcement-core or emit synthetic allow receipts.
4. Run the focused test and confirm the state-machine cases fail against the static router.
5. GREEN: add `getGovernanceState()`, `disableGovernance()`, and `enableGovernance()` to the router API; track active admitted calls by epoch and use an injected clock/scheduler for deterministic deadline tests.
6. GREEN: implement bounded drain, transition-specific reconciliation, event append, and state publication in the locked order from Architecture Notes.
7. Preserve `GatewayReferenceDisabledError` for the package-level feature flag; add distinct errors for governance draining and stale transitions.
8. Run package tests, typecheck, and linter diagnostics.

**Definition of Done:**
- [x] New governed calls stop at drain start
- [x] Drain always ends by its configured deadline
- [x] Only pre-invoke leftovers from the draining epoch receive transition-aborted receipts
- [x] Ungated execution cannot start before durable receipt reconciliation and disable-event commit
- [x] Enable failure leaves governance disabled
- [x] Package feature flag and runtime governance mode are unambiguous
- [x] Gateway-reference tests and typecheck pass
- [x] No new linter errors

### Task 5: Prove concurrent and rapid-toggle safety

**Objective:** Exercise the check/use boundary under controlled concurrency so no call invokes with a stale governance epoch or produces a misleading finalized receipt.

**Files:**
- Modify: `packages/gateway-reference/src/index.test.ts`
- Test: `test/conformance-receipt-e2e.test.ts`

**Steps:**
1. RED: add deferred-promise tests that pause after disposition but before invoke, request disable, release the call before and after the drain deadline, and assert only the permitted ordering invokes.
2. RED: add an epoch-mismatch test where state changes immediately before invoke; assert downstream invocation is rejected and the receipt is transition-aborted.
3. RED: stress repeated off/on/off transitions with concurrent routes and assert event epochs are strictly increasing, state/event tails agree, and each admitted call has exactly one terminal receipt.
4. Run focused gateway and receipt E2E tests and confirm the stale-epoch expectations fail before the router barrier is implemented.
5. GREEN: place the epoch comparison at the final pre-invoke boundary and make transition operations serial/idempotent under a single transition lock.
6. Ensure duplicate disable/enable requests do not duplicate events or finalize a receipt twice.
7. Run focused tests, package suites, E2E tests, typechecks, and linter diagnostics.

**Definition of Done:**
- [x] A stale epoch can never reach downstream invoke
- [x] Calls already invoking retain executed/error receipts even when they finish after the deadline
- [x] Pre-invoke calls missing the deadline terminate visibly and exactly once
- [x] Rapid toggles preserve a linear event/state history
- [x] Concurrent transition tests and receipt E2E tests pass
- [x] No new type or linter errors

### Task 6: Amend RFC architecture and reference documentation

**Objective:** Make bounded quiesce and epoch semantics normative in the RFC and accurately describe the non-production reference behavior.

**Files:**
- Modify: `docs/rfc/0001-voluntary-constitutional-layer.md`
- Modify: `docs/rfc/0001-voluntary-constitutional-layer.test.ts`
- Modify: `docs/rfc/diagrams/gateway-disposition.mmd`
- Modify: `docs/rfc/examples/governance-disabled-event.json`
- Modify: `docs/rfc/REVIEW_CHECKLIST.md`
- Modify: `packages/gateway-reference/README.md`

**Steps:**
1. RED: extend the RFC structure test to require an in-flight transition section, bounded drain/abort semantics, governance epoch, append-before-ungated ordering, and prohibition of unbounded approval holds.
2. Run the RFC structure test and confirm it fails against the current RFC.
3. GREEN: add normative state definitions and MUST-level transition ordering; distinguish work already executing from admitted-but-not-invoked work.
4. Update the sequence diagram and example event to include epoch/previous mode and remove wording that permits ungated execution without the new transition preconditions.
5. Update the checklist and reference README with focused commands and explicit CI-only/non-production status.
6. Run RFC structure tests, gateway-reference tests, and documentation link/anchor checks available in the repository.

**Definition of Done:**
- [x] RFC distinguishes not-yet-invoked cancellation from already-executing work
- [x] RFC requires bounded disable attempts and explicit transition-abort evidence
- [x] Diagram and example match remediated implementation ordering
- [x] Reference README does not imply upstream or production gateway support
- [x] RFC structure tests pass
- [x] No broken documentation links introduced

### Task 7: Reconcile canonical capability claims

**Objective:** Record the implemented reference proof while preserving the canonical distinction between a CI demonstration and shipped gateway enforcement.

**Files:**
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `docs/ROADMAP.md`

**Steps:**
1. Add precise evidence links for the reference state-machine and concurrency tests to the gateway RFC row.
2. Keep the row `PROPOSED` / upstream `DEFERRED`; explicitly state that bounded transition semantics are repository-proven only in the optional reference package.
3. Update the roadmap prerequisite language to mention upstream agreement on transition and epoch semantics without claiming the prerequisite is satisfied upstream.
4. Cross-check all present-tense claims against source files and fresh focused test output.
5. Run the relevant RFC/document-safe checks and inspect the resulting diff for status inflation.

**Definition of Done:**
- [x] Canonical status remains honest
- [x] Reference implementation evidence is linked only after adversarial schedules pass
- [x] Upstream prerequisites remain deferred
- [x] No shipped gateway claim is introduced
- [x] Documentation checks pass
- [x] No new linter errors

### Task 8: Separate pre-invoke cancellation from executing calls

**Objective:** Track call phase explicitly and abort only not-yet-invoked calls from the draining epoch so receipts cannot contradict completed side effects.

**Files:**
- Modify: `packages/gateway-reference/src/index.ts`
- Modify: `packages/gateway-reference/src/index.test.ts`
- Modify: `packages/enforcement-core/src/receipt-store.ts`
- Modify: `packages/enforcement-core/src/receipt-store.test.ts`
- Modify: `packages/enforcement-core/src/runtime-adapter.ts`
- Test: `test/conformance-receipt-e2e.test.ts`

**Steps:**
1. RED: reproduce the reviewed schedule: pause an `invoke()` after it starts, advance the disable deadline, complete the side effect, and assert the terminal receipt is `executed`/`error`, never `governance_transition_aborted`.
2. RED: pause calls in policy evaluation and immediately before invoke; at the deadline assert those call IDs alone are transition-aborted and can never resume even if a later disable step fails and mode returns to `enabled(N)`.
3. RED: share one runtime with unrelated plugin/harness pending receipts and gateway calls from different epochs; assert filtered reconciliation leaves unrelated records untouched.
4. Run focused gateway/receipt tests and confirm failure because active state has no phase and transition reconciliation aborts the entire pending store.
5. GREEN: replace `ActiveCall` with a monotonic phase record and per-call cancellation token; set `invoking` immediately before entering the downstream call.
6. GREEN: change transition reconciliation to require the draining epoch plus an explicit set of eligible call IDs; reject attempts to abort `invoking` or unrelated records.
7. GREEN: if invoking calls remain at the deadline, fail the disable attempt without appending `governance-disabled`; preserve their old-epoch completion path and keep newly aborted call IDs terminal.
8. Run focused tests, package suites, E2E tests, typechecks, and linter diagnostics.

**Definition of Done:**
- [x] Executing side effects are never receipted as transition-aborted
- [x] Only pre-invoke calls from the draining epoch are abortable
- [x] Aborted calls cannot resume after any disable failure
- [x] Unrelated runtime receipts are not reconciled
- [x] Disable attempts terminate by the deadline without falsely publishing disabled
- [x] Target tests/typechecks pass with no new linter errors

### Task 9: Make governance ledger commit and startup fail closed

**Objective:** Give governance append an all-or-nothing commit contract and refuse routing when the durable ledger cannot be verified as a valid state-machine history.

**Files:**
- Modify: `packages/gateway-reference/src/governance-ledger.ts`
- Modify: `packages/gateway-reference/src/governance-ledger.test.ts`
- Modify: `packages/gateway-reference/src/index.ts`
- Modify: `packages/gateway-reference/src/index.test.ts`

**Steps:**
1. RED: reject epoch gaps, repeated same-mode transitions, incorrect `previousMode`, non-`N+1` epochs, and impossible first events when loading a signed chain.
2. RED: inject verifier/read/write/fsync failures at each append stage and assert either the original ledger remains authoritative or the append returns committed success—never failure after mutating the durable tail.
3. RED: construct a router over malformed, unreadable, or signature-invalid ledger state and assert construction/routing fails closed instead of defaulting to `enabled(0)`.
4. Run focused gateway-reference tests and confirm the current post-append verification and ignored startup error violate these cases.
5. GREEN: validate the complete candidate chain before commit, write the whole candidate to a temporary file, fsync it, atomically replace the ledger, and fsync the parent directory where supported.
6. GREEN: arrange the commit point so no fallible verification step after replacement can report “not committed”; return the committed event/state from the already validated candidate.
7. GREEN: make router initialization propagate `GovernanceLedgerUnavailableError` and validate exact transition adjacency while loading.
8. Run package tests, typecheck, and linter diagnostics.

**Definition of Done:**
- [x] Append failure leaves the previous durable tail unchanged
- [x] Successful append returns the exact committed event/state
- [x] Router startup refuses unverifiable governance state
- [x] Signed but semantically impossible histories are rejected
- [x] File and parent-directory durability are attempted with documented platform limits
- [x] Gateway-reference tests/typecheck pass with no new linter errors

### Task 10: Enforce durable filtered reconciliation and receipt binding

**Objective:** Propagate transition-receipt persistence failures to the router, require governance mode/epoch as a pair, and remove unsupported proof language until adversarial verification passes.

**Files:**
- Modify: `packages/enforcement-core/src/runtime-adapter.ts`
- Modify: `packages/enforcement-core/src/receipt-store.ts`
- Modify: `packages/enforcement-core/src/receipt-store.test.ts`
- Modify: `packages/protocol-core/src/receipts.ts`
- Modify: `packages/protocol-core/src/receipts.test.ts`
- Modify: `packages/gateway-reference/src/index.test.ts`
- Modify: `docs/rfc/0001-voluntary-constitutional-layer.md`
- Modify: `docs/rfc/diagrams/gateway-disposition.mmd`
- Modify: `packages/gateway-reference/README.md`
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `docs/ROADMAP.md`

**Steps:**
1. RED: inject receipt-log corruption/write failure during transition reconciliation and assert disable does not append its event or expose ungated routing.
2. RED: prove receipts with only `governanceEpoch` or only `governanceMode` fail parsing, while receipts with neither remain backward compatible.
3. RED: assert reconciliation reports per-record persistence success/failure and never returns success solely because in-memory records were mutated.
4. Run focused protocol/enforcement/gateway tests and confirm failure against swallowed persistence errors and independent optional fields.
5. GREEN: add a transition-specific persistence path that propagates write failures; retain generic plugin audit-gap behavior outside the gateway transition contract.
6. GREEN: validate governance fields as an optional pair and ensure filtered reconciliation is idempotent for retries without allowing an aborted call to execute.
7. Update RFC, diagram, reference README, capability status, and roadmap to reflect deadline failure for executing calls and remove “reference proof” wording until all remediation tests pass.
8. Run focused tests, full affected package suites, script tests, typecheck, build, and linter diagnostics.

**Definition of Done:**
- [x] Receipt persistence failure prevents durable disable publication
- [x] In-memory mutation cannot be mistaken for durable reconciliation
- [x] Governance mode/epoch are both present or both absent
- [x] Retry behavior preserves exactly one terminal receipt per call
- [x] RFC and capability wording match remediated behavior
- [x] Target tests, build, typecheck, and linter diagnostics pass

### Task 11: Close active-call lifecycle and drain races

**Objective:** Make active-call identity unique for the lifetime of a routed call, ensure every approval-held call receives one terminal receipt before control returns, and let draining complete as soon as the last active call exits.

**Files:**
- Modify: `packages/gateway-reference/src/index.ts`
- Modify: `packages/gateway-reference/src/index.test.ts`
- Modify: `packages/enforcement-core/src/runtime-adapter.ts`
- Modify: `packages/enforcement-core/src/runtime-adapter.test.ts`
- Modify: `packages/enforcement-core/src/receipt-store.test.ts`

**Steps:**
1. RED: start a blocked call and route a second call with the same `toolCallId`; assert the second call fails immediately with a dedicated duplicate-active-call error, does not replace the first map entry, and does not invoke.
2. RED: route a `require_approval` disposition and assert the pending receipt reaches one explicit terminal state before the caller receives the approval-required result; prove disable/reconciliation cannot create a second terminal receipt.
3. RED: begin disable with a long timeout, release the final active call, and assert disable advances immediately through an injected activity signal rather than waiting for the timeout.
4. RED: cover cleanup paths for policy evaluation, pre-invoke, approval, invoke, receipt-persistence, and duplicate-ID failures; assert active ownership is released exactly once only by the owning route.
5. Run focused gateway/enforcement tests and confirm the current map overwrite, unresolved approval receipt, and timeout-only wait fail these cases.
6. GREEN: reserve `toolCallId` atomically before policy evaluation, reject live duplicates, and use an ownership token or identity check so one route cannot delete another route’s active entry.
7. GREEN: terminalize approval-held receipts through the normal resolution path, using the protocol’s existing non-executed terminal semantics or a narrowly added explicit status if required by observable behavior.
8. GREEN: add a deterministic activity-change notification and wait on `activeCount === 0` or deadline without polling/sleep-based tests.
9. Run affected tests, package typechecks, and linter diagnostics.

**Definition of Done:**
- [x] A duplicate live `toolCallId` cannot invoke or overwrite active ownership
- [x] Every `require_approval` route has exactly one durable terminal receipt
- [x] Draining wakes immediately when the final active call exits
- [x] All route exits release only their own active-call reservation
- [x] Focused gateway/enforcement tests and typechecks pass with no new linter errors

### Task 12: Bind durable logs and schemas to verified context

**Objective:** Refuse append or startup when prior durable state is malformed, context-replayed, or schema-inconsistent, so hash chaining and governance metadata are verified properties rather than trusted tail assertions.

**Files:**
- Modify: `packages/enforcement-core/src/receipt-log.ts`
- Modify: `packages/enforcement-core/src/receipt-log.test.ts`
- Modify: `packages/gateway-reference/src/governance-ledger.ts`
- Modify: `packages/gateway-reference/src/governance-ledger.test.ts`
- Modify: `packages/gateway-reference/src/index.ts`
- Modify: `packages/gateway-reference/src/index.test.ts`
- Modify: `packages/protocol-core/src/receipts.ts`
- Modify: `packages/protocol-core/src/receipts.test.ts`

**Steps:**
1. RED: corrupt a non-tail receipt-log entry while preserving the final entry’s stored hash, then append; assert append fails and leaves the file byte-for-byte unchanged.
2. RED: replay a valid signed governance ledger under a router configured with a different constitution hash or policy ID; assert load/startup fails closed before routing.
3. RED: create an existing zero-byte governance ledger and assert it is treated as corrupt/ambiguous rather than a fresh genesis ledger.
4. RED: call the runtime TypeBox validator directly with only `governanceEpoch` and only `governanceMode`; assert both fail while neither or both remain valid.
5. Run focused protocol/enforcement/gateway tests and confirm the current tail trust, unbound load, empty-file fallback, and optional-field schema fail these cases.
6. GREEN: validate the complete existing receipt chain—including canonical entry hash, `previousHash`, signature, and terminal tail—before constructing and durably committing an append.
7. GREEN: require expected constitution hash and policy ID when loading the governance ledger and reject every signed event whose bound context differs; distinguish a missing path from an existing empty file.
8. GREEN: encode the governance metadata invariant in the exported runtime schema itself, using a paired-object/forbidden-key union or equivalent construct supported by TypeBox `Value.Check`, while preserving the static type contract.
9. Run focused suites, affected package suites, typecheck, build, and linter diagnostics.

**Definition of Done:**
- [x] Receipt append refuses any invalid prior chain and performs no partial write
- [x] Governance-ledger replay under a different constitution or policy is rejected
- [x] Missing and existing-empty governance ledgers have distinct fail-closed semantics
- [x] Runtime schema validation accepts governance mode/epoch only as a pair
- [x] Focused and affected tests, build, and typechecks pass with no new linter errors

### Task 13: Terminalize delayed receipt creation after transition abort

**Objective:** Ensure a governed call that has been cancelled at the drain deadline cannot create an unterminalized pending receipt after transition reconciliation has completed.

**Files:**
- Modify: `packages/gateway-reference/src/index.ts`
- Modify: `packages/gateway-reference/src/index.test.ts`

**Steps:**
1. RED: delay `onBeforeToolCall()` until after a drain deadline, then assert the route rejects and the receipt store has no pending receipt.
2. GREEN: when an active call is already cancelled after delayed policy evaluation, terminalize its newly created receipt through the runtime before surfacing the stale-epoch result.
3. Run focused gateway tests, package typecheck, and linter diagnostics.

**Definition of Done:**
- [x] A delayed policy evaluation cannot strand a pending receipt after transition abort
- [x] The cancelled route does not invoke the downstream tool
- [x] Focused gateway tests and typecheck pass with no new linter errors

## Testing Strategy

### RED evidence

Run the smallest test for each task before production code:

```bash
npm test -w @ovrsr/fpp-protocol-core
npm test -w @ovrsr/fpp-enforcement-core
npm test -w @ovrsr/fpp-gateway-reference
npx tsx --test test/conformance-receipt-e2e.test.ts
npx tsx --test docs/rfc/0001-voluntary-constitutional-layer.test.ts
```

Each newly added behavior test must fail for the intended missing transition/epoch feature, not because of syntax, fixtures, or environment setup.

### GREEN and regression evidence

```bash
npm test -w @ovrsr/fpp-protocol-core
npm test -w @ovrsr/fpp-enforcement-core
npm test -w @ovrsr/fpp-gateway-reference
npm test -w @ovrsr/openclaw-fpp-plugin
npx tsx --test test/conformance-receipt-e2e.test.ts
npm run test:scripts
npm run typecheck
npm run build:core
```

Final implementation verification must include deterministic concurrent tests; elapsed wall-clock sleeps are not acceptable as the primary proof.

## Risks & Mitigations

- **Law 2 disablement becomes unbounded:** Abort approval-held/not-yet-invoked calls at the deadline; if an already-invoking call remains, fail the disable attempt rather than publish a false off state.
- **Check/use race remains:** Compare the captured epoch immediately before downstream invoke, not only before classification.
- **Misleading receipts:** Track the invoke boundary explicitly; only pre-invoke deadline misses may become `governance_transition_aborted`.
- **Ungated window after append failure:** Publish `disabled` only after the event append and verification succeed; otherwise remain draining/enabled and fail closed.
- **Transition deadlock:** Serialize transitions, inject deterministic time, and make duplicate requests idempotent.
- **Status inflation:** Keep gateway enforcement `PROPOSED` / upstream `DEFERRED`; do not call the package a reference proof until adversarial remediation tests pass.
- **Breaking existing adapters:** Governance context is optional and originates only from gateway-aware callers.
- **Active-call aliasing:** Reserve each live `toolCallId` before asynchronous work and require ownership-token equality on cleanup.
- **Approval receipt leak:** Resolve non-executed approval dispositions before throwing/returning control; make terminalization idempotent.
- **Context-valid but deployment-wrong ledger replay:** Verify constitution hash and policy ID against trusted router configuration on every load, not only against each event’s signature.
- **Schema/runtime divergence:** Assert the exported TypeBox schema directly in tests in addition to parser-level checks.

## Handoff

Review the state machine, receipt compatibility, and reference-only scope. After approval, run:

`/implement docs/plans/2026-07-20-1-gateway-governance-transition-safety.md`
