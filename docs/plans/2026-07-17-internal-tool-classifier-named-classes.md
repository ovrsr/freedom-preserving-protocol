# Internal Tool Classifier Named Classes

**Status:** PENDING
**Created:** 2026-07-17
**Depends on:** Plan 2026-07-16 axiom-ops / openclaw-tool-name-normalize / meta-eval (`fpp.governance`, `knownCustomTools` seed, `code.patch`)
**Scope:**
- **In:** Named low-risk classes for routine OpenClaw internal tools that currently fall through to `unknown.unclassified`; always-allow heartbeat responder; promote `memory_search` off the opaque allowlist into a named read class; param-aware `openclawgateway` inspect vs mutate split; curated `internal.read` allow-with-audit set for recurring introspection/coordination tools; reduce `exec.benign` staged-ledger noise; docs + regressions.
- **Out (confirmed):** Bucket A UX / standing-mandate workflows for `message.external`, `code.patch`, `gateway.config-change`, `exec.system-modify`; changing hard-floor defaults for restart / protected delete / cred-exfil; ClawHub publish; live deployment config edits; empty-array `knownCustomTools: []` merge-semantics change.

## Summary

Axiom’s 2026-07-17 audit shows the maintainer problem is **underclassification**, not over-blocking of dangerous actions. Bucket A (external / state-changing) gating is constitutionally justified and stays. Bucket B — especially `openclawheartbeat_respond` (118×), memory/trust introspection, gateway inspection, and a long tail of internal tools — lands in `unknown.unclassified` and abstains under unattended disposition. That is disproportionate (Law 3), self-conflicting for heartbeat obligations (Law 4), and too coarse to contest (Law 6).

Prior work already maps `/^fpp_/` → `fpp.governance` allow and seeds `memory_search` via `knownCustomTools`, but seeded allows still emit `unknown.unclassified`, and heartbeat/gateway/peripheral tools have no named class. This plan adds three contestable classes, routes the high-volume surfaces into them, and stops staging every benign shell inspection.

## Locked design choices (2026-07-17)

| ID | Choice |
|----|--------|
| Q1-A | New named classes: `internal.heartbeat`, `internal.read`, `gateway.inspect` |
| Q2-A | Always allow `heartbeat_respond` / OpenClaw-prefixed forms (no HEARTBEAT_OK param gate) |
| Q3-A | Split `openclawgateway` by action/params: inspect/status → `gateway.inspect` allow; restart/config/mutate → existing `gateway.restart` / `gateway.config-change` |
| Q4-A | Promote `memory_search` to `internal.read`; default `knownCustomTools` no longer seeds it (operator extras only) |
| Q5-IN | Reduce staged-action registration for `exec.benign` (read-only / no-high-risk shell) |
| Q6-A | Curated allow-with-audit under `internal.read` for recurring internals (see inventory) |
| Q7-OUT | Bucket A mandate/standing UX out of scope |

## Architecture Notes

```text
onBeforeToolCall
  → normalizeOpenClawToolName(toolName, knownCustomTools)
  → classifyToolCall (order matters):
       filesystem | exec | http | message | code.patch
       | classifyInternalHeartbeat   → internal.heartbeat / allow
       | classifyInternalRead        → internal.read / allow
       | classifyGatewayTool         → gateway.inspect allow
                                       | gateway.restart block
                                       | gateway.config-change approval
       | /^fpp_/                     → fpp.governance / allow
       | knownCustomTools            → unknown.unclassified / allow (operator extras only)
       | fallthrough                 → unknown.unclassified / approval
  → resolveDisposition
       reversible ∩ budget → allow_staged   (exec.benign NO LONGER reversible)
       classifier decision=allow → allow
       …
```

**New classification ids (all default-allow, reversible, not on `approvalOn`/`blockOn`):**

| Id | Decision | Surfaces (normalized + OpenClaw-prefixed) |
|----|----------|-------------------------------------------|
| `internal.heartbeat` | allow | `heartbeat_respond` |
| `internal.read` | allow | `memory_search`, `get_goal`, `update_plan`, `read_mcp_resource`, `sessions_list`, `wiki_apply`, `subagents` (+ documented aliases) |
| `gateway.inspect` | allow | `gateway` / `openclawgateway` when action is inspect/status/get/list (param-driven) |

**Keep existing:**
- `fpp.governance` for `fpp_*` / `openclawfpp_*` (trust status, mandate propose/second, etc.)
- `code.patch` for `apply_patch` (never default-allowlisted)
- Bucket A hard/approval classes unchanged

