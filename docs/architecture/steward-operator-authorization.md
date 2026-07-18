# Steward / Operator Signed Authorization

**Status:** PARTIAL (local OpenClaw path + library core; not cross-harness / live-gateway proven)
**Plan:** `docs/plans/2026-07-18-steward-operator-authorization.md`
**Packages:** `@ovrsr/fpp-protocol-core` (contracts), `@ovrsr/fpp-steward-auth-core` (OpenPGP + ledger), `@ovrsr/fpp-enforcement-core` (coverage seam), `@ovrsr/openclaw-fpp-trust` (CLI)

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
| Config | `stewardAuthorizationLedgerPath` |
