# Unattended Disposition and Mandates

**Status:** PENDING
**Created:** 2026-07-10
**Series:** Plan 8 of 12 (autonomy + harness-agnostic program)
**Depends on:** Plans 3–7 (protocol-core, receipts, governance specs, contextual trust)
**Unblocks:** Plans 9–12
**Scope:** In: cleaner disposition engine for unattended agents; mandate schemas folded into `@ovrsr/fpp-protocol-core`; human operator standing allowlists; `dispositionMode` (`operator-present` | `unattended`); staged-allow with undo window; emergency allow-minimal + mandatory review; budget debit; receipt disposition extensions; OpenClaw plugin wiring for the new engine (still in `plugin/` until Plan 10 extracts cores). Out: peer/steward quorum protocol (Plan 9); package extraction / adapter interface (Plan 10); Cursor/Claude/Codex adapters (Plan 11); gateway RFC (Plan 12); amending the seed constitution hash.

## Summary

Replace synchronous `requireApproval` as the default uncertainty handler with a disposition model that supports agents without a present human operator, while keeping `requireApproval` available in `operator-present` mode.

**Canonical disposition flow (unattended):**

```text
classify →
  if hard-floor violation          → block + receipt
  else if covered by live mandate  → allow + receipt (budget debit)
  else if reversible & in budget   → allow-staged + undo window
  else if peer/steward quorum met  → allow + receipt
       (Plan 9: quorum issues a signed mandate; this plan only consumes
        “live mandate present from quorum” as an input)
  else if emergency criteria met   → allow-minimal + mandatory review
  else                             → abstain (not requireApproval)
```

Human operators may also configure a standing allowlist that synthesizes or matches mandate coverage for listed classifications. Peer/steward quorum **generates signed mandates** (Plan 9); this plan defines mandate schema, validation, budgets, and consumption at the tool boundary.

## Architecture Notes

- Fold mandate + disposition schemas into `@ovrsr/fpp-protocol-core` (user choice: fold).
- Policy engine lives initially in `plugin/src/disposition.ts` (moved to `packages/enforcement-core` in Plan 10).
- `decide()` today returns `block | approval | allow`. Extend to a richer `DispositionDecision` while mapping OpenClaw hook results:
  - `block` → `{ block: true }`
  - `allow` / mandate-allow → allow (no approval)
  - `allow-staged` → allow + staged metadata / undo registration
  - `allow-minimal` → allow + emergency review obligation
  - `abstain` → `{ block: true, blockReason: "abstain: ..." }` (no side effect; distinct authorization class on receipt)
  - `require_approval` → only when `dispositionMode === "operator-present"`
- Receipts already allow `abstain`; extend for `allow_staged` / `allow_minimal` (schema bump or additive literals with parse compatibility).
- Hard-floor remains config `blockOn` plus classifier `decision === "block"` for protected classes — never silently downgraded by unattended mode.
- Seed constitution hash `71bf60ad…` is **not** changed by this plan.

## Feature Inventory

| Existing file/function/contract | Replacement | Task |
|---|---|---|
| `plugin/src/index.ts::decide` (`block\|approval\|allow`) | `resolveDisposition` unattended/operator-present engine | Tasks 3–5 |
| `plugin/src/config.ts` `approvalOn` as sole ambiguity path | `dispositionMode` + `standingAllowOn` + mandate path + keep `approvalOn` for operator-present | Tasks 2, 5 |
| `ReceiptDisposition` / `ConformanceReceiptV1.disposition` | Extended dispositions + authorization classes | Task 1 |
| No mandate type | `StandingMandateV1` in protocol-core | Task 1 |
| No budget debit | Mandate budget ledger + debit on allow | Task 4 |
| Classifier `decision: "approval"` as human gate | Reversibility/budget hints feeding staged-allow; not auto-approval | Task 3 |
| `requireApproval` always available | Gated by `dispositionMode: "operator-present"` | Task 5 |
| Receipt `authorization` strings ad hoc | Typed authorization classes including `mandate`, `standing-allowlist`, `emergency`, `abstain`, `approved` | Tasks 1, 6 |

## Progress Tracking

