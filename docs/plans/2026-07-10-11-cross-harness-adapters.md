# Cross-Harness Adapters

**Status:** COMPLETE
**Created:** 2026-07-10
**Series:** Plan 11 of 12 (autonomy + harness-agnostic program)
**Depends on:** Plan 10 (`FppRuntimeAdapter`, enforcement-core, trust-core, workspace profiles)
**Unblocks:** Graded dispatcher-layer operation outside OpenClaw
**Scope:** In: Cursor, Claude Code, and Codex adapter packages/docs implementing `FppRuntimeAdapter` to the maximum each harness allows; prompt-layer install paths; tool-middleware or MCP/sidecar patterns where native `before_tool_call` is absent; distribution and COMPATIBILITY matrix updates; optional removal of “OpenClaw-only” language as the *sole* dispatcher story (OpenClaw remains a first-class adapter). Out: gateway-level non-bypassable enforcement (Plan 12); amending seed constitution; claiming full parity where a harness has no pre-tool hook.

## Summary

Deliver real adapter implementations (not docs-only) for Cursor, Claude Code, and Codex. Where a harness lacks a native pre-tool policy hook, the adapter must still provide a **documented, testable** interception strategy (e.g. MCP tool proxy, CLI sidecar, or harness-specific hook if available) that drives enforcement-core dispositions — including unattended abstain/mandate paths — without pretending mechanical parity that does not exist.

## Architecture Notes

- One package or module per harness under `adapters/`:
  - `adapters/openclaw/` — may remain as re-export of `plugin/` / `plugin-trust/` or thin move
  - `adapters/cursor/`
  - `adapters/claude-code/`
  - `adapters/codex/`
- Each adapter: implements `FppRuntimeAdapter`, maps harness tool events → `classifyToolCall` + `resolveDisposition`, persists receipts under profile workspace.
- `requestApproval`: implement only if harness can surface operator UI; otherwise force `dispositionMode: "unattended"` defaults.
- Honest capability reporting via verify-install probes per harness.

## Feature Inventory

| Gap / existing | Replacement | Task |
|---|---|---|
| Prompt-only fallback docs | Working adapter modules + probes | Tasks 2–5 |
| No Cursor dispatcher path | `adapters/cursor` | Task 2 |
| No Claude Code dispatcher path | `adapters/claude-code` | Task 3 |
| Codex partial skill only | `adapters/codex` | Task 4 |
| verify-install OpenClaw-only | probes for each adapter | Task 6 |
| README “plugins are OpenClaw-specific” absolute claim | Graded matrix | Task 7 |

## Progress Tracking

- [x] Task 1: Adapter package layout and harness capability matrix fixture
- [x] Task 2: Cursor adapter (hook or MCP/sidecar strategy)
- [x] Task 3: Claude Code adapter
- [x] Task 4: Codex adapter
- [x] Task 5: Shared sidecar/MCP proxy reference (if native hooks missing)
- [x] Task 6: verify-install probes + self-test per harness profile
- [x] Task 7: Distribution, COMPATIBILITY, CAPABILITY_STATUS, SKILL.md install paths
- [x] Task 8: Integration tests with fake harness buses
- [x] Task 9: Operator runbooks for each harness (graded guarantees)

**Total Tasks:** 9 | **Completed:** 9 | **Remaining:** 0

## Implementation Tasks

### Task 1: Adapter package layout and harness capability matrix fixture

**Objective:** Create `adapters/` workspace layout and a machine-readable matrix of which primitives each harness supports (pre-tool hook, approval UI, tool registration, workspace paths).

**Files:**
- Create: `adapters/README.md`
- Create: `adapters/harness-capabilities.json`
- Create: `adapters/cursor/package.json` (stub)
- Create: `adapters/claude-code/package.json` (stub)
- Create: `adapters/codex/package.json` (stub)
- Modify: root `package.json` workspaces if needed
- Test: `adapters/harness-capabilities.test.ts`

**Steps:**
1. RED: test fixture lists required fields per harness.
2. GREEN: stubs compile; matrix checked in CI.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 2: Cursor adapter (hook or MCP/sidecar strategy)

**Objective:** Implement Cursor `FppRuntimeAdapter`. Prefer native hooks if available at implement time; otherwise MCP/sidecar tool proxy that invokes enforcement-core before forwarding tools.

