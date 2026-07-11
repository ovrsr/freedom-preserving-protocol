# @ovrsr/fpp-adapter-claude-code

Claude Code `FppRuntimeAdapter` for the Freedom Preserving Protocol.

## Interception strategy

**Native Claude Code hooks** (`PreToolUse` / `PostToolUse`) via
`.claude/settings.json`. Returns `hookSpecificOutput.permissionDecision`.

Prompt-layer skills continue to work under `.claude/skills/` independently.

| Capability | Status |
|------------|--------|
| Pre-tool deny | yes |
| Operator ask | yes (`ask`) when `require_approval` |
| Unattended abstain | yes (default) |
| Bypass risk | `--dangerously-skip-permissions` / disabled hooks |

See `docs/runbooks/claude-code.md`.
