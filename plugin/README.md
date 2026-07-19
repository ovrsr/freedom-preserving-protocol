# `@ovrsr/openclaw-fpp-plugin`

The dispatcher-layer companion to the [`freedom-preserving-protocol`](../) skill.

This is an OpenClaw plugin (not a skill). It registers a real `before_tool_call` hook that can `block` clearly-violating tool calls and `requireApproval` for ambiguous ones — **outside** the agent's context window, at the runtime dispatcher boundary.

## When to install

Install this plugin if any of the following apply:

- You want enforcement that survives prompt injection of the agent.
- You're running an agent on a model whose five-question reasoning you don't fully trust.
- You're operating in a high-stakes context (production data, third-party messaging, money) and the parent skill's prompt-layer governance isn't enough.

Do *not* install this if your runtime is not OpenClaw — the plugin uses OpenClaw's plugin SDK and will not load in Claude Code / Cursor / Codex.

## Install

```bash
openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin
openclaw plugins inspect openclaw-fpp-plugin --runtime --json
openclaw plugins list | grep openclaw-fpp-plugin
```

Expected `inspect` output (abbreviated):

```json
{
  "id": "openclaw-fpp-plugin",
  "status": "active",
  "hooks": ["before_tool_call"],
  "activation": { "onStartup": true },
  "compat": { "pluginApi": ">=2026.3.28" }
}
```

## How it works

On every tool call your agent attempts, OpenClaw invokes this plugin's `before_tool_call` handler with the tool name, parameters, and context. The handler:

1. **Classifies** the call against a risk taxonomy (`plugin/src/risk-classifier.ts`). Examples:
   - `fs.delete.protected` — delete on `.ssh/`, `.aws/`, `.env`, etc.
   - `exec.cred-exfil` — outbound write that interpolates a credential env var.
   - `gateway.restart` — command that would stop the OpenClaw runtime itself.
   - `pkg.install` — package manager install (npm, pip, brew, …).
   - `http.public-write` — POST/PUT/PATCH/DELETE to a non-private URL.
   - `message.external` — outbound message to a third party.
   - many others; see the source for the full list.
2. **Decides** via `resolveDisposition` (`plugin/src/disposition-engine.ts`):
   - **Hard-floor** (`blockOn` or classifier `decision: "block"`) → `{ block: true }` (never silently downgraded).
   - **Live mandate / `standingAllowOn`** → allow + budget debit (standing allowlist is unsigned; never claimed as peer-signed).
   - **`dispositionMode: "operator-present"`** → `requireApproval` for `approvalOn` / strict-mode escalations (legacy UX).
   - **`dispositionMode: "unattended"`** → staged-allow (reversible), emergency allow-minimal, or **abstain** (`blockReason` prefixed `abstain:`) — never hangs on `requireApproval`.
   - New installs default to `unattended`. Existing configs missing `dispositionMode` migrate fail-safe to `operator-present` with a `DISPOSITION_MODE_MIGRATION` diagnostic.