**`knownCustomTools`:** Default becomes `[]`. Operator-listed names still allow with audit but remain `unknown.unclassified` (intentional escape hatch — not a substitute for named classes).

**`exec.benign` staging:** Remove `exec.benign` from the reversibility set so disposition hits classifier-allow → direct `allow` (no `fpp-staged-actions.jsonl` row). Undo window no longer applies to benign exec; high-risk exec classes unchanged.

**Gateway tool params:** Derive action tokens from live audit / OpenClaw tool schema (`action`, `command`, `method`, argv-like fields). Unknown/ambiguous mutate-shaped calls must not fail-open to `gateway.inspect` — prefer existing `gateway.*` or `unknown.unclassified`.

**Risk note on `wiki_apply` / `subagents`:** Included in the curated allow set per Q6-A because Axiom flagged them as opaque unknowns. If implementation discovers clearly externalizing / high-impact param shapes, keep the named id but route those shapes to approval (do not silently broaden fail-open). Document any carve-outs in TROUBLESHOOTING.

## Feature Inventory

Not a wholesale migration. Mapping of underclassified live surfaces → tasks:

| Live / normalized tool | Today | After | Task |
|---|---|---|---|
| `openclawheartbeat_respond` / `heartbeat_respond` | `unknown.unclassified` → abstain | `internal.heartbeat` → allow | 1–2 |
| `openclawmemory_search` / `memory_search` | seed allow + still `unknown.unclassified` | `internal.read` → allow; demote seed | 1, 3–4 |
| `get_goal`, `update_plan`, `read_mcp_resource`, `sessions_list`, `wiki_apply`, `subagents` (+ OpenClaw forms) | `unknown.unclassified` | `internal.read` → allow (carve-outs if needed) | 3 |
| `openclawfpp_trust_status` / mandate tools | usually `fpp.governance`; occasional unknown | strengthen normalize + regressions | 5 |
| `openclawgateway` | `unknown.unclassified` | param split inspect/mutate | 6 |
| `apply_patch` | `code.patch` | unchanged (regression only) | 5 |
| `exec.benign` volume | `allow_staged` ledger noise | direct `allow` (not reversible) | 7 |
| Docs / plugin schema / e2e | partial | aligned | 8–9 |

## Progress Tracking

- [ ] Task 1: Add `internal.heartbeat`, `internal.read`, `gateway.inspect` to taxonomy + defaults
- [ ] Task 2: Heartbeat classifier (always allow)
- [ ] Task 3: `internal.read` curated tool matcher
- [ ] Task 4: Demote `memory_search` from default `knownCustomTools`
- [ ] Task 5: Normalize / `fpp.governance` / `apply_patch` regressions
- [ ] Task 6: Param-aware `openclawgateway` inspect vs mutate
- [ ] Task 7: Stop staging `exec.benign`
- [ ] Task 8: Plugin e2e + self-test / corpus fixtures
- [ ] Task 9: Docs (CAPABILITY / TROUBLESHOOTING / COMPATIBILITY / plugin README + schema copy)

**Total Tasks:** 9 | **Completed:** 0 | **Remaining:** 9

## Implementation Tasks

### Task 1: Add `internal.heartbeat`, `internal.read`, `gateway.inspect` to taxonomy + defaults

**Objective:** Extend `ClassificationId` / `CLASSIFICATION_IDS` and wire reversibility + config surfaces so the new ids are first-class (default allow, not gated).

**Files:**
- Modify: `packages/enforcement-core/src/risk-classifier.ts`
- Modify: `packages/enforcement-core/src/reversibility.ts`
- Modify: `packages/enforcement-core/src/config.ts` (only if id lists / docs comments need update — do not add to `approvalOn`/`blockOn`)
- Modify: `packages/enforcement-core/src/reversibility.test.ts`
- Modify: `plugin/openclaw.plugin.json` (description enums / knownCustomTools copy if ClassificationId lists appear)
- Test: `packages/enforcement-core/src/reversibility.test.ts`, `packages/enforcement-core/src/risk-classifier.test.ts` (id membership)

**Steps:**
1. RED: assert new ids are in `CLASSIFICATION_IDS` and `isReversibleClassification` is true for all three.
2. GREEN: add union members + array entries; add to `REVERSIBLE` set.
3. Confirm runtime-manifest hash input picks them up via `CLASSIFICATION_IDS` (no special case).
4. Typecheck / lint touched files.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] New ids absent from default `blockOn` / `approvalOn`

### Task 2: Heartbeat classifier (always allow)

**Objective:** `heartbeat_respond` and OpenClaw-prefixed forms classify as `internal.heartbeat` / allow so heartbeat obligations are not self-blocked.

