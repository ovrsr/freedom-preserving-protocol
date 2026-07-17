# Wake-Up — 2026-07-17

## Sunrise Checklist (run first next session)
1. `git status --short`
2. `npm run typecheck`
3. `npm test -w @ovrsr/fpp-enforcement-core && npm test -w @ovrsr/openclaw-fpp-plugin`

## Sunset Checklist (just completed)
- Implemented + verified named classifier classes: `internal.heartbeat`, `internal.read`, `gateway.inspect`
- Demoted default `knownCustomTools` to `[]`; `memory_search` via `internal.read`
- Stopped staging `exec.benign`; docs + corpus/self-test aligned
- Plan status: **VERIFIED** — `docs/plans/2026-07-17-internal-tool-classifier-named-classes.md`

## Pending Blockers
- none

## Handoff Schema
- **session_goal:** Close underclassification of OpenClaw internal tools with named allow classes
- **current_task:** VERIFIED — ready for commit / optional ClawHub bump (out of plan scope)
- **blockers:** none
- **verification_commands:**
  - `npm test` (553 across workspaces, 0 failed)
  - `npm run typecheck`
  - `npx tsx scripts/self-test.ts` (16/16)
  - `npx tsx scripts/run-classifier-corpus.ts` (54/54)
- **next_command:** commit when requested, or start next plan
