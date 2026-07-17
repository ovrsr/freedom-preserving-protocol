# Project Context — 2026-07-17 Emergency Override + Config-Drift Diagnostics

## Architecture & Design
- Emergency overrides are **mandate-shaped but mandate-separate**: `SignedEmergencyOverrideV1` + `fpp-emergency-overrides.json`, not a new `issuerClass` on `StandingMandateV1`.
- Stewards only for v1 (`quorumStewardEligibleIds`); peers excluded by design — agent-to-agent escalation is a larger trust decision.
- Local agent key always rejected at admit + findCoverage (defense-in-depth even if allowlist is wrong).
- Ladder order unchanged: hard-floor → mandate/standing → staged → quorum → emergency → abstain.
- Config diagnostics are shape-only for unattended standing-allow; quorum warns are trust-local and unconditional (no `dispositionMode` read).

## Implementation Details
- `packages/protocol-core/src/emergency-override.ts` — schema, signing fields (excludes remainingActions/revoked), verify
- `packages/protocol-core/src/disposition.ts:35` — `AUTHZ` named constants (ClawHub secret-literal FP fix)
- `packages/enforcement-core/src/emergency-override-store.ts:105` — `EmergencyOverrideStore` admit/findCoverage/debit
- `packages/enforcement-core/src/runtime-adapter.ts:516+` — coverage → `emergencyCriteriaMet` / rejection; debit on `allow_minimal`
- `packages/enforcement-core/src/config.ts:215` — `UNATTENDED_APPROVAL_WITHOUT_STANDING_ALLOW`
- `packages/trust-core/src/create-trust-stack.ts:131+` — `QUORUM_*_UNREACHABLE` / threshold exceeds eligible
- `plugin-trust/src/tools.ts:1046` — `executeEmergencyOverrideSubmit` (never signs)
- `plugin-trust/src/index.ts` + `openclaw.plugin.json` — tool registration + contracts

## Decisions & Trade-offs
- Chose store sibling path via `workspaceSibling(mandateStorePath, "fpp-emergency-overrides.json")` to share filesystem trust with mandates.
- plugin-trust depends on `@ovrsr/fpp-enforcement-core` for `EmergencyOverrideStore.admit` (workspace link/junction on Windows if npm registry 404).
- OpenClaw floor raised to `2026.3.28` (not 2026.3.25) — later Mar-2026 GHSAs.

## Critical Code Locations
- Entry (submit): `plugin-trust/src/tools.ts` → `executeEmergencyOverrideSubmit`
- Entry (consume): `packages/enforcement-core/src/runtime-adapter.ts` `onBeforeToolCall`
- Tests: `*-emergency*.test.ts`, `create-trust-stack.diagnostics.test.ts`, `compat-floor.test.ts`, `disposition.test.ts` (AUTHZ guard)

## Gotchas & Solutions
- Problem: `npx tsx -e` importing `plugin-trust/src/tools.ts` hung with no output.
  Cause: likely large transitive resolve / OpenClaw ambient graph on Windows inline eval.
  Fix: exercise submit via `plugin-trust/src/tools-emergency.test.ts`; E2E consume path via enforcement-core APIs (`EmergencyOverrideStore` + `createEnforcementRuntime`).
- Problem: plugin-trust bundled `@ovrsr/fpp-protocol-core` under `node_modules` lagged workspace dist (missing new exports).
  Cause: local bundled copy from prior pack, not workspace junction.
  Fix: junction `plugin-trust/node_modules/@ovrsr/fpp-*` → `packages/*` during local verify; rebuild cores before plugin-trust typecheck.
- Problem: `npm install -w @ovrsr/openclaw-fpp-trust` for enforcement-core hit E404 (unpublished package).
  Cause: registry has no `@ovrsr/fpp-enforcement-core`; workspace already links at root.
  Fix: declare dependency in package.json + junction; rely on workspaces.

## Testing Insights
- Full `npm test`: 519 passed, 0 failed across workspaces.
- Focused changed-area suite: 109 passed, 0 failed.
- Compat floor tests read `package.json` directly — keep minGatewayVersion exact `2026.3.28` and peerDep range `>=2026.3.28`.