- [ ] Task 1: Fold mandate and disposition schemas into protocol-core
- [ ] Task 2: Add dispositionMode, standingAllowOn, and mandate config surfaces
- [ ] Task 3: Implement resolveDisposition engine (unattended path)
- [ ] Task 4: Mandate store, validation, budget debit, and expiry
- [ ] Task 5: Wire operator-present mode and OpenClaw hook mapping
- [ ] Task 6: Extend receipt lifecycle for new dispositions and authorizations
- [ ] Task 7: Staged-allow undo window and emergency mandatory-review records
- [ ] Task 8: Migration diagnostics, CAPABILITY_STATUS, and operator docs
- [ ] Task 9: End-to-end tests for unattended vs operator-present modes
- [ ] Task 10: Quorum-mandate consumption seam (stub input for Plan 9)

**Total Tasks:** 10 | **Completed:** 0 | **Remaining:** 10

## Implementation Tasks

### Task 1: Fold mandate and disposition schemas into protocol-core

**Objective:** Add versioned schemas for standing mandates, disposition decisions, and extended receipt disposition/authorization literals without breaking existing receipt parse of `allow|deny|require_approval|abstain`.

**Files:**
- Create: `packages/protocol-core/src/mandates.ts`
- Create: `packages/protocol-core/src/disposition.ts`
- Modify: `packages/protocol-core/src/receipts.ts`
- Modify: `packages/protocol-core/src/index.ts`
- Test: `packages/protocol-core/src/mandates.test.ts`
- Test: `packages/protocol-core/src/disposition.test.ts`
- Test: `packages/protocol-core/src/receipts.test.ts`

**Steps:**
1. Write failing tests for `StandingMandateV1` (issuer, scope/capabilities, budgets, validFrom/validTo, revocable, evidenceRef, optional quorumRef) and parse rejection of expired/malformed mandates.
2. Write failing tests for disposition enum including `allow_staged`, `allow_minimal`, `abstain`, `deny`, `allow`, `require_approval`.
3. Implement schemas + parsers (GREEN).
4. Extend receipt disposition union additively; keep v1 parse accepting prior literals.
5. Run `npm test -w @ovrsr/fpp-protocol-core` and typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 2: Add dispositionMode, standingAllowOn, and mandate config surfaces

**Objective:** Config supports unattended defaults without rewriting on-disk operator config; dangerous relaxations still require acknowledgement.

**Files:**
- Modify: `plugin/src/config.ts`
- Modify: `plugin/openclaw.plugin.json`
- Test: `plugin/src/config.test.ts`

**Steps:**
1. RED: default `dispositionMode` is `"unattended"` for new installs; missing field on existing configs migrates with diagnostic (document chosen default carefully — prefer fail-safe: existing installs without field keep operator-present-compatible behavior via explicit migration diagnostic, OR default unattended with documented break — pick fail-safe: absent field → `operator-present` with migration info recommending `unattended`).
2. Add `standingAllowOn: ClassificationId[]`, `mandateStorePath`, budget defaults.
3. GREEN: mergeConfig diagnostics for unsafe standingAllowOn that removes hard-floor classes.
4. Typecheck + tests.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 3: Implement resolveDisposition engine (unattended path)

**Objective:** Pure function implementing the canonical unattended flow; no OpenClaw imports.

**Files:**
- Create: `plugin/src/disposition-engine.ts`
- Create: `plugin/src/reversibility.ts` (classification → reversible? heuristic table)
- Test: `plugin/src/disposition-engine.test.ts`
- Test: `plugin/src/reversibility.test.ts`

**Steps:**
1. RED: table-driven cases for hard-floor block, mandate allow, staged-allow, emergency, abstain; ensure `require_approval` is **not** returned in unattended mode.
2. GREEN: minimal engine taking classification, config, live mandates, budgets, emergency flags, quorumMandatePresent boolean.
3. Typecheck + tests.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 4: Mandate store, validation, budget debit, and expiry

**Objective:** Load/validate signed mandates from disk; debit budgets atomically on allow; reject expired/revoked.

**Files:**
- Create: `plugin/src/mandate-store.ts`
- Test: `plugin/src/mandate-store.test.ts`

**Steps:**
1. RED: accept valid mandate; reject bad signature / expiry / over-budget; debit reduces remaining budget.
2. GREEN: file-backed store at `mandateStorePath`; standingAllowOn entries materialize as unsigned `authorization: standing-allowlist` coverage (not forged as peer-signed).
3. Typecheck + tests.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 5: Wire operator-present mode and OpenClaw hook mapping

**Objective:** `before_tool_call` uses `resolveDisposition`; `requireApproval` only in operator-present mode.

**Files:**
- Modify: `plugin/src/index.ts`
- Test: `plugin/src/index.test.ts`
- Test: `plugin/src/security-regressions.test.ts`

