# Runbook: Codex adapter

Graded dispatcher path for OpenAI Codex CLI via `PreToolUse` hooks. Shell/Bash
coverage is the reliable path; `apply_patch` and some MCP tools have historically
had incomplete hook coverage. Skill `trigger:` frontmatter remains partial on
some Codex runtimes. No FPP operator approval UI — unattended defaults only.

## Prerequisites

- Node `>=22.19`
- Clone of this repository
- Codex CLI with hooks support (`~/.codex/hooks.json`)

## Install prompt layer

Install/copy the skill per AgentSkills / Codex skill docs. Expect partial
`trigger:` frontmatter support.

## Enable adapter hooks

```bash
cp adapters/codex/hooks/hooks.json ~/.codex/hooks.json
# Adjust the command path to your checkout of:
#   npx tsx adapters/codex/src/hook-cli.ts
```

Codex may require trusting new hook definitions before they run. Prefer
`--full-auto` over flags that bypass approvals/sandbox in ways that weaken
governance (see Codex hooks docs).

Default workspace profile: `codex` → `~/.fpp/codex`.

## Adopt

```bash
npm run adopt -- --soul path/to/SOUL.md --memory path/to/MEMORY.md
```

## Verify

```bash
npm run verify-install -- --profile codex --json
```

Expected: `runtime.probe.codex` → `active` when the adapter package is present.

```bash
npm run self-test
```

## Known gaps

| Gap | Notes |
|-----|-------|
| Shell-first coverage | Prefer shell-mediated actions when governance must fire |
| apply_patch / MCP | May not always hit PreToolUse — do not claim full parity |
| No approval UI | `require_approval` → deny (fail-closed) in this adapter |
| Trigger frontmatter | Partial on some Codex skill loaders |

## Related

- Adapter: `adapters/codex/`
- Matrix: `adapters/harness-capabilities.json`
- Compatibility: `docs/COMPATIBILITY.md`
- Shared proxy: `packages/tool-proxy/` (`@ovrsr/fpp-tool-proxy`)
