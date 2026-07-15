# Runbook: Cursor adapter

Graded dispatcher path for Cursor Agent via native hooks (`preToolUse` /
`beforeMCPExecution`). Not gateway-non-bypassable — the operator can disable
hooks. See `adapters/harness-capabilities.json` and `docs/COMPATIBILITY.md`.

## Prerequisites

- Node `>=22.19` (repo `package.json` `engines.node`)
- Clone of this repository **or** a packed adapter tarball after `bundle:deps` / `prepack` (adapters are `private: true` and embed unpublished `@ovrsr/*` via `bundledDependencies`; they are not on npm)
- Cursor with Agent hooks enabled

## Install from pack (optional, outside workspace)

```bash
cd adapters/cursor && npm run bundle:deps && npm pack
# then npm install ./ovrsr-fpp-adapter-cursor-*.tgz in the consumer project
```

## Install prompt layer

Place the skill under `.cursor/skills/freedom-preserving-protocol/` or
`~/.cursor/skills/` (AgentSkills layout).

## Enable adapter hooks

From the repo root, copy the sample hooks config and adjust the command path to
your checkout:

```bash
# Project-scoped
cp adapters/cursor/hooks/hooks.json .cursor/hooks.json
```

Or merge into `~/.cursor/hooks.json`. The sample runs:

```text
npx tsx adapters/cursor/src/hook-cli.ts
```

Optional: set `FPP_ENFORCEMENT_CONFIG` to a JSON config path. Default workspace
profile is `cursor` → `~/.fpp/cursor` (override with `FPP_WORKSPACE`).

## Adopt

```bash
npm run adopt -- --soul path/to/SOUL.md --memory path/to/MEMORY.md
```

## Verify

Verified command (exit 0, probe active when adapter package is present):

```bash
npm run verify-install -- --profile cursor --json
```

Expected probe excerpt:

```json
"probes": [{ "harnessId": "cursor", "status": "active" }],
"summary": { "dispatcherLayerActive": true }
```

Classifier dry-run (all harnesses):

```bash
npm run self-test
```

## Known gaps

| Gap | Notes |
|-----|-------|
| Operator can disable hooks | By design (Law 2); not Plan 12 gateway binding |
| Cloud agents | Some MCP hooks may be deferred per Cursor docs |
| Trust plugin | OpenClaw-only today; cores are importable without it |
| Sidecar bypass | Direct tool use that skips hooks is ungated — use `@ovrsr/fpp-tool-proxy` for MCP gateways |

## Related

- Adapter: `adapters/cursor/`
- Matrix: `adapters/harness-capabilities.json`
- Compatibility: `docs/COMPATIBILITY.md`
