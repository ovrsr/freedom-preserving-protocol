# Steward / Operator Signed Authorization

**Status:** PARTIAL (local OpenClaw path + library core + repository-proven `apply_patch` descriptor coverage; live-gateway consumption of a published artifact is a separate post-release check)
**Plan:** `docs/plans/2026-07-18-steward-operator-authorization.md` (COMPLETE); live payload/path coverage `docs/plans/2026-07-18-apply-patch-live-coverage.md`
**Packages:** `@ovrsr/fpp-protocol-core` (contracts), `@ovrsr/fpp-steward-auth-core` (OpenPGP + ledger), `@ovrsr/fpp-enforcement-core` (coverage seam), `@ovrsr/openclaw-fpp-trust` (CLI), `@ovrsr/openclaw-fpp-plugin` (OpenClaw adapter)

## What this is

A parallel **human steward** identity and signed **operator authorization** path that does **not** pretend the local agent's Ed25519 key is the human operator.

- Steward ID: key-independent `fpp:steward:v1:<26 lowercase base32 chars>` (`mintStewardIdV1`)
- Key refs: algorithm-qualified; V1 uses `openpgp:<lowercase fingerprint>`
- Initial trust: explicit local TOFU (`--accept-tofu`), not OpenPGP web-of-trust
- Grants: `OperatorAuthorizationV1` (detached or clear-signed canonical JSON)
- Coverage: normalized to `issuerClass: "operator"` / `AUTHZ.mandate` as `mandateId: "operator:<authorizationId>"`
- Hard floors still win. Operator grants never become `approved`, `emergency`, or god mode.

## Local maintainer sequence

1. Initialize steward + ledger (CLI `steward init`) — records immutable local policy caps.
2. Emit a canonical key attestation template (`steward key-template`).
3. Sign the template with maintainer OpenPGP tooling (outside FPP — the plugin never holds private keys).
4. Admit with explicit TOFU for the first binding (`steward key-admit --accept-tofu`).
5. Create / sign / verify / admit an authorization (`steward authorization-*`).
6. Exercise a gated tool (e.g. `apply_patch` under `code.patch`); enforcement consumes one use under lock before allow.
7. Inspect steward ledger + enforcement audit (`steward inspect`, audit JSONL fields `stewardId` / `authorizationId` / `signingKeyRef` / `stewardLedgerEventHash`).
8. Revoke authorization or key via signed lifecycle events when needed.

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
| Config | `stewardAuthorizationLedgerPath`, `outOfWorkspacePaths` |
