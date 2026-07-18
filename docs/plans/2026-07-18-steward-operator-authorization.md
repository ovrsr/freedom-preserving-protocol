# Steward / Operator Signed Authorization

**Status:** COMPLETE
**Created:** 2026-07-18
**Scope:**
- **In:** A key-independent human steward identity; explicit local TOFU bootstrap; multiple OpenPGP key bindings; signed add/rotate/revoke attestations; detached and clear-signed authorization messages; one-shot and bounded standing grants; durable replay, revocation, consumption, and audit state; exact classification/tool/path scope matching; an OpenClaw CLI flow; and enforcement integration for `code.patch` with the same normalized coverage seam available to `gateway.config-change`, `exec.system-modify`, and other existing classifications.
- **Out:** Replacing `fpp:ed25519:` agent identity; OpenPGP web-of-trust or network key discovery; automatic keyserver refresh; remote/multi-host ledger synchronization; threshold steward control; recovery when every steward key is lost; bypassing `blockOn`/classifier hard floors; using operator authorization as affected-party or data-subject consent; automatic inbox watching; per-call chat/session identity; live deployment changes; and ClawHub publication.

## Summary

Add a parallel human identity and authorization path without pretending that the local agent's Ed25519 key is the human operator. A maintainer explicitly initializes a key-independent `fpp:steward:v1:...` identity, accepts a self-signed initial OpenPGP binding as a local TOFU root, and thereafter changes bindings only through signed lifecycle attestations.

Operator authorization is a distinct signed artifact, not an OpenPGP-shaped `StandingMandateV1`. The new steward-auth core verifies and durably admits the artifact, then exposes a normalized `issuerClass: "operator"` coverage result to the existing disposition ladder. Hard floors still win. Before an allow is returned, the core atomically rechecks and consumes the grant under a cross-process lock; a race, corrupt ledger, incomplete key state, or scope ambiguity fails closed.

## Locked Design Choices (2026-07-18)

| ID | Choice |
|---|---|
| A | Steward ID is key-independent: `fpp:steward:v1:<26 lowercase RFC 4648 base32 chars>` from 128 random bits. Rotation does not change identity. |
| B | Initial trust is explicit local TOFU: the new key self-signs the initial binding and the CLI requires an explicit `--accept-tofu` acknowledgement. The local acceptance event is the root of trust. |
| C | Shared verification/state logic lives in a new harness-neutral `@ovrsr/fpp-steward-auth-core` package consumed by trust CLI and enforcement. |
| D | V1 supports both canonical JSON + detached ASCII-armored signatures and canonical JSON inside an OpenPGP clear-signed message. |
| E | Grants enter through explicit human CLI verify/admit, not a watched directory, chat identity, or an LLM-callable signing tool. |
| F | Reuse the existing `AUTHZ.mandate` / `issuerClass: "operator"` disposition contract, but do not reuse the Ed25519-only `StandingMandateV1` wire signature. |
| G | One authoritative, hash-chained `fpp-steward-authorization-ledger.jsonl` stores initialization, binding, admission, rejection, consumption, and revocation events. No unsigned snapshot is authoritative. |
| H | V1 path scope is exact normalized workspace-relative paths, not globs. When a restricted target cannot be extracted unambiguously, reject. |
| I | One-shot grants require `maxUses: 1`; standing grants require finite expiry and finite `maxUses`, both capped by immutable local policy recorded at ledger initialization. |
| J | Key retirement/revocation immediately invalidates unconsumed and standing grants signed by that key. A signed authorization revocation may be issued by any currently active key for the same steward. |

## Architecture Note

### Identity and trust model

- `StewardIdV1` is a human/operator identifier distinct from `AgentIdentity`. It is random and key-independent so multiple keys and rotations preserve continuity.
- `KeyRef` is algorithm-qualified. V1 implements `openpgp:<lowercase full primary fingerprint>`; the schema and backend registry permit future algorithms without changing steward IDs.
- Local enrollment is not web-of-trust. For the first binding, the submitted public certificate must fingerprint to `keyRef`, contain no private key material, and verify its own attestation signature. The CLI then records explicit local TOFU acceptance.
- Adding a parallel key or rotating requires signatures from (1) a currently active steward key and (2) the new key as proof of possession. Rotation retires the replaced key; add keeps existing keys active.
- Revocation requires a signature from a currently active key for that steward. A target key may revoke itself. If all keys are lost, recovery is deliberately unavailable in V1 rather than silently trusting local chat or agent identity.