3. **Audits** the decision to `.openclaw/workspace/fpp-plugin-audit.jsonl` as a hash-chained entry (same format as the skill's audit log; cross-verifiable with `npm run audit:verify` in the parent package).

**Audit-write failure behavior:** default `auditFailureBehavior: "fail-closed"` blocks high-risk calls when the audit log cannot be written. See `docs/TROUBLESHOOTING.md`.

**Approval timeout:** in operator-present mode, approvals wait `approvalTimeoutMs` (default 60000 ms) and then apply `approvalTimeoutBehavior` (default `deny`).

**Strict mode:** when `respectTrustStrictMode` is `true` (default), the hook reads the trust plugin's strict-mode state file (`strictModeStatePath`) on each call and escalates listed classifications to `requireApproval` for flagged sessions (operator-present) or still respects hard-floor / mandate paths (unattended).

## Configuration

Set these under `plugins.entries.openclaw-fpp-plugin.config` in your OpenClaw config:

```json
{
  "auditLogPath": ".openclaw/workspace/fpp-plugin-audit.jsonl",
  "dispositionMode": "unattended",
  "standingAllowOn": [],
  "mandateStorePath": ".openclaw/workspace/fpp-mandates.json",
  "mandateDefaultMaxActions": 10,
  "stagedUndoWindowMs": 60000,
  "blockOn": ["fs.delete.protected", "exec.cred-exfil", "gateway.restart"],
  "approvalOn": [
    "fs.delete.workspace",
    "fs.write.protected",
    "pkg.install",
    "pkg.publish",
    "http.public-write",
    "exec.outbound-write",
    "exec.system-modify",
    "gateway.config-change",
    "message.external",
    "unknown.unclassified"
  ],
  "approvalTimeoutMs": 60000,
  "approvalTimeoutBehavior": "deny",
  "constitutionHash": "71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993",
  "strictModeStatePath": ".openclaw/workspace/fpp-strict-sessions.json",
  "respectTrustStrictMode": true
}
```

All fields are optional; the values above are the runtime defaults from `src/config.ts` (`DEFAULT_CONFIG`). The defaults are designed to never block routine, low-risk work — only the genuinely irreversible-or-exfiltrative shapes.

> **Known drift:** the manifest (`openclaw.plugin.json`) declares a shorter
> `approvalOn` default (`fs.delete.workspace`, `pkg.install`,
> `http.public-write` — 3 entries) than `src/config.ts` (9 entries, above).
> The runtime merges your config against `src/config.ts`, so **the 9-entry set
> is what actually applies** when you set nothing. The manifest default is
> display metadata only; this drift is tracked for correction in a future
> release.

To tune, edit your OpenClaw config and restart the gateway (`openclaw gateway restart`). **Manifest schema changes (`openclaw.plugin.json`) require a full process restart** — hot reload does not refresh the cached config schema. Prefer restart over reload after adding fields such as `outOfWorkspacePaths`.

### Out-of-workspace exact path map

OpenClaw's `workspaceRoot` for FPP is `~/.openclaw/workspace`. A top-level harness file such as `~/.openclaw/openclaw.json` is outside that root. To authorize `apply_patch` against such a file, map the absolute path to a resource alias used in the signed grant:

```json
{
  "plugins": {
    "entries": {
      "openclaw-fpp-plugin": {
        "config": {
          "outOfWorkspacePaths": {
            "<absolute-path-to-openclaw-json>": "harness/openclaw.json"
          }
        }
      }
    }
  }
}
```

Use the host's real absolute path for the key. Only exact file entries are accepted — not parent-path matching or wildcards. See `docs/architecture/steward-operator-authorization.md`.

`apply_patch` path extraction accepts structured `params.changes[]` (authoritative when present), plus flat V4A text under `patch|input|diff|content|text|command` (live Codex traffic uses `command`).

## Build from source

```bash
cd plugin/
npm install
npm run build         # tsc -> ./dist/
npm test              # runs the classifier test suite (Node test runner)
```

The published artifact ships pre-built `dist/`. Source is included in the npm tarball so you can audit before installing.

## Limitations (read this)

0. **Unknown tools require approval by default.** Unclassified tool names escalate to `requireApproval` unless listed in `knownCustomTools` (default empty — operator extras only). Curated OpenClaw internals use named classes: `internal.heartbeat` (`heartbeat_respond` / `openclawheartbeat_respond`), `internal.read` (e.g. `memory_search`, `sessions_list`), `gateway.inspect` (inspect/status-shaped `openclawgateway`), and `fpp.governance` (`/^fpp_/` / `openclawfpp_*`). Neither is behavioral compliance evidence — only configuration/event evidence. Do not describe this plugin as gating "all" tool calls with equal strength — coverage is still heuristic.
1. **Heuristic classification can be evaded.** The classifier pattern-matches on tool name and parameter shape. A determined adversary can route through a tool name that doesn't match, or encode payloads (base64, nested templates) that the regex doesn't see. This is a strong-but-not-unforgeable fence, not an oracle.
2. **A malicious operator can disable it.** The plugin honors `openclaw plugins disable openclaw-fpp-plugin` (as it must, per Law 2). If your threat model includes a hostile operator on the same machine, this plugin is not sufficient.
3. **Audit log integrity depends on filesystem permissions.** The hash chain makes tampering *detectable* but not *preventable*. For tamper-evident archival, pipe the audit log to an append-only external store.
4. **No cross-agent enforcement.** Sub-agents spawned via `sessions_spawn` inherit your config only if they share the same gateway. Sub-agents on remote hosts must install their own copy.
5. **The classifier ships with English-language patterns.** Shell commands with non-Latin encoding (e.g., a path with unicode lookalike characters) may evade the protected-path check. The plugin is best-effort, not adversarial-strength, for these edge cases.
6. **Never add top-level `await` to the plugin entry.** The OpenClaw gateway loader can reject the module and leave `before_tool_call` unregistered, creating a total enforcement bypass until fixed and restarted.
7. **`packageBuildHash` is metadata-derived.** Receipt fields identify package name/version/API vectors, not a digest of `action-descriptor.js`. Confirm release provenance by inspecting the packed nested `@ovrsr/fpp-enforcement-core` artifact.

## Relationship to the parent skill

The parent skill (`freedom-preserving-protocol`) does three things this plugin doesn't:

1. Walks the agent through voluntary adoption (consent, SOUL.md, MEMORY.md).
2. Provides the *reasoning* framework — the five-question test that the model runs in-context for nuanced cases the classifier doesn't catch.
3. Provides the heartbeat audit and revocation tooling.

This plugin provides two things the skill doesn't:

1. Dispatcher-level enforcement that survives prompt injection.
2. A deterministic audit of every gated tool call (not just summary statistics).

Use them together for defense in depth. Each layer's weakness is the other's strength.

## License

Humanitarian Use License v1.0. See [LICENSE](LICENSE).
