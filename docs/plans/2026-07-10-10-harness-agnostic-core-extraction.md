# Harness-Agnostic Core Extraction

**Status:** PENDING
**Created:** 2026-07-10
**Series:** Plan 10 of 12 (autonomy + harness-agnostic program)
**Depends on:** Plans 8–9 (disposition + mandates + quorum stable enough to move)
**Unblocks:** Plan 11 (cross-harness adapters), cleaner library consumers
**Scope:** In: extract `@ovrsr/fpp-enforcement-core` and `@ovrsr/fpp-trust-core`; fold remaining shared contracts into `@ovrsr/fpp-protocol-core` as needed; define `FppRuntimeAdapter` interface; thin OpenClaw adapters in `plugin/` and `plugin-trust/`; harness-neutral workspace profiles (`FPP_WORKSPACE` / profile map); update `verify-install` for pluggable runtime probes. Out: full Cursor/Claude/Codex adapter implementations (Plan 11); gateway RFC (Plan 12); changing seed constitution hash; removing OpenClaw distribution (OpenClaw remains first-class adapter, not deleted).

## Summary

Make protocol policy and trust logic importable without the OpenClaw Plugin SDK. OpenClaw packages become thin adapters over shared cores. Disposition/mandate schemas already live in protocol-core (Plan 8); this plan moves engines and trust stack out of plugin trees.

## Architecture Notes

```text
@ovrsr/fpp-protocol-core     schemas, crypto, mandates, quorum, receipts
@ovrsr/fpp-enforcement-core  classifier, disposition-engine, mandate-store,
                             receipts I/O helpers, staged/emergency ledgers
@ovrsr/fpp-trust-core        trust-graph, handshake, quorum-session, disputes,
                             capsules, createTrustStack
plugin/                      OpenClaw adapter: definePluginEntry + hooks
plugin-trust/                OpenClaw adapter: defineToolPlugin + CLI
```

- `FppRuntimeAdapter`: `harnessId`, `onBeforeToolCall`, `onAfterToolCall?`, `registerTools?`, `requestApproval?`, `getWorkspacePaths()`.
- Default paths via profile: `openclaw` → `.openclaw/workspace`; `generic` → `$FPP_WORKSPACE` or `~/.fpp`.
- Exact version pins from plugins → new cores (same release discipline as protocol-core).

## Feature Inventory

| Existing file/function | New destination | Task |
|---|---|---|
| `plugin/src/risk-classifier.ts` | `packages/enforcement-core/src/risk-classifier.ts` | Task 2 |
| `plugin/src/disposition-engine.ts` (+ related Plan 8 modules) | `packages/enforcement-core/` | Task 2 |
| `plugin/src/receipt-store.ts`, `audit-log.ts`, `receipt-*` | `packages/enforcement-core/` | Task 2 |
| `plugin/src/index.ts::registerEnforcement` | core `createEnforcementRuntime` + OpenClaw adapter | Tasks 2–3 |
| `plugin/src/index.ts::decide` (legacy) | removed after core move | Task 2 |
| `plugin-trust/src/trust-graph.ts`, `handshake.ts`, `disputes.ts`, … | `packages/trust-core/` | Task 4 |
| `plugin-trust/src/index.ts::createTrustStack` | `packages/trust-core/` | Task 4 |
| `plugin-trust` OpenClaw tool registration | thin adapter | Task 5 |
| Hardcoded `.openclaw/workspace` defaults | `packages/protocol-core` or shared `workspace-profile.ts` | Task 6 |
| `scripts/verify-install.ts` openclaw-only probe | pluggable `RuntimeProbe[]` | Task 7 |

## Progress Tracking

- [ ] Task 1: Workspace packages and release pin conventions
- [ ] Task 2: Extract enforcement-core and migrate plugin imports
- [ ] Task 3: OpenClaw enforcement adapter + FppRuntimeAdapter interface
- [ ] Task 4: Extract trust-core and migrate plugin-trust imports
- [ ] Task 5: OpenClaw trust adapter (tools + CLI)
- [ ] Task 6: Workspace profiles and path defaults
- [ ] Task 7: verify-install pluggable probes + docs matrix
- [ ] Task 8: CI, pack, CAPABILITY_STATUS, interop tests
- [ ] Task 9: Library consumer smoke test (no OpenClaw peer)

**Total Tasks:** 9 | **Completed:** 0 | **Remaining:** 9

## Implementation Tasks

### Task 1: Workspace packages and release pin conventions

**Objective:** Add `packages/enforcement-core` and `packages/trust-core` to npm workspaces with build/test scripts mirroring protocol-core.

**Files:**
- Create: `packages/enforcement-core/package.json`
- Create: `packages/trust-core/package.json`
- Create: `packages/enforcement-core/tsconfig.json`
- Create: `packages/trust-core/tsconfig.json`
- Modify: `package.json` (workspaces already `packages/*`)
- Modify: `docs/RELEASE_ASSURANCE.md`

