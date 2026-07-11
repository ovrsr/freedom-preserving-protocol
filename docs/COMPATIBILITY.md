# Compatibility

Freedom Preserving Protocol ships installable artifacts at three layers. Each has different compatibility requirements. Read this before installing.

## Layer summary

| Layer | Artifact | What it can do | What it cannot do |
|-------|----------|----------------|-------------------|
| Protocol contracts | `@ovrsr/fpp-protocol-core` | Shared schemas, canonicalization, Merkle, identity, claim/freshness/receipt contracts, workspace profiles (`FPP_WORKSPACE`). | Enforce policy at runtime; emit receipts by itself. |
| Library cores | `@ovrsr/fpp-enforcement-core`, `@ovrsr/fpp-trust-core` | Importable classifier, disposition engine, mandate store, trust stack (`createTrustStack`) with **no** OpenClaw peer dependency. | Register harness hooks by themselves — that requires an adapter (`plugin/`, `adapters/cursor`, `adapters/claude-code`, `adapters/codex`). |
| Prompt-layer | This skill (`freedom-preserving-protocol`) | Add normative text to the agent's context; shape reasoning; describe a five-question check the model runs in-context. | Mechanically veto a tool call. Survive prompt injection. Survive a hostile skill loaded after this one. |
| Dispatcher-layer | OpenClaw plugins + cross-harness adapters | OpenClaw: `before_tool_call` / `after_tool_call`. Cursor / Claude Code / Codex: native PreToolUse-style hooks (graded). Shared MCP sidecar: `@ovrsr/fpp-tool-proxy`. | Survive a malicious operator with shell access. Survive a compromised runtime. Survive an operator who disables hooks/plugins. Prove completeness of all actions or behavioral compliance. Gateway-non-bypassable binding is Plan 12. |

## Runtime support matrix

| Surface | OpenClaw | Cursor | Claude Code | Codex | Library (Node, no harness) |
|---------|----------|--------|-------------|-------|----------------------------|
| Prompt-layer skill | yes | yes (AgentSkills) | yes | partial (`trigger:` gaps) | n/a |
| Enforcement / trust **cores** | via OpenClaw adapters | via `@ovrsr/fpp-adapter-cursor` | via `@ovrsr/fpp-adapter-claude-code` | via `@ovrsr/fpp-adapter-codex` | yes |
| Dispatcher hooks | yes (`before_tool_call`) | yes (`preToolUse` / `beforeMCPExecution`) | yes (`PreToolUse`) | graded (`PreToolUse`; shell reliable) | n/a |
| `verify-install` probes | `--profile openclaw` | `--profile cursor` | `--profile claude-code` | `--profile codex` | constitution + audit; probes graded |
| Graded guarantee | Full OpenClaw plugin path | Hooks deny when installed/trusted; operator can disable | Same; `--dangerously-skip-permissions` bypass | Shell reliable; apply_patch/MCP gaps possible | Caller wires `createEnforcementRuntime` |

Machine-readable matrix: `adapters/harness-capabilities.json`. Runbooks: `docs/runbooks/`.

### Prompt-layer skill

The skill is plain markdown with YAML frontmatter conforming to the AgentSkills spec. It works in any harness that consumes that spec. The skill's tooling scripts (`npm run verify/adopt/revoke/...`) and the aggregate gate (`npm run verify:all`) require Node `>=22.19` (source: root `package.json` `engines.node`, pinned via `.node-version`).

| Runtime | Tested | Notes |
|---------|--------|-------|
| OpenClaw `>=2026.1.x` | yes | Discovered via ClawHub or workspace install. `openclaw skills check freedom-preserving-protocol` should report `eligible: true`. |
| Claude Code | yes | Place under `.claude/skills/` or `~/.claude/skills/`. Adapter: `adapters/claude-code/`. |
| Cursor | yes | Place under `.cursor/skills/` or `~/.cursor/skills/`. Adapter: `adapters/cursor/`. |
| Codex | partial | Trigger phrases work; some runtimes don't yet consume `trigger:` in sub-skill frontmatter. Adapter: `adapters/codex/` (graded hook coverage). |
| Other AgentSkills-compliant | unknown | Should work; report back. |
| Node library consumer | yes | Import `@ovrsr/fpp-enforcement-core` / `@ovrsr/fpp-trust-core` without `openclaw` installed. |

#### Graded dispatcher on non-OpenClaw runtimes

On Claude Code, Cursor, and Codex, install the matching adapter under `adapters/` and wire the sample hooks config. Be explicit about graded guarantees:

- **Works:** native PreToolUse-style hooks drive enforcement-core dispositions (including unattended abstain/mandate paths); receipts under `~/.fpp/<profile>` (or `FPP_WORKSPACE`); `npm run verify-install -- --profile <harness>`.
- **Does not claim:** OpenClaw plugin parity, gateway-non-bypassable binding, or complete tool coverage on Codex (shell is the reliable path).
- **Shared fallback:** `@ovrsr/fpp-tool-proxy` for MCP/sidecar gateways when hooks are unavailable or incomplete.
- **Consequence:** without hooks/adapter installed, FPP at the tool boundary is prompt-layer only. Unknown `--profile` values warn and do **not** false-PASS dispatcher.

