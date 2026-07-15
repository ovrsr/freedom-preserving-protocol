# @ovrsr/fpp-adapter-cursor

Cursor `FppRuntimeAdapter` for the Freedom Preserving Protocol.

## Interception strategy

**Native Cursor hooks** (`preToolUse` / `beforeMCPExecution`), not an invented
extension API. Install the sample hook config and point the command at the
adapter CLI (or `npx tsx` against `handleCursorPreToolUse`).

| Capability | Status |
|------------|--------|
| Pre-tool deny | yes — via hook `permissionDecision: "deny"` |
| Operator ask | yes — `permissionDecision: "ask"` when disposition is `require_approval` |
| Unattended abstain | yes — default `dispositionMode: "unattended"` |
| Non-bypassable gateway | no — operator can disable hooks (Plan 12) |

See `adapters/harness-capabilities.json` and `docs/runbooks/cursor.md`.

## Workspace

Default profile: `cursor` → `~/.fpp/cursor` (override with `FPP_WORKSPACE`).

Optional `FPP_ENFORCEMENT_CONFIG` must point to a JSON file **inside** that workspace root; paths outside are rejected.

## Install (hooks)

Copy [`hooks/hooks.json`](./hooks/hooks.json) into `.cursor/hooks.json` (project)
or `~/.cursor/hooks.json` (user), adjusting the command path to your checkout.