### Signed message formats

All payloads are strict TypeBox-validated JSON with `additionalProperties: false`. Their signed bytes are exactly `canonicalizeV2(payload)` with no trailing newline. Parsers reject duplicate-key/non-canonical representations rather than normalizing attacker-controlled input after signature verification.

`StewardKeyAttestationV1`:

```text
{
  schemaVersion: 1,
  kind: "steward-key-attestation",
  attestationId,
  operation: "initial-bind" | "add" | "rotate" | "revoke",
  stewardId,
  audience: <local instance id>,
  subjectKey: { algorithm, keyRef, publicKeyArmored? },
  replacesKeyRef?,
  issuedAt,
  nonce,
  reason
}
```

`OperatorAuthorizationV1`:

```text
{
  schemaVersion: 1,
  kind: "operator-authorization",
  authorizationId,
  stewardId,
  signingKeyRef,
  audience: <local instance id>,
  mode: "one-shot" | "standing",
  scope: {
    classifications: [<exact existing classification ids>],
    toolNames?: [<exact normalized tool names>],
    resourcePaths?: [<exact normalized workspace-relative paths>]
  },
  issuedAt,
  expiresAt,
  nonce,
  maxUses,
  reason
}
```

`OperatorAuthorizationRevocationV1` identifies `authorizationId` and repeats `stewardId`, `signingKeyRef`, `audience`, `issuedAt`, `nonce`, and `reason`.

The detached envelope is a canonical JSON file plus one or more armored detached signature files. The cleartext envelope is an armored clear-signed message whose extracted text must equal the canonical payload; multiple OpenPGP signatures are accepted when lifecycle policy requires them. Verification uses the official `openpgp` package, awaits every signature's `verified` promise, resolves the signing subkey to the bound primary certificate, and checks packet creation time against payload `issuedAt` within bounded clock skew. OpenPGP certificate validity is checked without enabling insecure reformatted-key compatibility.

### Storage, replay, and atomicity

Default state is one reversible addition under the workspace root:

```text
fpp-steward-authorization-ledger.jsonl
fpp-steward-authorization-ledger.jsonl.lock/   # present only during a transaction
```

Each event has a monotonic sequence, previous hash, event hash, event kind, timestamp, evidence digest, and bounded forensic detail. Accepted events retain the signed payload/envelope needed to rebuild and re-verify state. Rejections retain a digest and bounded reason, not arbitrary untrusted message bodies.

Every state transition obtains an atomic lock directory, reloads and verifies the full tail/hash chain, applies the transition, appends and `fsync`s one complete JSONL record, then releases the lock. A pre-existing lock, malformed/partial tail, sequence gap, hash mismatch, unsupported schema/backend, or I/O failure rejects/abstains. V1 never guesses that a lock is stale; operator recovery is explicit and documented.

`authorizationId`, attestation IDs, and nonces are unique within the instance ledger. Admission consumes the authorization nonce exactly once. Gate consumption is a separate transactional event. A read-only candidate lookup cannot authorize an action: immediately before returning allow, enforcement calls `consumeIfValid`, which rechecks binding status, expiry, revocation, scope, and remaining uses under lock. If it loses a race or any state changed, enforcement recomputes without that coverage.

### Revocation and enforcement integration