**Files:**
- Modify: `packages/enforcement-core/src/risk-classifier.ts`
- Test: `packages/enforcement-core/src/risk-classifier.test.ts`
- Test: `plugin/src/security-regressions.test.ts` (unattended allow e2e)

**Steps:**
1. RED: `openclawheartbeat_respond` and `heartbeat_respond` → `internal.heartbeat` / allow; unrelated tools unchanged.
2. GREEN: dedicated matcher (after code.patch, before fpp fallthrough); rely on existing normalize for dotted/`openclaw`+seeded forms — also match mangled `openclawheartbeat_respond` by normalizing remainder when it equals `heartbeat_respond` **or** by matching `/heartbeat_respond$/i` on the live name so seed is not required.
3. Run unit + one unattended e2e allow.
4. Typecheck / lint.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Heartbeat never lands in `unknown.unclassified` for documented name forms

### Task 3: `internal.read` curated tool matcher

**Objective:** Map the curated introspection/coordination set to `internal.read` / allow-with-audit (Q6-A), including OpenClaw-prefixed live names.

**Files:**
- Modify: `packages/enforcement-core/src/risk-classifier.ts`
- Test: `packages/enforcement-core/src/risk-classifier.test.ts`

**Curated allow names (normalized):**
`memory_search`, `get_goal`, `update_plan`, `read_mcp_resource`, `sessions_list`, `wiki_apply`, `subagents`

**Steps:**
1. RED: each curated name (+ representative `openclaw*` / `openclaw.` forms) → `internal.read` / allow; random unknown still `unknown.unclassified` / approval.
2. GREEN: table/matcher after heartbeat; expand normalize so `openclaw`+remainder strips when remainder is in the curated set (same pattern as today’s seeded strip, but driven by the curated list — not `knownCustomTools`).
3. If `wiki_apply` / `subagents` param shapes look externalizing during fixture design, keep named id but escalate those shapes to approval and document the carve-out.
4. Typecheck / lint.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Curated set documented in code comment + later docs task

### Task 4: Demote `memory_search` from default `knownCustomTools`

**Objective:** Default seed becomes empty; `memory_search` is classified by Task 3, not by opaque allowlist (Q4-A).

**Files:**
- Modify: `packages/enforcement-core/src/config.ts`
- Modify: `packages/enforcement-core/src/config.test.ts`
- Modify: `plugin/openclaw.plugin.json` (`knownCustomTools.default`)
- Modify: `plugin/src/config.test.ts`
- Modify: `plugin/src/security-regressions.test.ts` (memory_search still allows via `internal.read`, not seed)
- Test: above

**Steps:**
1. RED: `DEFAULT_CONFIG.knownCustomTools` is `[]`; `memory_search` still allows with classification `internal.read`.
2. GREEN: update defaults + tests that asserted the old seed.
3. Keep operator `knownCustomTools` path for custom extras (`unknown.unclassified` + allow).
4. Typecheck / lint.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Plugin schema default matches runtime default

### Task 5: Normalize / `fpp.governance` / `apply_patch` regressions

**Objective:** Lock the already-shipped paths that Axiom still saw as occasional unknowns, and ensure `apply_patch` never regresses to `unknown.unclassified`.

**Files:**
- Modify: `packages/enforcement-core/src/risk-classifier.ts` (only if a real name-form gap appears)
- Test: `packages/enforcement-core/src/risk-classifier.test.ts`
- Test: `plugin/src/security-regressions.test.ts` as needed

**Steps:**
1. RED/GREEN only if needed: cover `openclawfpp_mandate_propose`, `openclawfpp_mandate_second`, `openclawfpp_trust_status` → `fpp.governance` / allow; bare + prefixed `apply_patch` → `code.patch` / approval.
2. Add regression tests even when no code change is required (prevent drift).
3. Typecheck / lint.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable) — deferred to Task 9 if only docs

### Task 6: Param-aware `openclawgateway` inspect vs mutate

**Objective:** Split the gateway tool into inspect-allow vs mutate-gated paths so diagnostics do not share `unknown.unclassified` with restart/config (Q3-A).

**Files:**
- Modify: `packages/enforcement-core/src/risk-classifier.ts`
- Test: `packages/enforcement-core/src/risk-classifier.test.ts`

**Steps:**
1. Inspect OpenClaw gateway tool param shapes from SDK types and/or prior audit examples (`action` / `command` / similar). Record the chosen field names in a code comment.
2. RED: inspect/status/get/list-shaped calls → `gateway.inspect` / allow; restart/stop/kill → `gateway.restart` / block; config/plugins install-shaped → `gateway.config-change` / approval; ambiguous → not inspect-allow.
3. GREEN: `classifyGatewayTool` after internal read; must not weaken shell-based `GATEWAY_*` patterns already in `classifyExec`.
4. Typecheck / lint.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Ambiguous mutate-shaped calls do not fail-open

