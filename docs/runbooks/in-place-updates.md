# Runbook: In-Place Asset Updates

This runbook is for operators updating an already-installed FPP deployment on another system or agent host without going through a fresh ClawHub publish/install cycle.

Use this when you need to refresh one or more of:

- the prompt-layer skill
- the OpenClaw enforcement plugin
- the OpenClaw trust plugin
- the Cursor / Claude Code / Codex adapter package directory

Do not use this runbook to modify adoption state. It does not edit `SOUL.md`, `MEMORY.md`, audit logs, trust graphs, or your OpenClaw config.

## What The Update Script Does

`scripts/update-installed-assets.sh` stages canonical install artifacts first, then syncs them into an existing install directory:

- skill: staged from `scripts/stage-skill.ts`
- plugins: packed from `plugin/` or `plugin-trust/` after `build` + `bundle:deps`
- adapters: packed from `adapters/<harness>/` after `build` + `bundle:deps`

This matters because copying raw monorepo directories into live installs can leave behind unpublished files, missing bundled `@ovrsr/*` dependencies, or a half-built `dist/`.

### Ownership model

After a successful sync, each target directory contains `.fpp-updater-manifest.json`. That file lists only the relative paths the updater delivered from the staged artifact.

| Situation | Behavior |
|---|---|
| First update of a legacy target (no manifest yet) | **Additive only.** Staged files are copied/overwritten; nothing else is deleted. |
| Later update (manifest present) | Staged files are copied; files listed in the prior manifest but absent from the new staged inventory are removed as stale owned files. |
| Any other file in the target | **Never deleted** by the updater, including operator state and unknown local files. |

Unsafe manifest entries (absolute paths or `..` segments) cause the update to abort before destination writes.

Ownership behavior is covered by `scripts/update-installed-assets.test.ts`.

## Prerequisites

- Node `>=22.19`
- `npm`
- `rsync` (preferred; the updater falls back to `cp -a` when `rsync` is unavailable — both paths use the same ownership rules)
- `tar`
- a clone of `https://github.com/ovrsr/freedom-preserving-protocol`

Recommended start:

```bash
tmp="$(mktemp -d)"
git clone https://github.com/ovrsr/freedom-preserving-protocol "$tmp/fpp"
cd "$tmp/fpp"
```

## Dry Run First

Always start with a dry run:

```bash
bash scripts/update-installed-assets.sh --dry-run
```

Dry-run stages artifacts (or uses an existing stage in tests), reports planned copies, and lists planned owned-file removals. It does not modify the target directory, write a new ownership manifest, or create backups.

Default targets when none are specified:

- `~/.openclaw/skills/freedom-preserving-protocol`
- `~/.openclaw/extensions/openclaw-fpp-plugin`
- `~/.openclaw/extensions/openclaw-fpp-trust`

If your install roots differ, pass them explicitly.

## Common Update Procedures

### OpenClaw skill + plugins

```bash
bash scripts/update-installed-assets.sh
```

### OpenClaw with nonstandard install roots

```bash
bash scripts/update-installed-assets.sh \
  --skill-dir "$HOME/skills/freedom-preserving-protocol" \
  --plugin-dir "$HOME/.openclaw/extensions/openclaw-fpp-plugin" \
  --trust-dir "$HOME/.openclaw/extensions/openclaw-fpp-trust"
```

### Codex adapter only

The script updates only the adapter package directory. It does not rewrite `~/.codex/hooks.json`.

```bash
bash scripts/update-installed-assets.sh \
  --codex-dir "$HOME/lib/fpp/adapters/codex"
```

Afterward, confirm your Codex hook config still points at the adapter entrypoint in that directory.

### Mixed OpenClaw + Codex

```bash
bash scripts/update-installed-assets.sh \
  --skill-dir "$HOME/.openclaw/skills/freedom-preserving-protocol" \
  --plugin-dir "$HOME/.openclaw/extensions/openclaw-fpp-plugin" \
  --trust-dir "$HOME/.openclaw/extensions/openclaw-fpp-trust" \
  --codex-dir "$HOME/lib/fpp/adapters/codex"
```

## Backups

Before any non-dry-run write, each existing target directory is copied in full (including `.fpp-updater-manifest.json` when present) to:

```text
~/.fpp/update-backups/<timestamp>/<asset-name>/
```

Asset labels match the sync labels: `skill`, `plugin`, `plugin-trust`, `adapter-cursor`, `adapter-claude-code`, `adapter-codex`.

Override the parent backup root with:

```bash
bash scripts/update-installed-assets.sh --backup-root /srv/fpp-backups
```

## Post-Update Verification

### Skill

```bash
cd ~/.openclaw/skills/freedom-preserving-protocol
npm run verify
npm run verify-install -- --profile openclaw
```

If the agent is adopted on that host, include `--soul` and `--memory`.

### OpenClaw plugins

```bash
openclaw plugins inspect openclaw-fpp-plugin --runtime --json
openclaw plugins inspect openclaw-fpp-trust --runtime --json
```

Expected direction: active runtime status, current package versions, no missing bundled dependencies.

### Codex

```bash
cd /path/to/adapter-dir
npm test
```

Then run:

```bash
cd /path/to/repo-clone
npm run verify-install -- --profile codex --json
```

Expected direction: the profile should report Codex probe status honestly. Shell-mediated coverage is the reliable path; `apply_patch` and some MCP flows remain graded rather than full-parity.

## What This Procedure Deliberately Does Not Touch

- `SOUL.md`
- `MEMORY.md`
- `.openclaw/workspace/constitution-audit.jsonl`
- `.openclaw/workspace/fpp-plugin-audit.jsonl`
- `.openclaw/workspace/fpp-trust-graph.json`
- `openclaw.json` or other host config files
- `~/.codex/hooks.json`, `~/.cursor/...`, `.claude/...` hook config files
- any other file in the target that is not listed in `.fpp-updater-manifest.json`

Those are operator-controlled state or local policy surfaces. The ownership model plus `scripts/update-installed-assets.test.ts` back this preservation guarantee: the updater never sweeps unowned destination content.

## Rollback

Restore the backed-up asset directory with `rsync` (or an equivalent full-tree restore). Rollback intentionally replaces the live target with the pre-update snapshot, including the prior ownership manifest:

```bash
rsync -a --delete \
  "$HOME/.fpp/update-backups/<timestamp>/plugin/" \
  "$HOME/.openclaw/extensions/openclaw-fpp-plugin/"
```

Apply the same pattern for `skill`, `plugin-trust`, or adapter backups (`adapter-cursor`, `adapter-claude-code`, `adapter-codex`).