- Key revoke/retire closes that key immediately for new and previously admitted but unconsumed grants.
- Authorization revocation closes the named grant without deleting its acceptance/consumption history.
- One-shot authorization is exhausted after one successful gate claim. Standing authorization is bounded by both expiry and `maxUses`.
- The existing order remains: hard floor → live mandate/operator coverage → standing allow → staged → quorum → emergency → abstain.
- Steward coverage is normalized as `mandateId: "operator:<authorizationId>"`, `issuerClass: "operator"`, `authorization: AUTHZ.mandate`, with source metadata retained for the enforcement audit. It never becomes `approved`, `emergency`, or god mode.
- Initial end-to-end target extraction is `apply_patch`: every `*** Add File`, `*** Update File`, and other supported patch target must be parsed and all targets must fit the authorization. Missing, absolute, traversing, duplicate-conflicting, or malformed targets reject when resource scope is present.
- Classification-only grants can cover existing exact IDs such as `code.patch`, `gateway.config-change`, and `exec.system-modify`; `gateway.restart` and every configured/classifier hard block remain non-overridable.

### Audit model

The steward ledger records binding and authorization verification acceptance/rejection, revocation, and successful consumption. Existing `fpp-plugin-audit.jsonl` records the final action disposition and references steward ID, authorization ID, key reference, and steward-ledger event hash. If the steward event cannot be durably recorded, the signed authorization path cannot allow the action.

### Threat model and non-goals

This design addresses forged signatures, wrong-key substitution, stale grants, cross-instance replay, duplicate admission, double consumption, revoked keys/grants, scope confusion, ambiguous target extraction, and unaudited authorization decisions at an instrumented gate.

It does not defend against an administrator or malware that can replace code/state and bypass the hook, theft of every active steward private key, a compromised OpenPGP implementation, side effects hidden from tool parameters, uninstrumented execution paths, or rollback of the entire workspace to an old valid snapshot. Hash chaining makes local edits detectable, not impossible; remote anchoring/anti-rollback is future work. Operator authorization also does not manufacture affected-party/data-subject consent or constitutional ratification.

## Feature Inventory

This is additive, not a replacement migration. Existing surfaces remain valid.

| Existing file/symbol or behavior | New mapping | Task |
|---|---|---|
| `packages/protocol-core/src/identity.ts` / `fpp:ed25519:` agent identity | Unchanged; parallel `StewardIdV1` and algorithm-qualified `KeyRef` contracts | Task 1 |
| `StandingMandateV1` `issuerClass: "operator"` and `AUTHZ.mandate` | Reuse normalized disposition coverage only; OpenPGP artifact remains distinct | Tasks 1, 8 |
| `MandateStore.findCoverage` | Parallel steward candidate/transactional consume path; existing mandates unchanged | Task 8 |
| `resolveDisposition` hard-floor-first behavior | Unchanged; operator coverage enters only through `liveMandate`-compatible coverage | Task 8 |
| `ReplayCache` temp+rename pattern | Stronger ledger-level unique nonce/admission events; handshake replay cache unchanged | Tasks 3, 5 |
| In-memory `KeyLifecycleLedger` for agent keys | Unchanged; durable steward binding lifecycle is separate and fail-closed | Task 4 |
| `appendEnforcementEntry` | Add optional steward evidence references; existing wire fields remain compatible | Task 8 |
| `registerFppTrustCli` | Add explicit human steward and authorization command groups | Tasks 9, 10 |
| No steward state file | Add `fpp-steward-authorization-ledger.jsonl`; absence means no operator coverage | Task 3 |
| No OpenPGP dependency | Add official `openpgp` dependency only to the new core and consumers that bundle it | Task 2 |

## Progress Tracking

- [x] Task 1: Protocol contracts for steward identity, attestations, grants, and revocations
- [x] Task 2: Steward-auth core package and OpenPGP signature backends/envelopes
- [x] Task 3: Transactional hash-chained steward authorization ledger
- [x] Task 4: Steward initialization and multi-key binding lifecycle
- [x] Task 5: Signed authorization verification and replay-safe admission
- [x] Task 6: Exact scope matching, standing revocation, and transactional consumption
- [x] Task 7: Enforcement action descriptor and `apply_patch` target extraction
- [x] Task 8: Runtime/disposition/audit integration for operator coverage
- [x] Task 9: CLI steward init, key bind/rotate/revoke, and inspect flow
- [x] Task 10: CLI authorization template, verify, admit, inspect, and revoke flow
- [x] Task 11: Permanent architecture, migration, capability, and operator documentation
- [x] Task 12: Secure vertical-slice E2E and repository-wide verification