**Files:**
- Create: `adapters/cursor/src/index.ts`
- Create: `adapters/cursor/src/adapter.ts`
- Test: `adapters/cursor/src/adapter.test.ts`

**Steps:**
1. Research current Cursor extension/hook surfaces at implement time (do not invent APIs).
2. RED/GREEN: fake tool call → disposition → receipt under `profile: cursor`.
3. Document chosen strategy in adapter README.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 3: Claude Code adapter

**Objective:** Same as Task 2 for Claude Code (`.claude/` skills already work for prompt layer).

**Files:**
- Create: `adapters/claude-code/src/index.ts`
- Create: `adapters/claude-code/src/adapter.ts`
- Test: `adapters/claude-code/src/adapter.test.ts`

**Steps:**
1. Verify available hook/middleware APIs at implement time.
2. RED/GREEN disposition path with unattended defaults.
3. Docs.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 4: Codex adapter

**Objective:** Bring Codex from partial prompt support to an adapter with explicit graded guarantees.

**Files:**
- Create: `adapters/codex/src/index.ts`
- Create: `adapters/codex/src/adapter.ts`
- Test: `adapters/codex/src/adapter.test.ts`

**Steps:**
1. RED/GREEN against fake bus; note trigger-frontmatter limitations in matrix.
2. Docs.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 5: Shared sidecar/MCP proxy reference (if native hooks missing)

**Objective:** Shared reference implementation used by harnesses without native pre-tool hooks: proxy wraps tool invocations, calls enforcement-core, emits receipts.

**Files:**
- Create: `packages/tool-proxy/src/index.ts` (or `adapters/common/tool-proxy.ts`)
- Test: `packages/tool-proxy/src/index.test.ts`

**Steps:**
1. RED: deny/abstain prevents downstream tool invoke; allow forwards.
2. GREEN: mandate debit still applied.
3. Adapters import shared proxy where needed.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 6: verify-install probes + self-test per harness profile

**Objective:** `npm run verify-install -- --profile cursor|claude-code|codex|openclaw` reports accurate layer status.

**Files:**
- Modify: `scripts/verify-install.ts`
- Test: `scripts/verify-install.test.ts`
- Modify: `scripts/self-test.ts`

**Steps:**
1. RED/GREEN probes for each profile.
2. Unknown harness → warn, not false PASS on dispatcher.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 7: Distribution, COMPATIBILITY, CAPABILITY_STATUS, SKILL.md install paths

**Objective:** User-facing install instructions for each harness; matrix rows for adapters.

**Files:**
- Modify: `docs/COMPATIBILITY.md`
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `README.md`
- Modify: `SKILL.md`
- Modify: `MASTER_CONTEXT.md`

**Steps:**
1. Replace absolute “plugins do not run outside OpenClaw” with graded adapter status.
2. Keep honesty about hook-less harnesses.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 8: Integration tests with fake harness buses

**Objective:** CI-stable tests that do not require Cursor/Claude binaries.

**Files:**
- Create: `test/cross-harness-adapters-e2e.test.ts`

**Steps:**
1. Simulate tool calls per adapter using fakes.
2. Assert unattended abstain and mandate allow behave identically across adapters.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 9: Operator runbooks for each harness (graded guarantees)

**Objective:** Per-harness runbook: install, adopt, enable adapter, verify-install, known gaps.

**Files:**
- Create: `docs/runbooks/cursor.md`
- Create: `docs/runbooks/claude-code.md`
- Create: `docs/runbooks/codex.md`
- Modify: `docs/TROUBLESHOOTING.md` (index links)

**Steps:**
1. Write runbooks from verified commands only (dry-run where possible).
2. Cross-link COMPATIBILITY.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

## Testing Strategy

- Unit tests per adapter with fakes; shared tool-proxy tests; verify-install profile tests; e2e fake-bus suite in CI.
- Manual verification on real Cursor/Claude/Codex is recommended in `/verify` but not required for unit GREEN.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Harness APIs change or missing | Capability matrix + tool-proxy fallback; no false SHIPPED claims |
| Sidecar bypassed by direct tool use | Document threat; Plan 12 gateway path for stronger binding |
| Scope explosion | Fake-bus CI first; real-harness soak in verify notes |
| Divergent disposition behavior | Shared enforcement-core only; adapters translate events |
