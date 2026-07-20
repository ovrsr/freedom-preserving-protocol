# Project Context — Safe In-Place Asset Updates (VERIFIED 2026-07-19)

## Architecture & Design
- Ownership-aware sync replaces whole-tree deletion: staged files are copied; only paths in the prior `.fpp-updater-manifest.json` that are absent from the new staged inventory may be removed.
- First update of a legacy target (no manifest) is additive — no inferred ownership.
- `rsync` and `cp -a` backends share the same ownership rules; `rsync --delete` / `rm -rf "$dest"` must not return.

## Implementation Details
- Entry: `scripts/update-installed-assets.sh`
- Core sync: `sync_owned` (called from `sync_dir`); backups via `backup_dir` → `copy_trees`
- Manifest name: `.fpp-updater-manifest.json` (`OWNED_MANIFEST_NAME`)
- Test seam: `FPP_UPDATE_TEST_STAGE` injects a pre-staged tree (skips real pack/stage)
- CI: root-only `npm ci` + `scripts/assert-workspace-links.test.ts` (nested plugin `npm ci` drops workspace links)

## Decisions & Trade-offs
- Chose explicit ownership manifest over “delete everything not in stage” so operator state (`SOUL.md`, `MEMORY.md`, audit/trust, unknown local files) survives updates.
- Manifest written only after successful sync; unsafe paths (`..`, absolute) abort before writes.

## Critical Code Locations
- Entry / sync: `scripts/update-installed-assets.sh`
- Tests: `scripts/update-installed-assets.test.ts`, `scripts/assert-workspace-links.test.ts`
- Docs: `docs/runbooks/in-place-updates.md`, `docs/MAINTAINER_UPDATE_GUIDELINES.md`, `README.md`
- Plan: `docs/plans/2026-07-19-safe-in-place-asset-updates.md` (Status: VERIFIED)

## Gotchas & Solutions
- Problem: Nested `npm ci` in plugin dirs broke adapter resolution of `@ovrsr/fpp-tool-proxy`.
  Cause: Nested install rewrites the tree and drops workspace links.
  Fix: CI uses root `npm ci` only; assert with `scripts/assert-workspace-links.test.ts`.
- Problem: ClawHub `suspicious.exposed_secret_literal` on `authorization: "fpp:v2:…"` domain separators (unrelated to this plan; uncommitted fix in protocol-core).
  Cause: Scanner treats property name `authorization` + string literal as an API token.
  Fix pattern (same as `AUTHZ.*` in disposition): rename key to `authz` / use shorthand properties.

## Testing Insights
- Updater unit tests never run real `npm pack`/`stage-skill`; they rely on `FPP_UPDATE_TEST_STAGE`.
- Force `cp` fallback in tests via env when validating non-rsync path.
- E2E fixture: dry-run must leave target + stale owned file untouched; apply removes only stale owned paths and refreshes the manifest.
