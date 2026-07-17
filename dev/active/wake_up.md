# Wake-Up — 2026-07-17

## Sunrise Checklist (run first next session)
1. `git status --short`
2. `npm run typecheck`
3. `npm test`

## Sunset Checklist (just completed)
- Plan `docs/plans/2026-07-17-emergency-override-and-config-drift-diagnostics.md` → **VERIFIED**
- Emergency override tier wired end-to-end (schema → store → runtime → MCP submit)
- Config-drift diagnostics + ClawHub AUTHZ FP + OpenClaw `>=2026.3.28` floor

## Pending Blockers
- none

## Handoff Schema
- **session_goal:** Emergency override tier + config-drift diagnostics verified and ready to commit when asked
- **current_task:** none (plan VERIFIED)
- **blockers:** none
- **verification_commands:**
  - `npm test` → 519 passed, 0 failed
  - `npm run build:core && npm run typecheck` → exit 0
  - focused: emergency/disposition/config/compat tests → 109 passed
- **next_command:** commit when user requests (do not commit unprompted); then optional ClawHub publish is out of this plan's scope