**Total Tasks:** 12 | **Completed:** 12 | **Remaining:** 0

## Implementation Tasks

### Task 1: Protocol contracts for steward identity, attestations, grants, and revocations

**Objective:** Define algorithm-neutral, versioned wire contracts and canonical payload helpers without changing agent identity or teaching protocol-core how to perform OpenPGP verification.

**Files:**
- Create: `packages/protocol-core/src/steward-authorization.ts`
- Test: `packages/protocol-core/src/steward-authorization.test.ts`
- Modify: `packages/protocol-core/src/index.ts`

**Steps:**
1. Write failing tests for mint/parse of `fpp:steward:v1:<base32>`, malformed IDs/key refs, strict schemas, canonical signing fields, temporal invariants, one-shot/standing bounds, audience/nonce requirements, and authorization-revocation parsing (RED).
2. Run `npm test -w @ovrsr/fpp-protocol-core` and confirm failures are missing steward contracts, not syntax/fixture errors.
3. Implement `StewardIdV1`, generic `KeyRef`, `StewardKeyAttestationV1`, `OperatorAuthorizationV1`, `OperatorAuthorizationRevocationV1`, parse helpers, canonical payload helpers, and domain-separated evidence/replay digests (GREEN).
4. Reject unknown properties, wildcard/empty scopes, invalid ISO times, duplicate scope entries, malformed/non-random-looking nonces, and consent-class tokens that operator authority cannot satisfy.
5. Export the contracts; rerun package tests and root typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors (repository has no lint script; record N/A)
- [ ] Dependent docs updated (if applicable)

### Task 2: Steward-auth core package and OpenPGP signature backends/envelopes

**Objective:** Add a harness-neutral package with a backend registry and an OpenPGP implementation that verifies both selected envelope formats without system `gpg`.

