# Project Context — 2026-07-17 internal tool classifier named classes

## Architecture & Design
- Named low-risk classes replace opaque `unknown.unclassified` for high-volume OpenClaw internals: `internal.heartbeat`, `internal.read`, `gateway.inspect`.
- Classifier order (after filesystem/exec/http/message/code.patch): heartbeat → internal.read → gateway tool → `fpp_*` → `knownCustomTools` → unknown.
- `knownCustomTools` default is `[]` (operator extras only). Curated tools are first-class classes, not seed allowlist entries.
- `exec.benign` removed from reversibility set → disposition `allow` (no staged ledger noise); workspace writes still `allow_staged`.

## Implementation Details
- `packages/enforcement-core/src/risk-classifier.ts` — `classifyInternalHeartbeat`, `INTERNAL_READ_TOOLS` + `classifyInternalRead`, `classifyGatewayTool` (action/command/method/argv tokens; fail-closed on ambiguity).
- `packages/enforcement-core/src/reversibility.ts` — reversible set includes new internal/gateway.inspect ids; excludes `exec.benign`.
- `packages/enforcement-core/src/config.ts` — `knownCustomTools: []`.
- Plugin consumes via workspace bundle: after core edits run `npm run build` in enforcement-core then `npm run bundle:deps` in plugin.

## Decisions & Trade-offs
- Chose named classes over expanding `knownCustomTools` so audit ids are contestable (Law 6) and not `unknown.unclassified`.
- Gateway inspect must not fail-open: missing/unknown action → `unknown.unclassified` / approval.
- Heartbeat matches `/heartbeat_respond$/i` so mangled `openclawheartbeat_respond` works without seed.

## Critical Code Locations
- Entry: `packages/enforcement-core/src/risk-classifier.ts` (`classifyToolCall`)
- Runtime hook: `packages/enforcement-core/src/runtime-adapter.ts` (~505 classify, ~546 reversible)
- Disposition: `packages/enforcement-core/src/disposition-engine.ts`
- Tests: `risk-classifier.test.ts`, `reversibility.test.ts`, `disposition-engine.test.ts`, `plugin/src/security-regressions.test.ts`
- Program: `scripts/self-test.ts`, `scripts/run-classifier-corpus.ts`

## Gotchas & Solutions
- Problem: plugin e2e still saw `unknown.unclassified` after core source change.
  Cause: `plugin/node_modules/@ovrsr/fpp-enforcement-core` is a bundled copy, not the workspace symlink.
  Fix: `cd packages/enforcement-core && npm run build && cd ../../plugin && npm run bundle:deps`.
- Problem: intermittent `tsx --test` hangs on Windows when many node processes accumulate.
  Cause: resource contention / stuck runners.
  Fix: kill stray `node.exe`, re-run; prefer focused `--test-name-pattern` when debugging.

## Testing Insights
- Corpus fixtures: `test/fixtures/classifier-benign.json` + `classifier-adversarial.json`.
- Self-test fixtures now cover heartbeat / internal.read / gateway.inspect ± negative / apply_patch.
