# Troubleshooting

This document collects failure modes observed by the first agents to install Freedom Preserving Protocol. If your installation behaves differently than `npm run verify-install` reports, check here first.

## Cross-harness runbooks

| Harness | Runbook | verify-install profile |
|---------|---------|------------------------|
| OpenClaw | (this doc + `docs/COMPATIBILITY.md`) | `--profile openclaw` |
| Cursor | [`docs/runbooks/cursor.md`](runbooks/cursor.md) | `--profile cursor` |
| Claude Code | [`docs/runbooks/claude-code.md`](runbooks/claude-code.md) | `--profile claude-code` |
| Codex | [`docs/runbooks/codex.md`](runbooks/codex.md) | `--profile codex` |

Capability matrix: [`adapters/harness-capabilities.json`](../adapters/harness-capabilities.json). Compatibility: [`docs/COMPATIBILITY.md`](COMPATIBILITY.md).

## 0a. "`npm run verify` / `verify-install` fails with Cannot find module `@noble/ed25519`"

**Cause:** The ClawHub skill declares `@noble/ed25519` and `@noble/hashes` in `package.json`, but OpenClaw skill installs often leave the skill tree **without** `node_modules`. Verify scripts import those packages directly.

**Fix (host):** From the skill install directory:

```bash
npm install
npm run verify
npm run verify-install
```

**Detect early:** `npx tsx scripts/skill-self-check.ts` (or `npm run self-test` in the skill root) fails the `deps.noble` check with an actionable `npm install` message when `@noble/*` is not resolvable.

**Maintainers:** `scripts/stage-skill.ts --install-deps` (used by `clawhub-publish.sh`) installs runtime deps into `skill-dist/` before self-check so staging does not silently ship an unverifiable tree.

## 0a2. "Trust falls back to enforcement audit / no constitution-audit.jsonl"

**Cause:** Primary `constitution-audit.jsonl` is normally created by the model heartbeat skill. If the heartbeat never ran, trust prefers the enforcement fallback log.

**Fix (non-model):** After adoption:

```bash
npm run audit:bootstrap -- --soul ~/.openclaw/agents/<agent>/SOUL.md
npm run audit:verify
```

Refuses when never adopted or when `.fpp-revoked` is present. Use `--if-missing` for create-once. See `hooks/constitution-audit/SKILL.md`.

## 0a3. "No `fpp-trust-graph.json` / replay / strict / quorum files on disk"

**Investigation (Axiom hosts):**

1. **Relative manifest defaults + CWD** — Older trust/enforcement merges kept relative paths like `.openclaw/workspace/fpp-trust-graph.json` as-is. If the gateway process CWD was not `$HOME`, files could land under `<cwd>/.openclaw/workspace/...` (or nowhere useful). **Fix:** `mergeTrustConfig` / `mergeConfig` now call `absolutizeWorkspacePath` from `@ovrsr/fpp-protocol-core` so relative paths resolve under `$FPP_WORKSPACE` or `<homedir>/.openclaw/workspace`.
2. **Empty graph = no file (expected)** — `plugin-trust` only persists on `trustGraph.setOnChange` (debounced save after the first mutation, e.g. successful handshake verify). An empty in-memory graph does **not** write a marker file. Missing `fpp-trust-graph.json` before any peer verify is **not** corruption.
3. **Where to look after a successful handshake** — `$FPP_WORKSPACE/fpp-trust-graph.json` when set, else `~/.openclaw/workspace/fpp-trust-graph.json` (absolutized). Same root for `fpp-replay-cache.json`, `fpp-strict-sessions.json`, `fpp-quorum-sessions.json`.

**Operator check:**

```bash
# Expected absolute location (example)
ls -la "${FPP_WORKSPACE:-$HOME/.openclaw/workspace}"/fpp-trust-graph.json
# Also search accidental CWD-relative leftovers from older builds:
find "$HOME" -name 'fpp-trust-graph.json' 2>/dev/null | head
```

## 0b. "ClawHub skill install looks like the whole monorepo / includes adapters"

**Cause:** Older skill publishes uploaded the repo root (`clawhub skill publish .`), so installs could contain adapters, maintainer scripts, and docs that are not OpenClaw skill surface.