### Dispatcher-layer (OpenClaw plugin — first-class)

The OpenClaw plugins use the OpenClaw Plugin SDK and remain the richest dispatcher path (tool registration, approval UI, ClawHub distribution). Other harnesses use graded hook adapters — see the matrix above — not this OpenClaw-specific package.

| Component | Required version | Source |
|-----------|------------------|--------|
| OpenClaw Gateway | `>=2026.3.24-beta.2` | `plugin/package.json` → `openclaw.compat.minGatewayVersion` (same in `plugin-trust/package.json`) |
| Plugin API (`openclaw/plugin-sdk`) | `>=2026.3.24-beta.2` | `plugin/package.json` → `openclaw.compat.pluginApi` |
| Node.js (both plugins) | `>=22.19` | `plugin/package.json` and `plugin-trust/package.json` → `engines.node` |
| Node.js (skill scripts + `verify:all`) | `>=22.19` | root `package.json` → `engines.node`; `.node-version` |
| Package manager | `npm` or `pnpm`; `pnpm` required for in-repo bundled builds | repo build convention |

The plugin's `package.json` declares:

```json
"openclaw": {
  "extensions": ["./dist/index.js"],
  "compat": {
    "pluginApi": ">=2026.3.24-beta.2",
    "minGatewayVersion": "2026.3.24-beta.2"
  }
}
```

If your OpenClaw version is older than `2026.3.24-beta.2`, the plugin will refuse to load and you will see a `pluginApi` mismatch in `openclaw plugins inspect`. In that case, install only the prompt-layer skill.

## Install commands (canonical)

### Prompt-layer only

```bash
# From ClawHub (preferred)
openclaw skills install freedom-preserving-protocol

# Verify
openclaw skills check freedom-preserving-protocol
# Expected: eligible: true, modelVisible: true, commandVisible: true

# (optional) verify cryptographic provenance
cd ~/.openclaw/skills/freedom-preserving-protocol
npm install
npm run verify
# Expected: Constitution SHA-256: 71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993
#           Signature valid:      YES
```

### Dispatcher-layer (companion plugin)

```bash
openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin
openclaw plugins inspect openclaw-fpp-plugin --runtime --json
# Expected: status: "active", hooks: ["before_tool_call"]

openclaw plugins list | grep openclaw-fpp-plugin
# Expected: openclaw-fpp-plugin   active
```

The FPP plugin only registers `before_tool_call`, which is a pure tool-policy hook. It does *not* require `allowConversationAccess` — that flag is needed only for hooks that observe raw conversation content (`llm_input`, `llm_output`, `before_agent_run`, etc.). If you fork this plugin and add conversation-access hooks, you must set `plugins.entries.openclaw-fpp-plugin.hooks.allowConversationAccess: true` in your OpenClaw config.

### Verify both layers together

```bash
# OpenClaw profile (default) — probes OpenClaw plugins list when CLI is present
npm run verify-install -- --soul ~/.openclaw/agents/<agent>/SOUL.md \
                          --memory ~/.openclaw/agents/<agent>/MEMORY.md

# Generic / library profile — graded probes report unknown/inactive honestly
npm run verify-install -- --profile generic
# Optional: FPP_WORKSPACE=/path/to/workspace npm run verify-install -- --profile generic
```

`verify-install` runs pluggable `RuntimeProbe`s (`active` | `inactive` | `unknown`) per harness. The default probe is OpenClaw; inject others in-process via `runVerifyInstall({ probes })`. A `[WARN]` probe of `unknown` on `--profile generic` is informational — not an OpenClaw-only failure.

Expected (if both layers active):

```
Freedom Preserving Protocol — installation check

[PASS] Constitution hash
        71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993
[PASS] Ed25519 signature
        pubkey=fcd51dc17383f88ff8a8a86bdfba6ae5a9922c815760cb8666beaf5e8a3ef456
[PASS] SOUL adoption block
        "Freedom Preserving Protocol" found in ...
[PASS] MEMORY adoption entry
        "Freedom Preserving Protocol" found in ...
[PASS] Audit chain
        hash-chained log verifies (N entries)
[PASS] Dispatcher-layer plugin
        FPP plugin appears in `openclaw plugins list`

Prompt-layer governance:     ACTIVE
Dispatcher-layer governance: ACTIVE

Overall: PASS
```

Expected (if only prompt-layer, no adoption yet):

