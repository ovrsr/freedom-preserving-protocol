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

## Prerequisites

- Node `>=22.19`
- `npm`
- `rsync` (preferred; the updater falls back to `cp -a` when `rsync` is unavailable)
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

Before overwrite, each target directory is copied to:

```text
~/.fpp/update-backups/<timestamp>/<asset-name>/
```

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

Those are operator-controlled state or local policy surfaces. Update them separately and intentionally.

## Rollback

Restore the backed-up asset directory with `rsync`:

```bash
rsync -a --delete \
  "$HOME/.fpp/update-backups/<timestamp>/plugin/" \
  "$HOME/.openclaw/extensions/openclaw-fpp-plugin/"
```

Apply the same pattern for `skill`, `plugin-trust`, or adapter backups.
