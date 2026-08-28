# Steward / Operator Signed Authorization

**Status:** PARTIAL (local OpenClaw path + library core + repository-proven `apply_patch` descriptor coverage; live-gateway consumption of a published artifact is a separate post-release check)
**Plan:** `docs/plans/2026-07-18-steward-operator-authorization.md` (COMPLETE); live payload/path coverage `docs/plans/2026-07-18-apply-patch-live-coverage.md`; required-only consumption `docs/plans/2026-07-19-operator-authorization-required-consumption.md`
**Packages:** `@ovrsr/fpp-protocol-core` (contracts), `@ovrsr/fpp-steward-auth-core` (OpenPGP + ledger), `@ovrsr/fpp-enforcement-core` (coverage seam), `@ovrsr/openclaw-fpp-trust` (CLI), `@ovrsr/openclaw-fpp-plugin` (OpenClaw adapter)

## What this is

A parallel **human steward** identity and signed **operator authorization** path that does **not** pretend the local agent's Ed25519 key is the human operator.

- Steward ID: key-independent `fpp:steward:v1:<26 lowercase base32 chars>` (`mintStewardIdV1`)
- Key refs: algorithm-qualified; V1 uses `openpgp:<lowercase fingerprint>`
- Initial trust: **secure default** is a signed `StewardBootstrapV1` admitted with an independently supplied `--expected-key-ref` and interactive fingerprint confirmation (`steward bootstrap-admit`). Legacy local TOFU (`steward init` + `key-admit --accept-tofu`) remains only behind `--bootstrap-profile legacy-tofu`. Neither path is OpenPGP web-of-trust.
- Grants: `OperatorAuthorizationV1` (detached or clear-signed canonical JSON)
- Coverage: normalized to `issuerClass: "operator"` / `AUTHZ.mandate` as `mandateId: "operator:<authorizationId>"`
- Hard floors still win. Operator grants never become `approved`, `emergency`, or god mode.

## Admission vs required-only consumption

**Admission** (`steward authorization-admit`) records a verified grant in the steward ledger. It does **not** debit `remainingUses`.

**Consumption** happens later, at the tool boundary, and only when the grant is **required** to permit execution:

1. Enforcement resolves the ordinary disposition first (non-operator mandates, `standingAllowOn`, classifier allow, staged/reversible allow, hard floors, emergency, etc.).
2. If that baseline already maps to an allow-capable execution decision (`allow`, `allow_staged`, or `allow_minimal` via `legacyDecisionFromDisposition`), the steward grant is **not** inspected and **not** consumed — even when its scope would match.
3. If the baseline would block or require approval, enforcement looks up a matching operator grant, re-resolves with it, and — only when the operator mandate supplies the final allow — atomically records `authorization_consumed` under lock before returning allow.

Matching scope alone is therefore insufficient for a debit. Broad standing grants that include classes such as `exec.benign` do not lose uses on routine confirmations that ordinary policy already allows. Hard-floor denies remain unbypassable and leave matching grants unconsumed. Failed atomic consume recomputes without the operator grant (fail closed).

## Local maintainer sequence (secure bootstrap)

1. Configure the trust plugin's `stewardAuthorizationLedgerPath` and `stewardInstanceAudience` keys exactly as declared in `plugin-trust/openclaw.plugin.json`, then restart the gateway process so it reloads the manifest schema:

   ```json
   {
     "plugins": {
       "entries": {
         "openclaw-fpp-trust": {
           "config": {
             "stewardAuthorizationLedgerPath": ".openclaw/workspace/fpp-steward-authorization-ledger.jsonl",
             "stewardInstanceAudience": "instance:operator-assigned-stable-identifier"
           }
         }
       }
     }
   }
   ```

   Set `stewardInstanceAudience` to a stable, operator-assigned deployment identifier. It is not a secret, a hostname discovered from the target, or a presence factor. Store the ledger at the configured workspace-safe path; relative paths use the same resolution semantics as other trust-core paths.