```
Freedom Preserving Protocol — installation check

[PASS] Constitution hash
        71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993
[PASS] Ed25519 signature
        pubkey=fcd51dc17383f88ff8a8a86bdfba6ae5a9922c815760cb8666beaf5e8a3ef456
[SKIP] SOUL adoption block
        no --soul path provided
[SKIP] MEMORY adoption entry
        no --memory path provided
[SKIP] Audit chain
        no audit log yet at .../.openclaw/workspace/constitution-audit.jsonl — first heartbeat will create it
[WARN] Dispatcher-layer plugin
        openclaw CLI not on PATH; cannot check plugin installation. The skill works without it but only at prompt-layer.

Prompt-layer governance:     not active
Dispatcher-layer governance: not active

Note: without the dispatcher-layer plugin, the five-question gate can be bypassed by prompt injection or a hostile skill. Install the plugin for `before_tool_call` enforcement:
  openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin

Overall: PASS
```

`[WARN]` for the dispatcher-layer check is **not** a failure; it is informational. The exit code is `0` as long as the required (signature + marker) checks pass.

## Configuration knobs

The plugin reads its configuration from your OpenClaw config:

```json
{
  "plugins": {
    "entries": {
      "openclaw-fpp-plugin": {
        "config": {
          "auditLogPath": ".openclaw/workspace/fpp-plugin-audit.jsonl",
          "dispositionMode": "operator-present",
          "standingAllowOn": [],
          "mandateStorePath": ".openclaw/workspace/fpp-mandates.json",
          "blockOn": ["fs.delete.protected", "exec.cred-exfil", "gateway.restart"],
          "approvalOn": ["fs.delete.workspace", "pkg.install", "http.public-write"],
          "approvalTimeoutMs": 60000,
          "approvalTimeoutBehavior": "deny"
        }
      },
      "openclaw-fpp-trust": {
        "config": {
          "auditLogPath": ".openclaw/workspace/constitution-audit.jsonl",
          "fallbackAuditLogPath": ".openclaw/workspace/fpp-plugin-audit.jsonl"
        }
      }
    }
  }
}
```

If you do not set these, sensible defaults apply (see `plugin/src/config.ts` and `plugin-trust/openclaw.plugin.json`). The trust plugin uses `fallbackAuditLogPath` when `constitution-audit.jsonl` has no entries yet, so handshakes can bootstrap from enforcement audit activity before the first heartbeat. Set `fallbackAuditLogPath` to `null` if you run trust without the enforcement plugin.

## Claim-format migration terminology

`@ovrsr/fpp-protocol-core` is the shared contract package. Published plugins pin an **exact** core version (no ranges) so protocol drift cannot happen silently. Local development uses npm workspaces; isolated plugin installs must resolve core with `--ignore-scripts` (OpenClaw install style).

Release order: build/test/pack protocol-core → enforcement-core → trust-core → skill → enforcement plugin → trust plugin. Rollback: restore the previous exact core version before rolling back dependent packages. See `docs/RELEASE_ASSURANCE.md`.

- **Legacy-v1 claim** — handshake claim format without `schemaVersion`: timestamped, optionally Ed25519-signed, no freshness nonce. Parsed as **declaration-only**; never silently escalated to v2 assurance. Under default `verificationPolicy: "hardened-v2"`, unsigned/legacy claims cannot establish trust.
- **v2 claim** — carries explicit `schemaVersion: 2`, key-bound agent ID (`fpp:ed25519:<fingerprint>`), claim class, and freshness envelope. Runtime-validated by `parseClaim`.
- **Migration window** — the period during which a verifier may accept both formats for inspection. Verifiers must report *which* format a peer presented rather than silently normalizing.
- **verificationPolicy** (trust plugin) — `hardened-v2` (default, signed fresh v2 required), `v2-with-legacy-declarations` (v1 inspectable, no trust elevation), or `legacy-unsafe` (visibly weaker; emits a warning). Existing installs that omit the field receive hardened-v2 on upgrade; set an explicit weaker policy only when migrating.

## Known limitations

1. **The risk classifier is heuristic.** It pattern-matches on tool names and parameter shapes. It can be evaded by an adversary who knows the patterns (e.g., a tool that decodes a base64 command at runtime). The dispatcher layer is a strong-but-not-unforgeable fence.
2. **The skill cannot survive `openclaw plugins disable`.** A user (or anyone with shell access) can disable the dispatcher hook at any time. This is by design — Law 2 (corrigibility) requires that the user retain ultimate authority.
3. **No cross-host enforcement.** If your OpenClaw agent invokes a sub-agent on a remote host, that sub-agent must independently install the framework. There is no transitive guarantee.
4. **Heartbeat skills are model-driven.** The constitution-audit heartbeat is a sub-skill the agent runs voluntarily. Until OpenClaw exposes a `cron`-style scheduler that can run the audit script unconditionally, the audit log's completeness depends on the agent's continued cooperation.
5. **Trust is local policy, not a global score.** Contextual trust assessments, due-process status, and steward overrides are host-local. Sensitivity share checks are **advisory** unless the host provides an interception hook. Sybil/collusion resistance is partial (source independence), not complete.

For the path to closing limitation #4 (Gateway-level enforcement of the heartbeat), see the AOS Phase 2 plan and the open Foundation RFC tracker.