**Files:**
- Create: `packages/steward-auth-core/package.json`
- Create: `packages/steward-auth-core/tsconfig.json`
- Create: `packages/steward-auth-core/src/signature-backend.ts`
- Create: `packages/steward-auth-core/src/openpgp-backend.ts`
- Create: `packages/steward-auth-core/src/openpgp-backend.test.ts`
- Create: `packages/steward-auth-core/src/index.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Steps:**
1. Add the latest official `openpgp` package through npm and scaffold workspace build/test/typecheck scripts; dependency/scaffold changes are configuration-only.
2. Write failing in-process tests that generate two test keys and cover detached verification, clear-signed verification, multiple signatures, exact primary fingerprint/key ref, wrong key, modified payload, non-canonical/duplicate-key JSON, private-key armor rejection, signature-time skew, and unsupported backend (RED).
3. Run `npm test -w @ovrsr/fpp-steward-auth-core` and confirm the missing backend behavior.
4. Implement `SignatureBackend`/registry plus OpenPGP parsing and verification using `readKey`, `readSignature`/`readCleartextMessage`, `verify`, and awaited `signature.verified`; do not enable `allowInsecureVerificationWithReformattedKeys`.
5. Resolve signing subkeys to the bound primary certificate, enforce configured clock skew/current certificate validity, export public APIs, and add the workspace to root `build:core`, `test`, and `typecheck`; rerun tests/typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors (repository has no lint script; record N/A)
- [ ] Dependent docs updated (if applicable)

### Task 3: Transactional hash-chained steward authorization ledger

**Objective:** Create one authoritative local event ledger with cross-process serialization, durable append, corruption detection, and no fail-open snapshot.

**Files:**
- Create: `packages/steward-auth-core/src/ledger.ts`
- Test: `packages/steward-auth-core/src/ledger.test.ts`
- Modify: `packages/steward-auth-core/src/index.ts`

**Steps:**
1. Write failing tests for empty initialization, sequence/hash-chain verification, append/reload, `0600` files where supported, concurrent lock rejection, partial/malformed tail, hash mismatch, duplicate IDs/nonces, append/fsync failure, and lock release on exceptions (RED).
2. Run the steward-auth-core tests and confirm the ledger API is missing.
3. Implement `StewardAuthorizationLedger` with an atomic lock directory, bounded lock acquisition, full verified reload inside every transaction, monotonic sequence, `previousHash`, domain-separated event hash, `writeSync` + `fsyncSync`, and bounded rejection details (GREEN).
4. Treat existing locks and corrupt/unsupported ledgers as unavailable; never auto-delete a lock, truncate a bad tail, restart a chain, or auto-migrate unknown schema.
5. Rerun package tests and root typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors (repository has no lint script; record N/A)
- [ ] Dependent docs updated (if applicable)

### Task 4: Steward initialization and multi-key binding lifecycle

**Objective:** Build durable steward state from verified ledger events, including explicit initial TOFU, multiple active keys, dual-signed add/rotation, and signed revocation.

**Files:**
- Create: `packages/steward-auth-core/src/steward-registry.ts`
- Test: `packages/steward-auth-core/src/steward-registry.test.ts`
- Modify: `packages/steward-auth-core/src/index.ts`

**Steps:**
1. Write failing tests for steward mint continuity, initial self-signed binding plus required local TOFU acknowledgement, wrong fingerprint/key, wrong audience, replayed attestation, add-key dual signatures, rotation retirement, revocation, revoked-authorizer rejection, multiple active keys, and no-active-key fail-closed state (RED).
2. Run target tests and confirm missing registry/lifecycle behavior.
3. Implement ledger-derived `StewardRegistry` state and transitions. Initial bind verifies with the subject key; add/rotate requires an active-key signature and subject-key proof of possession; revoke requires any active same-steward key.
4. Re-verify retained signed evidence while rebuilding state; unknown backend, invalid historical evidence, conflicting sequence, or ambiguous signer mapping invalidates the registry rather than skipping an event.
5. Rerun package tests and root typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors (repository has no lint script; record N/A)
- [ ] Dependent docs updated (if applicable)

### Task 5: Signed authorization verification and replay-safe admission

**Objective:** Verify a signed operator grant against current steward bindings and local policy, then admit it exactly once with a durable acceptance or rejection record.

**Files:**
- Create: `packages/steward-auth-core/src/authorization-service.ts`
- Test: `packages/steward-auth-core/src/authorization-service.test.ts`
- Modify: `packages/steward-auth-core/src/index.ts`

**Steps:**
1. Write failing tests for valid detached and clear-signed grants plus required rejection cases: wrong key, unbound key, revoked/retired key, expired/not-yet-valid message, wrong audience, excessive lifetime/uses, replayed nonce/ID, invalid signature, unsupported algorithm, and non-delegable consent claim (RED).
2. Run target tests and verify the failures represent missing admission behavior.
3. Implement `verify` (read-only) and `admit` (transactional) using verifier-controlled time, immutable instance policy from the initialization event, currently active key binding, packet/payload time consistency, strict scope, and unique nonce/authorization ID.
4. Append `authorization_accepted` with retained signed evidence or `authorization_rejected` with digest + bounded typed reason; an audit append failure means admission fails.
5. Rerun package tests and root typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors (repository has no lint script; record N/A)
- [ ] Dependent docs updated (if applicable)

### Task 6: Exact scope matching, standing revocation, and transactional consumption

**Objective:** Match grants to concrete action descriptors and ensure no action is allowed until one use has been durably claimed under current key/grant state.

**Files:**
- Create: `packages/steward-auth-core/src/scope.ts`
- Test: `packages/steward-auth-core/src/scope.test.ts`
- Modify: `packages/steward-auth-core/src/authorization-service.ts`
- Modify: `packages/steward-auth-core/src/authorization-service.test.ts`

**Steps:**
1. Write failing tests for exact classification match, conjunctive optional tool/path restrictions, all-target containment, path traversal/absolute/unknown-target rejection, one-shot exhaustion, bounded standing use counts, expiry after admission, key revocation after admission, signed authorization revocation, double-consume race, and durable accepted/rejected evaluation records (RED).
2. Run target tests and confirm missing scope/consumption behavior.
3. Implement `ActionDescriptor`, strict normalized matching, read-only candidate lookup, signed revocation admission, and `consumeIfValid` that reloads/rechecks/claims under the ledger lock (GREEN).
4. Return typed reasons (`none`, `scope-mismatch`, `target-ambiguous`, `expired`, `key-inactive`, `authorization-revoked`, `exhausted`, `replay`, `ledger-unavailable`) without exposing raw attacker input.
5. Rerun package tests and root typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors (repository has no lint script; record N/A)
- [ ] Dependent docs updated (if applicable)

### Task 7: Enforcement action descriptor and `apply_patch` target extraction

**Objective:** Translate an attempted tool call into the exact descriptor used by steward scope matching, with secure path extraction for the first gated vertical slice.

**Files:**
- Create: `packages/enforcement-core/src/action-descriptor.ts`
- Test: `packages/enforcement-core/src/action-descriptor.test.ts`
- Modify: `packages/enforcement-core/src/index.ts`

**Steps:**
1. Write failing tests for bare/prefixed `apply_patch`, add/update/delete/move headers supported by the repository patch grammar, multiple files, malformed headers, absolute paths, `..` traversal, conflicting duplicates, missing patch text, normalized tool name, and classification propagation (RED).
2. Run enforcement-core tests and confirm the descriptor extractor is absent.
3. Implement `buildActionDescriptor(event, classification, workspaceRoot)`; collect every affected path and mark targets ambiguous on any unsupported/malformed shape rather than returning a partial list.
4. Keep general classifications/tool names usable without resource scope; resource-restricted authorization must reject ambiguous/absent targets.
5. Export the helper; rerun enforcement tests and root typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors (repository has no lint script; record N/A)
- [ ] Dependent docs updated (if applicable)

### Task 8: Runtime/disposition/audit integration for operator coverage

**Objective:** Let verified steward authorization satisfy the existing mandate gate while preserving hard-floor precedence, transactional consumption, and cross-ledger audit evidence.

**Files:**
- Modify: `packages/enforcement-core/package.json`
- Modify: `packages/enforcement-core/src/config.ts`
- Modify: `packages/enforcement-core/src/config.test.ts`
- Modify: `packages/enforcement-core/src/disposition-engine.ts`
- Modify: `packages/enforcement-core/src/disposition-engine.test.ts`
- Modify: `packages/enforcement-core/src/runtime-adapter.ts`
- Modify: `packages/enforcement-core/src/runtime-adapter.test.ts`
- Modify: `packages/enforcement-core/src/audit-log.ts`
- Modify: `packages/enforcement-core/src/audit-log.test.ts`
- Modify: `plugin/openclaw.plugin.json`
- Modify: `package-lock.json`

**Steps:**
1. Write failing integration tests: valid `code.patch` grant produces `allow`/`AUTHZ.mandate`; wrong scope/expired/revoked/replayed/exhausted grants do not; hard-floor remains deny; consume race recomputes without coverage; corrupt/locked ledger fails closed; final enforcement audit references steward/auth/key/event evidence (RED).
2. Run enforcement-core tests and confirm the operator coverage path is missing.
3. Add `stewardAuthorizationLedgerPath` defaulting to the workspace ledger. Build an action descriptor, request a read-only candidate, and normalize it to live operator mandate coverage only after all verifier checks pass.
4. If disposition selects that coverage, call `consumeIfValid` before returning allow. On failure, recompute disposition with no operator coverage; never fall through to an implicit allow caused by the failed grant. Existing mandates and hard-floor ordering remain unchanged.
5. Add backward-compatible optional steward evidence fields to enforcement audit events, wire plugin config schema, rerun enforcement/plugin tests and root typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors (repository has no lint script; record N/A)
- [ ] Dependent docs updated (if applicable)

### Task 9: CLI steward init, key bind/rotate/revoke, and inspect flow

**Objective:** Provide a human-operated local flow to mint a steward ID, inspect canonical attestation templates, admit signed key lifecycle events, and explain current/history state.

**Files:**
- Modify: `plugin-trust/package.json`
- Modify: `plugin-trust/src/cli.ts`
- Modify: `plugin-trust/src/cli.test.ts`
- Modify: `plugin-trust/src/index.ts`
- Modify: `plugin-trust/openclaw.plugin.json`
- Modify: `package-lock.json`

**Steps:**
1. Write failing CLI tests for `steward init`, `steward key-template`, `steward key-admit`, `steward inspect`, explicit `--accept-tofu`, both signature envelope inputs, rotation/add co-signature requirements, revocation, nonzero exits, and no private-key signing by the plugin (RED).
2. Run plugin-trust tests and confirm commands are not registered.
3. Wire the shared ledger path and backend registry into `CliDependencies`; add nested commands that emit canonical machine-signable JSON and accept either `--payload` + repeated `--signature` or `--cleartext`.
4. Print steward ID, instance audience, key refs/status, event sequence/hash, and typed rejection reason. Never print armored private material or claim OpenPGP web-of-trust assurance.
5. Update the plugin config schema/descriptor and dependencies; rerun plugin-trust tests and root typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors (repository has no lint script; record N/A)
- [ ] Dependent docs updated (if applicable)

### Task 10: CLI authorization template, verify, admit, inspect, and revoke flow

**Objective:** Make one-shot and standing signed grants usable by a maintainer without exposing an LLM-callable authorization bypass.

**Files:**
- Modify: `plugin-trust/src/cli.ts`
- Modify: `plugin-trust/src/cli.test.ts`
- Modify: `plugin-trust/src/index.ts`

**Steps:**
1. Write failing tests for `steward authorization-template`, `authorization-verify`, `authorization-admit`, `authorization-list`, `authorization-revoke-template`, and `authorization-revoke`; cover detached/clear-signed input, one-shot/standing bounds, scope display, dry verify without nonce consumption, replay on second admit, and revoked authorization inspection (RED).
2. Run plugin-trust tests and confirm commands are missing.
3. Implement canonical template output and explicit verify/admit separation. Verify is read-only; admit consumes nonce and records evidence; revoke requires a signed revocation payload from any active same-steward key.
4. Require reason, finite expiry, exact classifications, optional exact tools/paths, and local instance audience. Do not add a tool contract that lets an agent mint or sign grants.
5. Rerun plugin-trust tests and root typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors (repository has no lint script; record N/A)
- [ ] Dependent docs updated (if applicable)

### Task 11: Permanent architecture, migration, capability, and operator documentation

**Objective:** Preserve the security model and provide a verified local maintainer flow, storage migration/rollback guidance, and honest capability claims.

**Files:**
- Create: `docs/architecture/steward-operator-authorization.md`
- Modify: `docs/governance/CONSENT_AND_AUTHORIZATION.md`
- Modify: `docs/governance/KEY_GOVERNANCE.md`
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `plugin-trust/README.md`

**Steps:**
1. Carry forward this plan's identity/trust/message/storage/replay/revocation/integration/threat-model note with exact shipped symbols and commands.
2. Document the local sequence: initialize → create canonical binding template → sign with maintainer OpenPGP tooling → explicit TOFU admit → create/sign/verify/admit authorization → exercise gate → inspect audit → sign/admit revocation.
3. Before publishing each command, run it or a safe read-only/help equivalent against a temporary workspace; use exact paths/defaults from code rather than invented resource names.
4. Document additive migration: absent ledger means no steward coverage; back up before movement; never merge/edit JSONL manually; removal disables the feature but does not alter mandates; corrupt/locked state fails closed; unknown schema requires explicit tooling.
5. Mark the capability `PARTIAL` until cross-harness/live-gateway coverage exists; clearly state no WoT, no third-party consent, no hard-floor bypass, and local audit/anti-rollback limits. Docs-only edits skip TDD.

**Definition of Done:**
- [ ] Target command/help smoke checks pass
- [ ] No new type errors
- [ ] No new linter errors (repository has no lint script; record N/A)
- [ ] Dependent docs updated

### Task 12: Secure vertical-slice E2E and repository-wide verification

**Objective:** Prove the smallest secure flow from steward bootstrap through signed grant admission to one real gated `code.patch` allow and durable audit/consumption.

**Files:**
- Create: `test/steward-operator-authorization-e2e.test.ts`
- Modify: `test/library-consumer-smoke.test.ts`
- Modify: `test/protocol-core-interoperability.test.ts`

**Steps:**
1. Write the E2E test first and run it RED: initialize steward/instance, bind OpenPGP key, admit signed one-shot `code.patch`, call `createEnforcementRuntime`, allow the exact patch once, reject replay/second use, and assert steward + enforcement audit linkage.
2. Add E2E negatives for wrong key, expired message, revoked key, scope/path mismatch, corrupt ledger, and hard-floor precedence; include one bounded standing grant and both envelope formats.
3. Add library/interop smoke assertions proving the new core has no OpenClaw dependency and protocol contracts remain consumable independently.
4. Run targeted package tests, `npm run typecheck`, `npm run test:all`, and `npm run verify:all` fresh. Capture exact pass/fail output; do not mark the plan COMPLETE until all implementation tasks and required checks pass.
5. Inspect `git status --short` and `git diff` to ensure pre-existing unrelated package/SKILL edits were neither overwritten nor included accidentally. Update every task checkbox/count immediately as required by `/implement`.

**Definition of Done:**
- [ ] Required valid/reject/audit E2E matrix passes
- [ ] No new type errors
- [ ] No new linter errors (repository has no lint script; record N/A)
- [ ] Full repository verification passes

## Testing Strategy

- **Protocol units:** Steward/key-ref syntax, strict schemas, canonical payload bytes, temporal and standing bounds, replay digests.
- **Crypto units:** Both OpenPGP envelope formats, multiple signers, wrong key, altered bytes, key/subkey fingerprint resolution, certificate/signature time policy, unsupported backend.
- **Ledger units:** Hash/sequence integrity, fsync append, lock contention, partial/corrupt tails, replay uniqueness, rebuild/re-verification.
- **Lifecycle units:** Initial TOFU, add/rotate/revoke, multiple keys, dual-signature proof, inactive-key rejection.
- **Authorization units:** Valid, wrong/unbound/revoked key, expired/future, replayed, over-broad, revoked, exhausted, scope/tool/path mismatch, concurrent consumption.
- **Enforcement integration:** `code.patch` target extraction, hard-floor precedence, normalized operator coverage, consume-before-allow, recomputation on race, dual audit linkage.
- **CLI:** Canonical templates, inspectability, verify vs admit semantics, nonzero failures, no private-key use inside FPP.
- **E2E:** Required seven-case matrix plus standing authorization, both envelope formats, corruption fail-closed, and one exact target allow.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Local agent re-signing launders operator authority | Preserve original OpenPGP artifact; never emit an agent-signed operator mandate. |
| Key-derived ID breaks continuity | Random key-independent steward ID; key refs live in lifecycle events. |
| TOFU is mistaken for external identity proof | Explicit flag/event and docs; no WoT/real-world identity claim. |
| OpenPGP parser/canonicalization ambiguity | Exact canonical JSON bytes, strict schemas, duplicate/non-canonical rejection, no insecure reformatted-key option. |
| Signing subkey is confused with primary binding | Resolve signer subkey through the exact bound certificate and audit both references. |
| Backdated or expired signature bypasses time limits | Compare packet creation time to signed `issuedAt`; verifier-controlled now/clock skew; recheck expiry at consumption. |
| Replay or double use across processes | Instance audience + unique nonce/ID + lock-protected transactional consume before allow. |
| Scope matcher authorizes only part of a multi-file patch | Extract all targets; all-target containment; ambiguity rejects. |
| Signed message becomes blanket god mode | Exact nonempty classifications, optional conjunctive targets, finite expiry/uses, immutable local caps, hard floors first. |
| Key rotation leaves old standing grants live | Retired/revoked key immediately invalidates its unconsumed grants. |
| Corrupt ledger or crashed lock causes unsafe recovery | Fail closed; never auto-truncate/delete; documented explicit recovery. |
| Local ledger rollback re-enables old authority | State the limitation; event hash linkage aids detection; remote anchoring is future work. |
| New crypto package leaks into protocol-only consumers | Keep verification implementation in steward-auth-core; protocol-core contains contracts only. |
| Existing user edits are overwritten | Inspect current diff before each touched package/config file and preserve unrelated changes. |
