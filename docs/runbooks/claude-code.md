# Runbook: Claude Code adapter

Graded dispatcher path for Claude Code via `PreToolUse` / `PostToolUse` hooks.
Prompt-layer skills already work under `.claude/skills/`. Operator can disable
hooks or use `--dangerously-skip-permissions`.

## Prerequisites

- Node `>=22.19`
- Clone of this repository
- Claude Code with hooks configured in `.claude/settings.json` or `~/.claude/settings.json`

## Install prompt layer

```bash
# Project
cp -r . .claude/skills/freedom-preserving-protocol
# or user: ~/.claude/skills/freedom-preserving-protocol
```

## Enable adapter hooks

Merge `adapters/claude-code/hooks/settings.fragment.json` into your Claude
settings `hooks` block. The sample command:

```text
npx tsx adapters/claude-code/src/hook-cli.ts
```

Default workspace profile: `claude-code` → `~/.fpp/claude-code`.

## Adopt

```bash
npm run adopt -- --soul path/to/SOUL.md --memory path/to/MEMORY.md
```

## Verify

```bash
npm run verify-install -- --profile claude-code --json
```

Expected: `runtime.probe.claude-code` status `pass` / probe `active` when
`adapters/claude-code/package.json` is present in the checkout.

```bash
npm run self-test
```

## Known gaps

| Gap | Notes |
|-----|-------|
| `--dangerously-skip-permissions` | Bypasses hooks — do not use for governed agents |
| Not OpenClaw plugin parity | No ClawHub tool registration / trust plugin UI |
| Hook trust | Claude may require reviewing new hook commands |

## Related

- Adapter: `adapters/claude-code/`
- Matrix: `adapters/harness-capabilities.json`
- Compatibility: `docs/COMPATIBILITY.md`
