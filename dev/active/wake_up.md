# Wake-Up — 2026-07-19

## Sunrise Checklist (run first next session)
1. `git status --short`
2. `npm run typecheck`
3. `npx tsx --test --test-concurrency=1 scripts/update-installed-assets.test.ts scripts/assert-workspace-links.test.ts`

## Sunset Checklist (just completed)
- Verified safe in-place asset updates plan end-to-end (`docs/plans/2026-07-19-safe-in-place-asset-updates.md` → VERIFIED)
- Ownership-aware updater preserves unowned files; removes only stale owned paths
- CI workspace-link assertion in place; no nested plugin `npm ci`

## Pending Blockers
- Uncommitted protocol-core ClawHub secret-literal false-positive fix (`STEWARD_DIGEST_DOMAINS.authz`) — needs commit + plugin republish for ClawHub audit to clear

## Handoff Schema
- **session_goal:** Verify safe in-place asset updates; clear ClawHub false positive separately
- **current_task:** Plan VERIFIED; next is commit/publish of protocol-core secret-literal fix if desired
- **blockers:** none for the verified plan
- **verification_commands:**
  - `npm run test:all`
  - `npm run typecheck`
  - `bash scripts/update-installed-assets.sh --help`
  - `npx tsx --test --test-concurrency=1 scripts/update-installed-assets.test.ts`
- **next_command:** commit protocol-core authz rename + republish ClawHub plugins when ready