**Steps:**
1. Scaffold packages depending on exact `@ovrsr/fpp-protocol-core`.
2. Empty index + smoke test RED/GREEN.
3. Document release order: protocol-core → enforcement-core → trust-core → plugins.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 2: Extract enforcement-core and migrate plugin imports

**Objective:** Move classifier, disposition engine, mandate store, receipt/audit modules into enforcement-core; plugin re-exports or imports from package.

**Files:**
- Create: `packages/enforcement-core/src/**` (moved modules)
- Modify: `plugin/src/**` to import from `@ovrsr/fpp-enforcement-core`
- Modify: `plugin/package.json` dependency pin
- Test: move/adapt `plugin/src/*.test.ts` that test pure logic into enforcement-core

**Steps:**
1. Move files; fix imports; keep behavior identical (characterization tests first if needed).
2. Plugin tests still pass via adapter.
3. `npm run typecheck` + `npm test`.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 3: OpenClaw enforcement adapter + FppRuntimeAdapter interface

**Objective:** Define harness-neutral adapter interface; OpenClaw `definePluginEntry` only translates hooks ↔ core.

**Files:**
- Create: `packages/enforcement-core/src/runtime-adapter.ts`
- Modify: `plugin/src/index.ts`
- Test: `packages/enforcement-core/src/runtime-adapter.test.ts`
- Test: `plugin/src/index.test.ts`

**Steps:**
1. RED: fake adapter drives disposition without OpenClaw types.
2. GREEN: OpenClaw adapter implements interface; `requestApproval` only used in operator-present mode.
3. Typecheck + tests.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 4: Extract trust-core and migrate plugin-trust imports

**Objective:** Move trust stack modules and `createTrustStack` into trust-core; zero `openclaw` imports inside trust-core.

**Files:**
- Create: `packages/trust-core/src/**`
- Modify: `plugin-trust/src/**`
- Modify: `plugin-trust/package.json`
- Test: relocated unit tests under trust-core

**Steps:**
1. Grep trust-core for `openclaw` — must be empty.
2. GREEN: all prior trust unit tests pass from new package.
3. Typecheck + tests.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 5: OpenClaw trust adapter (tools + CLI)

**Objective:** `defineToolPlugin` + CLI remain in `plugin-trust/` as thin wrappers over trust-core.

**Files:**
- Modify: `plugin-trust/src/index.ts`
- Modify: `plugin-trust/src/cli.ts`
- Test: `plugin-trust/src/index.test.ts`
- Test: `plugin-trust/src/cli.test.ts`

**Steps:**
1. Ensure tool execute functions call trust-core only.
2. Regressions still pass.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 6: Workspace profiles and path defaults

**Objective:** Replace hardcoded `.openclaw/workspace` defaults with profile-resolved paths; OpenClaw profile preserves current defaults.

**Files:**
- Create: `packages/protocol-core/src/workspace-profile.ts` (or enforcement-core if preferred — **prefer protocol-core** for shared adopt/verify scripts)
- Modify: `plugin/src/config.ts` defaults
- Modify: `plugin-trust` config defaults
- Modify: `scripts/safe-append.ts`, `scripts/verify-install.ts` (accept `--profile`)
- Test: `packages/protocol-core/src/workspace-profile.test.ts`

**Steps:**
1. RED/GREEN profile resolution.
2. Document `FPP_WORKSPACE` override.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 7: verify-install pluggable probes + docs matrix

**Objective:** Dispatcher detection is not OpenClaw-only; probes return active/inactive/unknown per harness.

**Files:**
- Modify: `scripts/verify-install.ts`
- Test: `scripts/verify-install.test.ts`
- Modify: `docs/COMPATIBILITY.md`
- Modify: `MASTER_CONTEXT.md` (cross-runtime section)

**Steps:**
1. RED: inject fake probe; OpenClaw probe remains default when CLI present.
2. GREEN: report graded layers honestly for generic profile.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 8: CI, pack, CAPABILITY_STATUS, interop tests

**Objective:** CI builds/tests new packages; pack order updated; capability matrix lists library cores as SHIPPED/PARTIAL.

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/verify-all.sh`
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `test/protocol-core-interoperability.test.ts` (extend or add core interop)

**Steps:**
1. verify:all includes new workspaces.
2. Update version line in CAPABILITY_STATUS when packages publish-ready.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 9: Library consumer smoke test (no OpenClaw peer)

**Objective:** Prove enforcement-core + trust-core run in a Node script without `openclaw` installed.

**Files:**
- Create: `test/library-consumer-smoke.test.ts`

**Steps:**
1. RED: import cores, run classify + resolveDisposition + createTrustStack in-process.
2. GREEN: assert no openclaw resolution required.
3. Add to `test:e2e` or `test:interop`.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

## Testing Strategy

- Package unit tests after move; plugin adapter tests; library smoke without OpenClaw; verify-all CI gate.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Large move breaks imports | Characterization tests before move; exact pin versions |
| Circular deps core↔core | enforcement-core and trust-core both depend only on protocol-core; share files via protocol-core |
| Path default change surprises operators | `openclaw` profile preserves `.openclaw/workspace` |
| Publish order mistakes | RELEASE_ASSURANCE checklist |