### Task 7: Stop staging `exec.benign`

**Objective:** Cut staged-ledger noise for high-volume benign shell inspection without changing hard-floor or approval-gated exec classes (Q5-IN).

**Files:**
- Modify: `packages/enforcement-core/src/reversibility.ts`
- Modify: `packages/enforcement-core/src/reversibility.test.ts`
- Test: `packages/enforcement-core/src/disposition-engine.test.ts` (exec.benign → `allow`, not `allow_staged`)
- Test: `packages/enforcement-core/src/runtime-adapter.test.ts` if staging registration is asserted

**Steps:**
1. RED: `resolveDisposition` with `exec.benign` / decision allow / budget available → `allow` (not `allow_staged`); reversible workspace write still stages.
2. GREEN: remove `exec.benign` from `REVERSIBLE`; disposition then hits classifier-allow branch.
3. Confirm no staged ledger write for benign exec in adapter tests if covered.
4. Typecheck / lint.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Approval/block exec classes unchanged

### Task 8: Plugin e2e + self-test / corpus fixtures

**Objective:** Cover the new paths at the plugin boundary and keep dispatcher self-test / classifier corpus honest.

**Files:**
- Modify: `plugin/src/security-regressions.test.ts`
- Modify: `scripts/self-test.ts` and/or `scripts/run-classifier-corpus.ts` fixtures (if present for these tools)
- Test: above

**Steps:**
1. RED/GREEN: unattended e2e allows for heartbeat, memory_search, gateway inspect; still abstain/approval for random unknown; apply_patch still approval-gated.
2. Add corpus rows for at least one positive and one negative per new class.
3. Run plugin + enforcement-core tests for touched packages.
4. Typecheck / lint.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Corpus/self-test updated when fixtures exist

### Task 9: Docs (CAPABILITY / TROUBLESHOOTING / COMPATIBILITY / plugin README + schema copy)

**Objective:** Document the new classes, demoted seed, heartbeat fix, gateway split, and exec.benign staging change so operators can contest decisions by name.

**Files:**
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `docs/TROUBLESHOOTING.md` (introspection / unknown.unclassified section)
- Modify: `docs/COMPATIBILITY.md` (knownCustomTools / classifier paragraph)
- Modify: `plugin/README.md`
- Modify: `plugin/openclaw.plugin.json` descriptions as needed

**Steps:**
1. Replace “default seeds `memory_search`” language with named `internal.*` / `gateway.inspect` behavior.
2. Document heartbeat self-conflict fix and how to read the new audit classification ids.
3. Note `exec.benign` no longer writes staged-action rows by default.
4. No production code in this task.

**Definition of Done:**
- [ ] Docs match shipped classifier behavior
- [ ] No contradictory seed/`unknown.unclassified` claims for memory_search
- [ ] TROUBLESHOOTING names the live OpenClaw forms

## Testing Strategy

- **Unit (RED→GREEN per task):** `packages/enforcement-core/src/risk-classifier.test.ts`, `reversibility.test.ts`, `disposition-engine.test.ts`, `config.test.ts`
- **Plugin e2e:** `plugin/src/security-regressions.test.ts` for unattended allow/abstain paths
- **Corpus:** extend classifier corpus / self-test fixtures when present
- **Non-goals for verify:** live gateway e2e against Axiom’s host audit file; ClawHub republish

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `wiki_apply` / `subagents` are more dangerous than Axiom’s single-hit framing | Named class first; escalate mutating/external param shapes to approval; document carve-outs |
| Gateway tool param schema differs from fixtures | Fail closed on ambiguity; keep shell `GATEWAY_*` patterns as source of truth for CLI-shaped mutate |
| Removing `exec.benign` from reversible loses undo window | Acceptable trade for ledger noise; high-risk exec still gated; document in TROUBLESHOOTING |
| Broader `openclaw`+remainder strip for curated names over-matches | Exact remainder membership only (no prefix glob); unrelated `openclawxyz_*` stays unchanged |
| Operators relied on default `knownCustomTools: ["memory_search"]` in docs/scripts | Task 4+9 update defaults and docs together; behavior preserved via `internal.read` |
| Ruleset hash / receipt policy id changes when `CLASSIFICATION_IDS` grows | Expected; receipts bind new taxonomy — no silent compatibility claim |
