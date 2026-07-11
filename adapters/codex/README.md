# @ovrsr/fpp-adapter-codex

Codex `FppRuntimeAdapter` for the Freedom Preserving Protocol.

## Interception strategy

**Native Codex hooks** (`PreToolUse` / `PostToolUse`) via `~/.codex/hooks.json`.

### Graded guarantees

- Shell/Bash PreToolUse: reliable deny path
- `apply_patch` / some MCP tools: historically incomplete coverage — do not claim parity
- Skill `trigger:` frontmatter: partial on some Codex runtimes
- No FPP operator approval UI → `dispositionMode: "unattended"` forced; `require_approval` → deny

See `adapters/harness-capabilities.json` and `docs/runbooks/codex.md`.