2. Obtain the steward OpenPGP fingerprint from an **independent** channel (key ceremony notes, hardware display, prior out-of-band delivery). Do **not** trust a fingerprint that only appears inside an untrusted payload file on the target host.
3. Emit a canonical `StewardBootstrapV1` template (`steward bootstrap-template --key-ref openpgp:<fp> --public-key <cert.asc>`). The command uses configured `stewardInstanceAudience`; alternatively, supply `--audience` independently. With neither source it fails before emitting a template. The signed bundle binds steward ID, audience, immutable policy caps, and the initial OpenPGP public key.
4. Sign the canonical JSON with the subject OpenPGP key **outside** FPP (the plugin never holds steward private keys).
5. On the target host, run an **interactive** `steward bootstrap-admit --payload … --signature … --expected-key-ref openpgp:<fp>`. The CLI requires a TTY, displays steward ID / audience / policy / fingerprint, and asks the operator to type the last 8 hex characters of the expected fingerprint. Core admission also requires an independently supplied expected audience; the CLI uses configured `stewardInstanceAudience` by default, while `--audience` is an explicit operator-supplied override. It never derives the expected audience from the signed payload.
6. On success the ledger commits `ledger_initialized` then `key_binding_accepted` under one lock (`bootstrapProfile: "interactive-fingerprint"`). The authoritative empty-ledger/policy check occurs inside that lock. The complete two-event file is written and file-fsynced before atomic rename; the parent directory is fsynced where the platform supports directory handles. There is no initialized-but-unbound window on this path.
7. Create / sign / verify / admit an authorization (`steward authorization-*`) — admission records the grant; uses are unchanged until a required boundary debit.
8. Exercise a gated tool that ordinary policy would block or hold for approval; enforcement consumes one use under lock only when the operator grant supplies the final allow.
9. Inspect steward ledger + enforcement audit (`steward inspect`, audit JSONL fields `stewardId` / `authorizationId` / `signingKeyRef` / `stewardLedgerEventHash`). Routine already-allowed calls should leave `remainingUses` unchanged.
10. Revoke authorization or key via signed lifecycle events when needed.

### Assurance ceiling (honest limits)

TTY fingerprint confirmation is a **software-only attention and race-hardening control**. It blocks accidental/non-interactive initialization and closes the local init/admit race. It is **not** MFA, not a secret challenge, not proof of human identity, **not** protection against malware or an administrator controlling the terminal/process/host, and **not** remote anti-rollback. FIDO2/WebAuthn, out-of-band second-device approval, and OS-auth/elevation-backed profiles each require separate platform-specific threat models and implementations; they are explicitly deferred in `docs/ROADMAP.md` §6.

If `bootstrap-admit` reports the ledger is already initialized, or reports an initialized-only legacy state requiring explicit recovery, treat that as a **compromise indicator**: stop, preserve the ledger for audit, wipe/restore only as explicit recovery (that creates an audit discontinuity), and re-bootstrap from known-good media. A stale losing bootstrap never appends a second genesis pair.

### Legacy TOFU compatibility (discouraged)

`steward init` and initial `key-admit --accept-tofu` require `--bootstrap-profile legacy-tofu` and emit a high-visibility warning. Use only for existing automation that cannot yet adopt secure bootstrap. New deployments should not use this path.

## `apply_patch` descriptor boundary

`buildActionDescriptor()` extracts exact resource paths for steward scope matching. Supported payload forms (checked in this order):

1. **Structured `params.changes[]`** — when `changes` is an array (including empty), it is authoritative. Each entry must supply a usable `path`. Empty, malformed, duplicate, unsafe, or mixed-valid/invalid arrays fail closed (`targetsAmbiguous: true`, no partial path list). Flat text is **not** consulted as a fallback.
2. **Flat V4A text** — first string among `patch`, `input`, `diff`, `content`, `text`, `command`. Live OpenClaw↔Codex traffic commonly sends the full `*** Begin Patch` envelope under `params.command`.

