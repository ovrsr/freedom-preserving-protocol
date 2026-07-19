# Maintainer Guidelines: Asset Update Process

This document is for developers and maintainers changing how FPP assets are refreshed on already-deployed systems.

## Purpose

The in-place updater exists to refresh installed artifacts from canonical source without publishing a new ClawHub release first and without clobbering operator state.

It is not a substitute for release engineering.

## Non-Negotiable Constraints

### Stage or pack before sync

Never sync raw monorepo directories straight into a live install root.

Required sources of truth:

- skill: `scripts/stage-skill.ts`
- plugins: `npm pack` output after `build` and `bundle:deps`
- adapters: `npm pack` output after `build` and `bundle:deps`

Reason: live installs must receive only the publishable surface plus bundled unpublished `@ovrsr/*` packages.

### Preserve local state

The updater must not modify:

- adoption state in `SOUL.md` or `MEMORY.md`
- audit logs
- trust graph or handshake state
- OpenClaw config
- harness hook config files outside the target package directory

Those surfaces encode host-local commitments, evidence, or policy and are not repo artifacts.

### Backup before overwrite

Every target directory must be backed up before sync unless the run is a dry run.

Do not introduce a no-backup fast path unless it is explicit, loudly named, and justified.

### Keep exact dependency semantics

Plugins and adapters rely on exact pins plus bundled unpublished workspace packages.

Do not weaken this by:

- replacing exact pins with ranges
- syncing consumer directories without `bundle:deps`
- assuming remote hosts can fetch unpublished `@ovrsr/fpp-*` packages from npm

## Scope Boundaries

### Appropriate uses

- refresh a host already running FPP assets
- smoke-test a pending fix on another machine before publish
- roll forward a plugin or adapter build while preserving host-local state

### Inappropriate uses

- first-time install documentation
- release publishing to ClawHub
- changing constitution text or signing flow
- migrating operator config automatically

Those belong in release, install, or governance procedures instead.

## Versioning Guidance

- The updater should report the source package version being synced.
- It should not invent a separate asset version scheme.
- If an asset requires a compatibility-breaking destination layout change, document that in both the runbook and `docs/COMPATIBILITY.md` before shipping the updater change.

## Verification Expectations

Before maintainers rely on the updater for others, validate:

```bash
npm run verify
npm run verify:all
bash scripts/update-installed-assets.sh --dry-run
```

When plugins change packaging behavior, also run:

```bash
bash scripts/verify-pack.sh
bash scripts/verify-adapter-pack.sh
```

## Design Rules For Future Changes

- Prefer additive CLI flags over changing default destructive behavior.
- Keep the default target set conservative: OpenClaw skill + plugins only.
- Require explicit destination paths for adapters unless a stable cross-host convention exists.
- Do not auto-edit Codex/Cursor/Claude hook config from this updater; package refresh and hook-policy changes are separate concerns.
- Keep rollback obvious: one backup directory per asset, `rsync`-restorable.
- If you add a new consumer artifact, teach the updater to pack that consumer rather than copying its source tree.

## Operator-Facing Messaging

Any user-facing or operator-facing text around this flow should stay honest about limits:

- in-place sync updates code artifacts, not trust or compliance truth
- successful sync does not prove runtime activation
- verification still belongs to `verify-install`, runtime inspect commands, and harness-specific checks