**Fix:**
1. Reinstall the skill from ClawHub after a slim release (`npm run publish:skill` stages `skill-dist/` via `scripts/stage-skill.ts`).
2. Confirm the install has `SKILL.md` + `scripts/skill-lib/` and **does not** contain `adapters/`, `plugin/`, or `packages/`.
3. For Cursor / Claude Code / Codex hooks, clone the [GitHub repo](https://github.com/ovrsr/freedom-preserving-protocol) — adapters are not shipped on ClawHub.

## 0c. Security scanner false positives (accepted)

SkillSpector / static scanners may flag:

| Signal | Why accepted |
|--------|----------------|
| `child_process` in `scripts/*.test.ts` | Test harness only; not in ClawHub skill stage |
| "exposed secret" in old `docs/plans/*` | Plan prose / field names — not credentials |
| Fixture URLs / IPs in `test/fixtures/*` | Classifier corpus; not install sources |
| `--skip-tests` | Dual-gated (`FPP_ALLOW_SKIP_TESTS=1`); maintainer escape hatch |

VirusTotal historically reports the skill clean; treat capability findings as packaging/disclosure issues (remediated by OpenClaw-only staging).

## 0d. Local rebuild provenance (intentional version drift — Q7-B)

**Policy:** This remediation ships **local** plugin/skill rebuilds. ClawHub registry republish is **out of scope**. Runtime versions (e.g. enforcement `1.1.15`, trust `1.2.10`) may be ahead of install-metadata / ClawHub (historically `1.1.4` / `1.2.1`). `plugin.version-drift` WARN is **expected** until a deliberate republish.

**Record provenance on the host:**

```bash
cd /path/to/freedom-preserving-protocol
git rev-parse HEAD
git log -1 --format='%ci %s'
# After local pack/install:
npm pack -w @ovrsr/openclaw-fpp-plugin --dry-run
npm pack -w @ovrsr/openclaw-fpp-trust --dry-run
```

Keep the git SHA + build time with the host's install notes. Do **not** treat drift alone as compromise.

## 0e. `openclaw fpp-trust` unregistered / Codex plugin registration errors (diagnose only — Q8-C)

**Not fixed in this plan.** Findings only.

### `openclaw fpp-trust …` unregistered

**Code path:** `plugin-trust/src/index.ts` calls `api.registerCli(..., { descriptors: FPP_TRUST_CLI_DESCRIPTORS })` where descriptors name is `fpp-trust` (`plugin-trust/src/cli.ts`). Registration runs inside the OpenClaw **plugin host** during gateway/plugin load — not as a standalone CLI package.

**Likely causes (Axiom-class):**

1. **Gateway vs CLI process split** — `openclaw` CLI may not load the same plugin set as the gateway. If trust plugin is enabled only for the gateway agent, the CLI process never executes `registerCli`.
2. **Plugin not installed / degraded** — `openclaw plugins list` missing `openclaw-fpp-trust`, or status `degraded` before CLI registration.
3. **Old plugin build** — host running a pack that predates CLI registration.
4. **Descriptor mismatch** — OpenClaw expects descriptors at register time; if the host ignores `hasSubcommands`, subcommands appear missing.

**Follow-up fix options (future plan):** document CLI load path in OpenClaw; add a smoke check in `verify-install`; or ship a thin `fpp-trust` bin that does not depend on gateway registration.

### Codex adapter / plugin registration errors

**Reported by Axiom** (not always reproducible in this monorepo CI): Codex plugin registration failures typically mean (a) `~/.codex/hooks.json` points at a missing `adapters/codex` path, (b) Node engine `<22.19` without `--ignore-engines`, or (c) bundled `@ovrsr/fpp-*-core` missing from an incomplete pack. The Codex adapter is **not** an OpenClaw `registerCli` surface — it uses PreToolUse hooks (`adapters/codex`). Treat Codex errors separately from `fpp-trust` CLI gaps.

## 0. "`npm` / OpenClaw install fails with missing `@ovrsr/fpp-*-core`"

**Cause:** Older ClawHub plugin versions listed `@ovrsr/fpp-protocol-core`, `@ovrsr/fpp-enforcement-core`, and/or `@ovrsr/fpp-trust-core` as normal dependencies, but those packages are **not** on the public npm registry. OpenClaw's managed install (`npm install --omit=dev --omit=peer --legacy-peer-deps --ignore-scripts`) cannot fetch them.

**Fix:**
1. Upgrade to a plugin version that embeds cores via `bundledDependencies` (enforcement `>=1.1.6`, trust `>=1.2.4`), or rebuild from this repo and install a local tarball:
   ```bash
   cd plugin && npm pack   # runs prepack → bundle:deps
   openclaw plugins install npm-pack:./ovrsr-openclaw-fpp-plugin-*.tgz
   ```
2. For a broken install already on disk: uninstall the plugin, then install the new ClawHub version (or local pack).
3. Maintainers: never publish a plugin that lists `@ovrsr/fpp-*-core` in `dependencies` unless those names are also in `bundledDependencies` and present under `node_modules/@ovrsr/` in the tarball (`bash scripts/verify-pack.sh`, `bash scripts/smoke-plugin-install.sh`).

## 1. "I installed the skill but `openclaw hooks list` shows nothing"

**Expected.** The main skill (`freedom-preserving-protocol`) is a *prompt-layer* artifact. It is read by the model at prompt-build time. It is **not** a registered dispatcher hook and will not show up in `openclaw hooks list` or `openclaw plugins list`.

What *should* show up:

```bash
openclaw skills check freedom-preserving-protocol
# eligible: true, modelVisible: true, commandVisible: true
```

If you want dispatcher-level enforcement (a real `before_tool_call` hook), install the companion plugin:

```bash
openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin
openclaw plugins list | grep openclaw-fpp-plugin
```

## 2. "`openclaw plugins install` says `handler.ts/handler.js/index.ts/index.js missing`"

You probably tried to install the *skill* as a plugin. Skills and plugins are different artifacts with different file layouts:

- **Skill** layout: `SKILL.md` + assets. Installed with `openclaw skills install`.
- **Plugin** layout: `package.json` (with `openclaw` metadata block) + `openclaw.plugin.json` manifest + a built entry file referenced from `openclaw.extensions`. Installed with `openclaw plugins install`.

Use the correct command for the artifact:

```bash
# Skill:
openclaw skills install freedom-preserving-protocol

# Plugin (separate package):
openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin
```

## 3. "I accidentally created `~/.openclaw/extensions/SKILL.md` while trying to install"

You tried `openclaw plugins install <skill-path>` and OpenClaw started creating an extension package layout from your skill files. Quarantine it:

```bash
mkdir -p ~/.openclaw/quarantine
mv ~/.openclaw/extensions/SKILL.md ~/.openclaw/quarantine/SKILL.md.$(date +%Y%m%dT%H%M%SZ)

# Also remove any partial extensions/<id>/ directory that mirrors the skill
ls ~/.openclaw/extensions/
# rm -rf ~/.openclaw/extensions/<id>   # only if you're sure

# Verify nothing FPP-related remains as a "plugin"
openclaw plugins list | grep -i freedom-preserving
openclaw plugins list | grep -i fpp
```

Then install the skill via the correct command (see #2). The companion plugin is a *separate* publish; install it independently.

## 4. "Signature does not verify"

```bash
npm run verify
# Signature valid: NO
```

Do **not** adopt this constitution. Possible causes:

- The `constitution.json` was modified after signing. Recompute the hash and compare with the expected `71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993`.
- The package was tampered with in transit (ClawHub or registry compromise). Re-download from the upstream source.
- The `pubkey.ed25519.txt` was swapped. Compare against the publisher's published key.

If you cannot determine the cause within a few minutes: quarantine the package, log a `tamper_detected` audit entry (see `scripts/audit-append.ts --kind tamper_detected`), and notify your user.

## 5. "Audit chain verification fails"

```bash
npm run audit:verify
# Chain integrity: FAILED
#   - line 3: previousHash mismatch (...)
```

This means the audit log has been edited, truncated, or extended by something that did not use `audit-append.ts`. **Do not** try to "fix" it by editing the JSONL by hand — that just compounds the loss of evidence.

The enforcement plugin (`@ovrsr/openclaw-fpp-plugin`) treats a malformed audit tail as **corruption**, not as an empty chain. Appends throw `AuditCorruptionError` instead of restarting from `previousHash: 0000...`. With the default `auditFailureBehavior: "fail-closed"`, high-risk and approval-gated tool calls are blocked until the log is recovered. If you see `FPP AUDIT-GAP:` in gateway logs, a post-approval outcome could not be recorded, a receipt correlation failed (missing `toolCallId`, overflow, orphan after restart), or the typed receipt ledger could not be written — preserve the existing files and follow recovery below. Verify receipts with `npm run receipt:verify`.

Recommended response:

1. Copy the broken log aside as `constitution-audit.jsonl.tampered.<timestamp>` (or `fpp-plugin-audit.jsonl.corrupt.<timestamp>` for the enforcement log). **Do not delete or overwrite the original** — it is evidence.
2. Point `auditLogPath` (or the skill audit path) at a *new* empty file. Append a fresh `tamper_detected` entry there. The new chain starts from `previousHash: 0000...` only on the new file.
3. Notify your user with the line number of the first mismatch.
4. If you have access to a backup of the log (e.g., from a heartbeat snapshot), restore from that and re-verify.
5. Never hand-edit the live corrupted file to "make appends work again."

## 6. "Adoption block missing from my SOUL.md but I'm sure I adopted"

```bash
npm run verify-install -- --soul /path/to/SOUL.md
# [FAIL] SOUL adoption block
#         marker "Freedom Preserving Protocol" not found in ...
```

Possible causes:

- You ran `safe-append.ts` with a different `--soul` path. Search for the marker:
  ```bash
  grep -r "Freedom Preserving Protocol" ~/.openclaw/agents/
  ```
- A `safe-append.ts` backup (`SOUL.md.<timestamp>.bak`) still exists from a previous attempt; the live file was reset. Restore from the latest backup.
- A skill or user edit removed the block. Re-run `npm run adopt` — it is idempotent and will append cleanly if the marker is absent.

## 7. "MEMORY.md overwrite — I lost data"

If you (or an earlier version of this skill, before v1.1.0) hand-edited `MEMORY.md` and clobbered existing content, check for:

- `MEMORY.md.<timestamp>.bak` files alongside your MEMORY.md (created by `safe-append.ts` v1.1.0+ on every write).
- Your runtime's own memory backups (e.g., OpenClaw workspace history).
- The audit log's `constitutionHash` field, which lets you correlate which adoption corresponds to which agent state.

If you find an older MEMORY.md you want to restore, you can do so safely — `safe-append.ts` is idempotent, so re-running adoption against the restored file will only re-append the block if it is missing.

## 8. "Plugin loads but `openclaw plugins inspect` shows `status: degraded`"

The plugin is running but a runtime check failed. Common causes:

- `auditLogPath` directory is not writable. Create it under the live OpenClaw workspace (default `<homedir>/.openclaw/workspace`, or `$FPP_WORKSPACE`): `mkdir -p "$HOME/.openclaw/workspace" && touch "$HOME/.openclaw/workspace/fpp-plugin-audit.jsonl"`. Relative `.openclaw/workspace` paths in config are absolutized — do not rely on skill CWD.
- Runtime vs install metadata version drift: `verify-install` emits `[WARN] plugin.version-drift` when both versions are inspectable and differ. This is install/config skew, not automatic compromise — reinstall or align versions deliberately. See **§0d Local rebuild provenance** when the drift is intentional (local build ahead of ClawHub).
- The plugin's manifest declares hooks the runtime version doesn't support. Compare `openclaw --version` with the `pluginApi` field in `plugin/package.json`'s `openclaw.compat`. If your runtime is older, you must either upgrade OpenClaw or pin the plugin to an older version.
- `allowConversationAccess` is required for a hook you don't actually use. The default plugin only registers `before_tool_call`, which does NOT require `allowConversationAccess`. If you've forked the plugin to add `llm_input` or `llm_output` hooks, you'll need to set `plugins.entries.openclaw-fpp-plugin.hooks.allowConversationAccess: true` in your OpenClaw config.

## 9. "I want to revoke but the plugin keeps blocking my disable command"

The plugin does NOT block its own disable command. If `openclaw plugins disable openclaw-fpp-plugin` is failing, you are hitting something else — likely an exec approval prompt configured elsewhere. Bypass it via the operator console:

```bash
openclaw operator disable-plugin openclaw-fpp-plugin
```

(Exact subcommand may vary by OpenClaw version; see `openclaw --help`.)

If you cannot disable it at all, you have hit a Law 2 (corrigibility) violation — the framework has been weaponized against its own correctability. File a bug at the upstream repo immediately.

## 10. "The five-question test feels noisy / I'm getting approval requests on every benign tool call"

The dispatcher plugin's risk classifier ships with conservative defaults. If you're getting too many `requireApproval` prompts for actions you consider routine, tune `approvalOn` and `blockOn` in your OpenClaw config:

```json
{
  "plugins": {
    "entries": {
      "openclaw-fpp-plugin": {
        "config": {
          "approvalOn": ["fs.delete.protected", "exec.cred-exfil", "gateway.restart"],
          "blockOn": ["exec.cred-exfil"]
        }
      }
    }
  }
}
```

Restart the gateway for changes to take effect. Be wary of tuning so aggressively that the framework no longer protects you — every removal from `approvalOn` is a deliberate Law 1 trade-off.

For **headless / unattended** agents, set `dispositionMode: "unattended"` (new-install default). Uncertainty then **abstains** instead of opening `requireApproval`. Cover routine classes with `standingAllowOn` or signed mandates at `mandateStorePath` — do not put hard-floor (`blockOn`) classes on the standing allowlist without `acknowledgeDangerousOverrides: true`.

**Startup warn `UNATTENDED_APPROVAL_WITHOUT_STANDING_ALLOW`:** emitted when `dispositionMode=unattended` and one or more `approvalOn` classes are absent from `standingAllowOn`. This is **config-shape only** — it does **not** read `fpp-mandates.json` or live `fpp_mandate_*` coverage. After a housekeeping reinstall that restores bare defaults (`standingAllowOn: []`), this warn is expected until you re-add standing-allow or issue mandates.

### Emergency override (steward-signed, submit-only)

When staged/mandate paths cannot cover an action, a **steward** may sign a `SignedEmergencyOverrideV1` out-of-band and submit it via the trust plugin:

```text
steward signs SignedEmergencyOverrideV1
  → agent: fpp_emergency_override_submit(signedJson)   # never signs
  → store: fpp-emergency-overrides.json (sibling of mandate store)
  → onBeforeToolCall: allow_minimal + debit + mandatory_review_pending
```

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Abstain: `emergency override rejected (expired)` | Override outside `validFrom`/`validTo` | Re-issue with a live window |
| Abstain: `emergency override rejected (agent-self-key)` | Signed with the local agent identity key | Stewards only — never use the agent key; peers are excluded by design for v1 |
| Abstain: `emergency override rejected (issuer-not-steward)` | `issuerId` not in `quorumStewardEligibleIds` | Add the steward to the allowlist (trust plugin config) |
| Abstain: `emergency override rejected (budget-exhausted)` | Ledger remainingActions is 0 | Re-issue with a fresh budget |
| Hard-block despite valid override | Classification is on `blockOn` / classifier hard-block | Hard-floor always wins — emergency cannot override it |

### Config drift after reinstall (empty quorum / unattended)

A housekeeping reinstall can silently restore bare defaults (`dispositionMode: "unattended"`, empty `quorumStewardEligibleIds` / `quorumPeerEligibleIds`, threshold 2). Look for:

| Warn code | Meaning |
|-----------|---------|
| `UNATTENDED_APPROVAL_WITHOUT_STANDING_ALLOW` | Unattended + approvalOn not covered by standingAllowOn (mandates not probed) |
| `QUORUM_STEWARD_UNREACHABLE` / `QUORUM_PEER_UNREACHABLE` | Eligible voter list is empty |
| `QUORUM_*_THRESHOLD_EXCEEDS_ELIGIBLE` | Threshold > eligible count — quorum cannot form |

Quorum unreachable warns are trust-local and **not** gated on enforcement `dispositionMode`.

### ClawHub `suspicious.exposed_secret_literal` on `authorization: "standing-allowlist"`

**Resolved false positive.** Scanners treat `authorization: "<string>"` as an API-token pattern. Those values are `AuthorizationClass` wire enums (mandate / standing-allowlist / emergency / …), not credentials. Production sources use named `AUTHZ` constants from `@ovrsr/fpp-protocol-core` (property shorthand) so the adjacent literal pattern is gone; on-wire values are unchanged.

### OpenClaw floor `>=2026.3.28`

Both plugins require OpenClaw `>=2026.3.28` (`minGatewayVersion` / `peerDependencies.openclaw`). Builds in `<=2026.3.24` (including `2026.3.24-beta.2`) are GHSA-affected and intentionally rejected. See `docs/COMPATIBILITY.md`.

**Introspection under unattended:** Named low-risk classes allow with audit (not opaque `unknown.unclassified`):

| Live / normalized name | Classification | Decision |
|---|---|---|
| `heartbeat_respond`, `openclawheartbeat_respond` | `internal.heartbeat` | allow |
| `memory_search`, `get_goal`, `update_plan`, `read_mcp_resource`, `sessions_list`, `wiki_apply`, `subagents` (+ `openclaw*` / `openclaw.*` forms) | `internal.read` | allow |
| `gateway` / `openclawgateway` with inspect/status/get/list action | `gateway.inspect` | allow |
| `gateway` / `openclawgateway` with restart/stop/kill | `gateway.restart` | block |
| `gateway` / `openclawgateway` with config/plugins-install shape | `gateway.config-change` | approval |
| `/^fpp_/` and `openclawfpp_*` (e.g. `fpp_trust_status`, `openclawfpp_mandate_propose`) | `fpp.governance` | allow |
| Operator extras in `knownCustomTools` | `unknown.unclassified` | allow (escape hatch only) |
| Random unknown tools | `unknown.unclassified` | abstain (unattended) / approval (operator-present) |

Default `knownCustomTools` is **empty** — curated OpenClaw internals use the named classes above, not the opaque seed. Allowing these tools is **not** behavioral compliance.

If trust/status tools still abstain as `unknown.unclassified`, inspect `fpp-plugin-audit.jsonl` for the live `toolName` and confirm it matches a documented form (`fpp_*`, `openclawfpp_*`, or a curated `internal.*` name).

**`exec.benign` staging:** Benign shell inspection (`exec.benign`) is classifier-allow → direct `allow`. It no longer writes `fpp-staged-actions.jsonl` rows (not reversible for undo-window staging). High-risk exec classes and reversible workspace writes are unchanged.

### Quorum mandates (peer / steward) — not ratification

When no human is present, peers or stewards can open a quorum proposal via the trust plugin (`fpp_mandate_propose` → `fpp_mandate_second` → `fpp_mandate_finalize`). Finalize writes a signed `StandingMandateV1` into the **same** `mandateStorePath` the enforcement plugin reads. Quorum does **not** call `allow` directly and is **not** constitutional ratification.

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Finalize fails with threshold error | Too few aye ballots vs `quorumPeerThreshold` / `quorumStewardThreshold` | Add eligible voters or lower local threshold (operator policy) |
| Ballot rejected (revoked / ineligible) | Voter not in `quorumPeerEligibleIds` / `quorumStewardEligibleIds`, or key revoked | Update eligible IDs; rotate/recover keys via key-lifecycle |
| Finalize rejects consent scopes | Proposal classifications include `affected-party-consent` / `data-subject-consent` | Quorum cannot mint nonparticipant consent — obtain a real consent artifact or use emergency/staged paths |
| Unattended still abstains after finalize | Mandate store path mismatch, expired mandate, budget exhausted, or signature/ledger integrity failure | Align trust `mandateStorePath` with enforcement plugin; check `quorum-status` / ledger remaining; see budget-signature section below |
| Open proposal fails finalize after upgrade | Proposal `mandateDigest` was computed with old rules (included `remainingActions`) | Re-propose the session after upgrading cores/plugins; in-flight proposals under the old digest will not match |

Inspect with `openclaw fpp-trust quorum-status`. Revoke with `openclaw fpp-trust quorum-revoke-mandate <id> --reason "..."`. Keep `steward-override` separate — it records scoped trust assessments and does not mint peer-signed mandates.

### Mandate budget ledger vs signature (Issue #5)

**Symptom:** Unattended allows a tool call under a budgeted mandate, then the **same** mandate abstains on the next call. Audit may show two entries for related `toolCallId`s — first `allowed`, then abstain with “no mandate”.

**Cause (fixed in protocol/enforcement/trust cores ≥1.0.1 + enforcement plugin ≥1.1.10):** Older stores kept `budgets.remainingActions` (and revoke) inside the Ed25519-signed grant. The first `debit()` mutated the signed blob and invalidated the signature; `findCoverage` then skipped the mandate as if it were absent.

**Current behavior:**

- Signed grant omits mutable fields (`remainingActions`, `revoked`).
- Runtime budget/revoke live in the unsigned `ledgers` map in `fpp-mandates.json` (keyed by `mandateId`).
- Legacy undebited signatures still verify (dual-verify). Already-debited broken files with `maxActions` set **auto-migrate** on reload: restore signed `remainingActions` to `maxActions`, seed ledger from the prior decremented value, and emit `FPP AUDIT-GAP` plus an audit entry with classification `fpp.mandate.integrity`.
- Mandates without `maxActions` that are already broken cannot auto-migrate — **re-issue** the mandate.
- Revoke sets `ledgers[id].revoked = true` and does not rewrite the signed blob.

## 11. "Plugin approval required (gateway unavailable)" on every gated tool call

**Symptom:** Agent tool calls that require approval (e.g., `npm install`, `curl -d`, `openclaw plugins install`) fail with:

```
gateway/ws ⇄ res ✗ plugin.approval.request
  errorCode=INVALID_REQUEST
  errorMessage=invalid plugin.approval.request params: at /description: must NOT have more than 256 characters
```

The runtime then reports `"Plugin approval required (gateway unavailable)"` — this is misleading; the gateway is reachable but the approval payload was rejected by schema validation.

**Root cause (fixed in v1.1.3+):** Earlier versions of `buildDescription()` produced descriptions exceeding 256 characters, which the OpenClaw gateway rejects at validation time. The approval prompt never reaches the operator, creating a hard block with no escape path.

**If you are running plugin version <1.1.3**, upgrade:

```bash
# Disable the plugin first (operator bypass — the plugin cannot block this)
openclaw operator disable-plugin openclaw-fpp-plugin

# Upgrade
openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin

# Re-enable
openclaw operator enable-plugin openclaw-fpp-plugin

# Verify approval flow works
openclaw plugins inspect openclaw-fpp-plugin --runtime
```

If `openclaw operator disable-plugin` is not available on your version, use:

```bash
openclaw plugins disable openclaw-fpp-plugin
```

**Self-update deadlock:** Because FPP classifies `openclaw plugins install` as `gateway.config-change` (requiring approval), and the approval path itself is broken, the plugin blocks its own update. The operator disable/enable workflow above is the documented recovery path.

**Post-upgrade verification:**

1. Trigger a gated action (e.g., `npm install some-test-pkg`).
2. Confirm the `/approve <id> allow-once` or `/approve <id> deny` command appears in the operator console.
3. Run `npm run self-test` to confirm all 7+ assertions pass.

## 12. "INVALID_REQUEST on /description" in gateway logs

Same root cause as #11. The approval description field exceeded the gateway's 256-character limit. Upgrade the plugin to v1.1.3+ where `buildDescription()` enforces truncation.

If you see this in audit logs as `approval_requested` entries with no corresponding steward resolution, those represent the corrigibility gap — approvals were attempted but never reached the operator. After upgrading, these orphaned entries are safe to ignore (they document the failure, not a successful bypass).

## 13. "Handshake reports trust but the peer's claim was never signed"

Under the default `verificationPolicy=hardened-v2`, unsigned claims are
**rejected**. If you still see unsigned claims accepted, check whether the
install is on `legacy-unsafe` (requires `acknowledgeDangerousOverrides: true`)
or an older plugin version.

```bash
# Inspect what the peer actually presented
openclaw fpp-trust verify claim.json
# Look for the signature field: absent/empty means configuration claim only, no signature verification
```

Prefer `hardened-v2`. During migration, `v2-with-legacy-declarations` keeps v1
claims inspectable as declaration-only without trust elevation. Existing
trust-graph entries formed under weaker policies are **not** retroactively
invalidated — re-run handshakes with hardened settings if that matters to you.

## 14. "A peer presented an old claim / I suspect replay"

Under the default `verificationPolicy=hardened-v2`, handshakes require a
peer-supplied challenge with audience, issue time, expiry, and a one-time
replay key. Stale (e.g. 2020), future, wrong-audience, and replayed claims
are rejected. Diagnose:

```bash
# Inspect the claim's freshness block in the exchanged JSON
# (audience, challenge, issuedAt, expiresAt)

# Confirm policy is not legacy-unsafe
# plugins.entries.openclaw-fpp-trust.config.verificationPolicy
```

If you are on an older install still using `legacy-unsafe`, migrate to
`hardened-v2` (or `v2-with-legacy-declarations` during transition). Enabling
`legacy-unsafe` requires `acknowledgeDangerousOverrides: true`.

Do not delete the peer's entry from the trust graph as a "fix" — record your
assessment and move on. Removing entries erases the evidence trail of how the
trust was formed.

## 15. "Strict mode is not escalating tool calls" / strict-state parse failure

The enforcement plugin reads `strictModeStatePath` (default
`.openclaw/workspace/fpp-strict-sessions.json`) on each gated call.

- **Missing file:** no strict overrides (normal when no handshake failure has
  entered strict mode).
- **Malformed JSON / invalid schema:** the plugin applies a **conservative
  approval fallback** (does not silently disable protection) and emits
  `FPP STRICT_MODE_MALFORMED` / `FPP STRICT_MODE_SCHEMA_INVALID` diagnostics
  without logging session keys. The corrupt file is left in place as evidence.

Diagnose:

```bash
# Is the file valid JSON with version 1?
cat .openclaw/workspace/fpp-strict-sessions.json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('version', d.version, 'sessions', Object.keys(d.sessions||{}).length)"

# What does the trust plugin think?
openclaw fpp-trust strict list
```

Also check `respectTrustStrictMode` has not been set to `false` in the
enforcement plugin config, and that the session entry has not expired
(`expiresAt`).

**Recovery:** if the file is corrupt, copy it aside
(`fpp-strict-sessions.json.corrupt.<timestamp>`) before recreating it via
`openclaw fpp-trust strict` commands. Do not just delete it — the corrupt
file is evidence of what went wrong.

## 16. "Trust plugin fails to start after an unclean shutdown"

If the persisted trust graph (`fpp-trust-graph.json`) is malformed or a **v2 snapshot fails signature/root verification**, the trust plugin **fails at startup rather than silently discarding trust state** — this is intentional. Copy the malformed file aside (`fpp-trust-graph.json.corrupt.<timestamp>`), keep any `.events.jsonl` and `.v1.bak` siblings, then either restore from backup or start fresh. For legacy v1 files, use an explicit migration path rather than hand-editing. Bootstrap peers with `openclaw fpp-trust steward-override ...` (scoped, expiring, audited) — not the removed unaudited `seed` command.

## 17. "Trust status looks different for the same peer in two capabilities"

**Expected.** Trust is `Trust(A→B, capability, context, time)`. A handshake standing does not automatically authorize `shell.exec`. Pass `--capability` / tool params when evaluating standing. There is no global immutable score.

## 18. Axiom / Prax hardened-v2 handshake runbook (after ops remediation)

**Success criteria:** challenge → offer (historical `adoptedAt`) → verify once; peer appears in absolutized trust graph; no silent CWD-relative files.

1. **Reconcile peer IDs** on both hosts:
   ```bash
   # Via tool (preferred): fpp_trust_status targeting self / peer
   # Confirm agentId form fpp:ed25519:<fingerprint> matches the peer you intend
   ```
2. **Bootstrap primary audit** if missing:
   ```bash
   npm run audit:bootstrap -- --soul "$HOME/.openclaw/agents/<agent>/SOUL.md"
   npm run audit:verify
   ```
3. **Optional:** `export FPP_SOUL=/path/to/SOUL.md` so offer stamps SOUL `- Adopted:` time.
4. **Challenge (verifier / Axiom):** `fpp_handshake_challenge` → copy JSON.
5. **Offer (peer / Prax):** `fpp_handshake_offer` with `peerChallenge` = challenge JSON. Confirm claim `adoptedAt` is historical when SOUL/adoption-state exist.
6. **Verify (verifier):** `fpp_handshake_verify` with offer JSON **once** (replay rejects).
7. **Confirm persistence:**
   ```bash
   ls -la "${FPP_WORKSPACE:-$HOME/.openclaw/workspace}"/fpp-trust-graph.json
   ```
   File appears only after first successful mutation (verify). See §0a3.

**Peer ID mismatch:** do not proceed — re-export attestation / compare `fpp_trust_status` IDs before offer/verify.

## Verification matrix (ops remediation — expected signals)

| Command | Expected signal |
|---------|-----------------|
| `npx tsx scripts/skill-self-check.ts --root <skill>` after `npm install` | `deps.noble` ok |
| `npm run audit:bootstrap -- --soul <adopted SOUL>` | creates/appends chain-valid log |
| `npm run audit:verify` | exit 0 |
| `npm test -w @ovrsr/fpp-enforcement-core` | `internal.read` / `internal.heartbeat` / `gateway.inspect` allow; `apply_patch` → `code.patch` |
| `npx tsx --test packages/trust-core/src/create-trust-stack.path.test.ts` | relative paths absolutize |
| `npx tsx --test plugin-trust/src/resolve-adopted-at.test.ts` | SOUL/adoption-state `adoptedAt` |

Do **not** claim plan `VERIFIED` until `/verify` re-runs this matrix.

## When you're stuck

1. Run `npm run verify-install -- --json` and paste the output.
2. Run `openclaw plugins inspect openclaw-fpp-plugin --runtime --json` (if installed).
3. Run `npm run audit:verify -- --json` against your audit log.
4. File an issue at `ovrsr/freedom-preserving-protocol` with the above three outputs.

Do **not** post raw SOUL.md or MEMORY.md content publicly — those may contain PII or contextual info you don't want to share.