Path rules:

- Relative headers stay workspace-relative resource paths.
- Native absolute paths are accepted only when lexical `path.relative(workspaceRoot, target)` containment succeeds (never string-prefix checks).
- Paths equal to `workspaceRoot`, parent escapes, sibling-prefix collisions, NUL, and foreign absolute forms fail closed.
- Files outside `workspaceRoot` require an exact `outOfWorkspacePaths` map entry (see below).

### Workspace root vs harness config

`resolveWorkspaceRoot({ profile: "openclaw" })` remains `~/.openclaw/workspace`. The harness top-level config (commonly `~/.openclaw/openclaw.json`) sits **outside** that root on purpose — it can hold credentials and plugin policy. Do not widen `workspaceRoot` to cover it.

Instead, map one absolute file to a resource-path alias used in authorization scope:

```json
{
  "outOfWorkspacePaths": {
    "<absolute-path-to-openclaw-json>": "harness/openclaw.json"
  }
}
```

Replace `<absolute-path-to-openclaw-json>` with the host's real absolute path (for example the result of resolving `$HOME/.openclaw/openclaw.json` on that machine). Alias values must be non-empty, relative, traversal-free resource identifiers. The map is bound into `effectiveConfigHash` as authorization policy.

### Operational hazards

- After changing `openclaw.plugin.json` schema fields, perform a **full gateway process restart**. Hot reload does not refresh the cached manifest schema.
- Do **not** add top-level `await` to the OpenClaw plugin entry module. The gateway loader can reject the file and leave the enforcement hook unregistered (total bypass window).
- `packageBuildHash` / `implementationVersion` identify package **metadata**, not source bytes. To prove a release embeds the live-payload fix, inspect the packed plugin's nested `@ovrsr/fpp-enforcement-core/dist/action-descriptor.js` (or run `plugin/pack-bundle.test.ts`).

### Tracked follow-up (not implemented here)

Thread `stewardAction.candidate.reason` into abstain audit diagnostics so target ambiguity, scope mismatch, expiry, and ledger unavailability are distinguishable. Until then, abstain reasons remain coarse.

## Storage

Default workspace files:

- `fpp-steward-authorization-ledger.jsonl` — authoritative hash-chained event log
- `fpp-steward-authorization-ledger.jsonl.lock/` — present only during a transaction

Absent ledger ⇒ no steward operator coverage. Never merge/edit JSONL by hand. Corrupt or locked state fails closed; recovery is explicit (backup, restore known-good chain, or disable by removing the ledger path from config).

## Threat model (honest limits)

Defends against forged signatures, wrong-key substitution, stale grants, cross-instance replay (audience), duplicate admission, double consumption, revoked keys/grants, scope confusion, ambiguous `apply_patch` targets, and unaudited allow decisions at the instrumented gate.

Does **not** defend against: malware that replaces code/state and bypasses the hook; theft of every active steward private key; compromised OpenPGP implementation; side effects hidden from tool parameters; uninstrumented paths; full workspace rollback to an old valid snapshot; remote multi-host ledger sync. Hash chaining detects local edits; remote anti-rollback is future work.

Operator authorization does **not** manufacture affected-party or data-subject consent, and cannot bypass classifier/`blockOn` hard floors.

## Symbols

| Area | Symbol |
|------|--------|
| Contracts | `StewardKeyAttestationV1`, `OperatorAuthorizationV1`, `OperatorAuthorizationRevocationV1` |
| Core | `StewardAuthorizationLedger`, `StewardRegistry`, `AuthorizationService`, `createOpenPgpBackend` |
| Enforcement | `buildActionDescriptor`, `lookupStewardOperatorCoverage`, `consumeStewardOperatorCoverage` |
| Config | `stewardAuthorizationLedgerPath`, `stewardInstanceAudience`, `outOfWorkspacePaths` |