**Steps:**
1. RED: unattended unknown tool → abstain (block with abstain authorization), not requireApproval; operator-present still requireApproval for `approvalOn`.
2. Replace `decide()` call sites with engine; keep `decide` as deprecated wrapper or remove with inventory update.
3. GREEN + security regressions updated.
4. Typecheck + tests.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 6: Extend receipt lifecycle for new dispositions and authorizations

**Objective:** Receipt store records `allow_staged`, `allow_minimal`, `abstain`, and authorization classes `mandate`, `standing-allowlist`, `emergency`, `quorum-mandate`, `abstain`, `approved`, `policy-block`.

**Files:**
- Modify: `plugin/src/receipt-store.ts`
- Modify: `plugin/src/index.ts` (buildSignedReceiptFromRecord)
- Test: `plugin/src/receipt-store.test.ts`
- Test: `test/conformance-receipt-e2e.test.ts`

**Steps:**
1. RED/GREEN for new disposition mapping from engine decisions.
2. Ensure abstain finalizes without pending_authorization hang.
3. Typecheck + tests.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 7: Staged-allow undo window and emergency mandatory-review records

**Objective:** Staged allows register an undo/review obligation; emergencies append mandatory-review records (append-only).

**Files:**
- Create: `plugin/src/staged-actions.ts`
- Create: `plugin/src/emergency-review.ts`
- Test: `plugin/src/staged-actions.test.ts`
- Test: `plugin/src/emergency-review.test.ts`

**Steps:**
1. RED: staged allow writes undo window metadata; expiry without undo still auditable; emergency requires review record.
2. GREEN: minimal file-backed ledgers under workspace paths.
3. Typecheck + tests.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 8: Migration diagnostics, CAPABILITY_STATUS, and operator docs

**Objective:** Operators understand mode switch, standing allowlists vs signed mandates, and that unattended abstains instead of hanging on approval.

**Files:**
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `docs/COMPATIBILITY.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `plugin/README.md`
- Modify: `docs/governance/CONSENT_AND_AUTHORIZATION.md` (implementation pointer; keep PROVISIONAL labels honest)

**Steps:**
1. Document `dispositionMode`, mandate paths, standingAllowOn.
2. Flip/add matrix rows for unattended disposition and mandates (`PARTIAL` until Plan 9 quorum).
3. No constitution hash change.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 9: End-to-end tests for unattended vs operator-present modes

**Objective:** Prove both modes against classifier fixtures and receipt outcomes.

**Files:**
- Create: `test/unattended-disposition-e2e.test.ts`
- Modify: `scripts/self-test.ts` (optional mode flag reporting)

**Steps:**
1. RED/GREEN e2e covering hard-floor, mandate allow, abstain, operator-present approval path.
2. Run `npm run test:e2e` and plugin tests.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 10: Quorum-mandate consumption seam (stub input for Plan 9)

**Objective:** Engine accepts `quorumMandatePresent` / mandate records with `issuerClass: "peer-quorum" | "steward-quorum"` without implementing quorum gathering yet.

**Files:**
- Modify: `plugin/src/disposition-engine.ts`
- Modify: `plugin/src/mandate-store.ts`
- Test: `plugin/src/disposition-engine.test.ts`
- Create: `docs/plans/notes/plan-9-quorum-seam.md` (short seam contract note) — **prefer inline comment + test only; skip extra doc file if avoidable**

**Steps:**
1. RED: when a valid quorum-issued mandate is in the store, unattended path allows + budget debit with authorization `quorum-mandate`.
2. GREEN: no network/quorum protocol in this task.
3. Document seam in Plan 9 dependency section (already linked).

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

## Testing Strategy

- Unit: protocol-core schemas; disposition-engine table tests; mandate-store; reversibility table.
- Integration: plugin hook capture via `createHookCapture` for both modes.
- E2E: `test/unattended-disposition-e2e.test.ts`.
- Security regressions: hard-floor cannot be standing-allowlisted without acknowledgement; unattended never hangs on requireApproval.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Defaulting all installs to unattended breaks existing operator UX | Absent `dispositionMode` → `operator-present` + migration diagnostic |
| Standing allowlist forged as signed mandate | Distinct authorization class; unsigned allowlist never gets peer-signed claim class |
| Staged-allow without real undo | Undo window is obligation + audit; document gap if host cannot roll back |
| Abstain mapped to block confuses operators | Receipt authorization `abstain` + distinct blockReason prefix |
| Plan 9 not ready | Quorum path inert until signed quorum mandates appear in store |
