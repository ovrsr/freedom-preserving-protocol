# Cross-harness adapters

Harness-specific packages that implement `FppRuntimeAdapter` from
`@ovrsr/fpp-enforcement-core` and wire native PreToolUse-style hooks (or the
shared MCP/tool-proxy sidecar) into enforcement-core dispositions.

| Harness | Package | Interception | Workspace profile |
|---------|---------|--------------|-------------------|
| OpenClaw | `@ovrsr/openclaw-fpp-plugin` (in `plugin/`) | Native `before_tool_call` | `openclaw` |
| Cursor | `@ovrsr/fpp-adapter-cursor` | `preToolUse` / `beforeMCPExecution` hooks | `cursor` |
| Claude Code | `@ovrsr/fpp-adapter-claude-code` | `PreToolUse` hooks | `claude-code` |
| Codex | `@ovrsr/fpp-adapter-codex` | `PreToolUse` hooks (graded coverage) | `codex` |

Machine-readable matrix: [`harness-capabilities.json`](./harness-capabilities.json).

## Graded guarantees

Adapters do **not** claim OpenClaw parity where the harness cannot provide it.
See `docs/COMPATIBILITY.md` and per-harness runbooks under `docs/runbooks/`.

Shared MCP/sidecar proxy: `@ovrsr/fpp-tool-proxy` (`packages/tool-proxy`).
