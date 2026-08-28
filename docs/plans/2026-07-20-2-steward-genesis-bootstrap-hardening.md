# Steward Genesis Bootstrap Hardening

**Status:** COMPLETE
**Created:** 2026-07-20
**Scope:**
- **In:** Add a signed, atomic steward bootstrap ceremony; bind the expected OpenPGP fingerprint and local ledger policy before genesis; require an interactive human confirmation for the secure CLI path; serialize concurrent bootstrap attempts; retain the existing TOFU flow only as an explicitly insecure legacy compatibility profile.
- **Out:** Claiming resistance to administrator/root malware, mandatory hardware ownership, WebAuthn/FIDO implementation, a hosted second-device service, OS-specific elevation integration, OpenPGP web-of-trust/keyservers, remote ledger witnessing, or all-keys-lost recovery. The user explicitly confirmed on 2026-07-20 that FIDO2/WebAuthn, OOB second-device approval, and OS elevation each require separate platform-specific development and are not part of this remediation.

## Summary

The current steward flow is `init → key-template → external signature → key-admit --accept-tofu`. `--accept-tofu` is a boolean acknowledgement, not evidence of human presence. Ledger initialization and first binding are separate transactions, so a local script can initialize or win the first binding before the intended operator. Post-genesis signature, replay, locking, and consumption controls do not repair a hostile genesis.

This feature introduces a signed `StewardBootstrapV1` bundle that binds the steward ID, instance audience, ledger policy, initial OpenPGP public key/fingerprint, nonce, and issuance time. A new secure CLI ceremony creates the bundle for offline signing, requires the operator to supply the expected fingerprint independently, verifies a typed fingerprint confirmation on an interactive TTY, verifies the external OpenPGP signature, and then writes `ledger_initialized` plus `key_binding_accepted` under one ledger lock.

The ceremony is a software-only baseline. It blocks accidental/non-interactive initialization and is intended to remove the init/admit race, but it must not claim to defeat malware that controls the terminal, process, code, or administrator account. High-assurance OOB/hardware/OS-auth profiles remain separately deferred.

Post-implementation review reproduced a stale pre-lock race: a losing contender returned failure after appending a second `ledger_initialized` / `key_binding_accepted` pair and replacing the effective policy. Review also found optional host-audience anchoring, incomplete secret-key armor rejection, missing key algorithm/ref consistency, and incomplete CLI-action coverage. Tasks 7–9 remediate these findings before this plan can return to `COMPLETE`.

The second post-implementation review found that the trusted-audience fix is not wired through the production plugin. `openclaw.plugin.json` declares `stewardAuthorizationLedgerPath`, but the runtime config merge and plugin registration do not consume it; no stable steward instance audience is configured; and standalone CLI registration still synthesizes a random `instance:local-*` audience or derives the expected audience from the signed payload. As a result, tests that inject dependencies pass while the shipped command path can target the wrong ledger and lacks an independent audience anchor. Task 10 closes this production integration gap.

## Architecture Notes

### Secure bootstrap flow

```text
offline/maintainer:
  steward bootstrap-template
    --steward-id <minted-or-supplied>
    --audience <instance>
    --key-ref openpgp:<fingerprint>
    --public-key <certificate>
    --policy caps...
  -> canonical StewardBootstrapV1 JSON
  -> sign canonical JSON with the subject OpenPGP key outside FPP

target host, interactive:
  steward bootstrap-admit
    --payload <bootstrap.json>
    --signature <detached.asc>
    --expected-key-ref openpgp:<fingerprint>
  -> require stdin/stdout TTY
  -> display audience, steward id, policy caps, and fingerprint
  -> operator types a short fingerprint-derived confirmation
  -> verify expected fingerprint, public-key fingerprint, payload signature, audience, freshness
  -> one lock / one atomic ledger replacement:
       event 1: ledger_initialized
       event 2: key_binding_accepted
```

### Security boundaries

- The expected fingerprint must be a separate CLI argument and must not be silently derived from the untrusted payload.
- The confirmation phrase is a deliberate operator-attention control, not a CAPTCHA or cryptographic factor.
- The signed bundle binds policy caps so a local payload edit cannot silently weaken lifetime/use/clock-skew limits after offline signing.
- The ledger must never expose an initialized-but-unbound state on the secure path.
- Concurrent bootstrap attempts are first-valid-writer-wins under the existing lock; losers fail without modifying the ledger.
- Ledger emptiness and absence of policy must be checked inside the same acquired lock that commits genesis; no pre-lock observation may authorize an append.
- The target audience is an independent host input. Secure core admission never defaults it from the signed payload, and the CLI supplies the configured host audience by default.
- Both `PGP PRIVATE KEY BLOCK` and `PGP SECRET KEY BLOCK` armor are rejected before template output or admission; `subjectKey.algorithm` must agree with the parsed key-ref algorithm.
- Existing ledgers remain readable. Legacy `steward init` + `key-admit --accept-tofu` requires an explicit `--bootstrap-profile legacy-tofu` acknowledgement and emits a security warning. It is not the documented default.
- Tests inject TTY/prompt dependencies; production code must not fake TTY state from an environment variable.
- TTY/fingerprint confirmation remains an attention control. No claim that a local script “literally cannot” bootstrap is permitted without a future platform-specific external factor.

## Feature Inventory

| Existing surface | Required treatment | Task |
|---|---|---|
| `StewardKeyAttestationV1` / steward contract exports | Add `StewardBootstrapV1` that signs policy plus initial binding; preserve existing lifecycle schema | 1 |
| `StewardAuthorizationLedger.initialize()` | Add atomic two-event bootstrap transaction; preserve loading of existing V1 ledgers | 2 |
| `StewardRegistry.admitKeyAttestation()` initial TOFU branch | Add secure bootstrap verification path; retain explicit legacy TOFU only | 3 |
| CLI `steward init`, `key-template`, `key-admit --accept-tofu` | Keep as legacy profile with warnings; add secure `bootstrap-template` / `bootstrap-admit` commands | 4 |
| Steward authorization E2E and concurrency coverage | Prove no initialized-but-unbound state, expected-key enforcement, and one-winner concurrency | 5 |
| Architecture, troubleshooting, plugin guidance, and capability status | Make secure bootstrap the default documented path and preserve honest compromised-host limits | 6 |
| Atomic genesis transaction | Recheck empty state under lock, prevent stale contenders from mutating, and strengthen rename durability | 7 |
| Bootstrap input validation | Require host audience independently; reject all secret armor and key algorithm/ref mismatches | 8 |
| CLI/E2E assurance evidence | Exercise real command actions, legacy collision/no-write paths, and document the software-only ceiling | 9 |
| Production plugin configuration and CLI audience anchoring | Consume the configured ledger path, require a stable host audience for secure commands, and remove random/payload-derived expected-audience fallbacks | 10 |
| Post-rename durability failure | Report completed bootstrap after a directory-fsync error that occurs after atomic rename | 11 |

## Progress Tracking

- [x] Task 1: Define the signed steward bootstrap contract
- [x] Task 2: Add atomic ledger genesis with first binding
- [x] Task 3: Verify secure bootstrap in steward-auth-core
- [x] Task 4: Add the interactive secure bootstrap CLI
- [x] Task 5: Prove bootstrap race and compatibility behavior end to end
- [x] Task 6: Update operator guidance and canonical capability claims
- [x] Task 7: Make first-valid-writer genesis actually atomic
- [x] Task 8: Harden audience, key, and private-material validation
- [x] Task 9: Complete CLI/E2E evidence and assurance documentation
- [x] Task 10: Wire trusted steward configuration into production CLI registration
- [x] Task 11: Preserve committed bootstrap result after post-rename fsync failure

**Total Tasks:** 11 | **Completed:** 11 | **Remaining:** 0

## Implementation Tasks

### Task 1: Define the signed steward bootstrap contract

**Objective:** Create a canonical contract that binds local genesis policy and the first steward key into one externally signed payload.

**Files:**
- Modify: `packages/protocol-core/src/steward-authorization.ts`
- Modify: `packages/protocol-core/src/steward-authorization.test.ts`
- Modify: `packages/protocol-core/src/index.ts`

**Steps:**
1. RED: add schema tests for a valid `StewardBootstrapV1` containing a bootstrap ID, steward ID, audience, immutable policy caps, an `initial-bind` subject key, issuance time, and nonce.
2. RED: add rejection tests for mismatched nested steward/audience values, a non-`initial-bind` operation, malformed key refs, private-key material, invalid caps, unknown critical versions, and missing replay fields.
3. RED: add canonicalization tests proving changes to the expected key, audience, or any policy cap change the signed bytes/digest.
4. Run the focused protocol test and confirm it fails because the bootstrap schema/parser does not exist.
5. GREEN: add the TypeBox schema, parser, type exports, and canonical contract; reuse `StewardKeyAttestationV1` field rules where composition does not permit inconsistent duplicate values.
6. Ensure no private key is accepted or retained and no new signing implementation is added to protocol-core.
7. Run protocol-core tests, typecheck, and linter diagnostics.

**Definition of Done:**
- [x] Bootstrap bundle binds identity, key, audience, and all ledger caps
- [x] Only an initial binding is valid in the bundle
- [x] Malformed or inconsistent bundles fail closed
- [x] Existing steward lifecycle contracts remain compatible
- [x] Protocol-core tests and typecheck pass
- [x] No new linter errors

### Task 2: Add atomic ledger genesis with first binding

**Objective:** Ensure the secure path writes a fully initialized and initially bound ledger as one locked transaction with no observable intermediate state.

**Files:**
- Modify: `packages/steward-auth-core/src/ledger.ts`
- Modify: `packages/steward-auth-core/src/ledger.test.ts`

**Steps:**
1. RED: add ledger tests for `initializeWithInitialBinding()` (or equivalently named API) that writes exactly `ledger_initialized` followed by `key_binding_accepted` under one lock and returns the verified two-event chain.
2. RED: pause/fail the transaction before commit and assert no ledger file or initialized-only ledger becomes visible.
3. RED: run two concurrent initialization transactions and assert exactly one succeeds; the loser reports already initialized/lock held and cannot alter the winning chain.
4. RED: prove existing one-event initialized ledgers and current V1 event chains still load unchanged.
5. Run the focused ledger test and confirm failure because atomic two-event initialization is missing.
6. GREEN: generalize the existing transactional append internals so initialization and the validated first-binding event are committed through one temporary file, fsync, atomic replace, and restrictive-permission path.
7. Do not allow arbitrary event kinds or bypass unique attestation/nonce indexes through the new API.
8. Run steward-auth-core tests, typecheck, and linter diagnostics.

**Definition of Done:**
- [x] Secure genesis commits two valid events atomically
- [x] Failure never leaves initialized-only state
- [x] Concurrent bootstrap has one winner
- [x] Existing ledger formats remain readable
- [x] Unique attestation and nonce checks remain active
- [x] Steward-auth-core tests and typecheck pass
- [x] No new linter errors

### Task 3: Verify secure bootstrap in steward-auth-core

**Objective:** Verify expected fingerprint, OpenPGP proof of possession, signed policy, audience, freshness, and replay constraints before committing atomic genesis.

**Files:**
- Create: `packages/steward-auth-core/src/bootstrap-service.ts`
- Create: `packages/steward-auth-core/src/bootstrap-service.test.ts`
- Modify: `packages/steward-auth-core/src/steward-registry.ts`
- Modify: `packages/steward-auth-core/src/steward-registry.test.ts`
- Modify: `packages/steward-auth-core/src/index.ts`

**Steps:**
1. RED: add service tests for a valid detached-signature bootstrap whose independently supplied expected key equals both the payload key ref and parsed OpenPGP certificate fingerprint.
2. RED: reject expected-key mismatch, wrong signer, wrong audience, expired/future payload, replay, existing ledger, private-key material, invalid policy caps, and cleartext/detached envelope confusion.
3. RED: add a compatibility test proving ordinary post-genesis add/rotate/revoke behavior is unchanged.
4. Run the focused tests and confirm failure because the bootstrap verifier is absent.
5. GREEN: implement `StewardBootstrapService` using the existing signature backend registry and canonicalization; verify everything before invoking the atomic ledger API.
6. Refactor shared initial-binding application carefully so secure bootstrap and legacy TOFU produce the same in-memory steward state after valid admission without duplicating divergent lifecycle rules.
7. Mark legacy initial binding distinctly in retained event detail (`bootstrapProfile: "legacy-tofu"`); secure events record `bootstrapProfile: "interactive-fingerprint"` and the expected key reference without storing confirmation input.
8. Run steward-auth-core tests, typecheck, and linter diagnostics.

**Definition of Done:**
- [x] Independent expected fingerprint is mandatory on secure bootstrap
- [x] Subject key proves possession over the complete canonical bundle
- [x] Audience, time, nonce, and policy are validated before write
- [x] Secure and legacy genesis are distinguishable in audit evidence
- [x] Post-genesis key lifecycle behavior is unchanged
- [x] Steward-auth-core tests and typecheck pass
- [x] No new linter errors

### Task 4: Add the interactive secure bootstrap CLI

**Objective:** Make the secure ceremony the documented default while keeping legacy TOFU available only through an explicit, warned compatibility profile.

**Files:**
- Create: `plugin-trust/src/steward-bootstrap.ts`
- Create: `plugin-trust/src/steward-bootstrap.test.ts`
- Modify: `plugin-trust/src/steward-cli.ts`
- Modify: `plugin-trust/src/steward-cli.test.ts`

**Steps:**
1. RED: add command-registration and action tests for `bootstrap-template` and `bootstrap-admit`, including required payload/signature/expected-key options and dependency-injected prompt/TTY behavior.
2. RED: prove secure admission fails before ledger mutation when stdin or stdout is non-TTY, confirmation text is wrong, expected fingerprint is absent, or the operator declines.
3. RED: prove output displays the steward ID, audience, policy caps, and a normalized fingerprint before prompting, while never printing private key data or full signatures.
4. RED: prove `steward init` / initial `key-admit --accept-tofu` requires explicit `--bootstrap-profile legacy-tofu`, emits a high-visibility warning, and remains usable for existing automation only when deliberately selected.
5. Run focused CLI tests and confirm they fail because secure commands and interaction seams do not exist.
6. GREEN: implement canonical template emission and secure admission using `node:readline/promises` behind injectable `isInteractive` / `confirm` dependencies for tests.
7. Derive a short confirmation suffix from the normalized expected fingerprint; treat it only as operator attention, never as a secret or second factor.
8. Keep the plugin unable to access steward private keys; all signing remains external.
9. Run plugin-trust tests, typecheck, and linter diagnostics.

**Definition of Done:**
- [x] Secure bootstrap commands are registered and usable
- [x] Non-interactive secure bootstrap fails before any write
- [x] Expected fingerprint is supplied independently and explicitly confirmed
- [x] Legacy TOFU requires an explicit insecure profile and warning
- [x] CLI never signs or handles steward private keys
- [x] Plugin-trust tests and typecheck pass
- [x] No new linter errors

### Task 5: Prove bootstrap race and compatibility behavior end to end

**Objective:** Demonstrate that the secure ceremony eliminates the init/admit gap, detects hostile pre-initialization, and does not regress authorization consumption after genesis.

**Files:**
- Modify: `test/steward-operator-authorization-e2e.test.ts`
- Modify: `packages/enforcement-core/src/steward-coverage.test.ts`
- Test: `plugin-trust/pack-bundle.test.ts`

**Steps:**
1. RED: add an E2E secure-bootstrap fixture that signs a complete bundle, admits it interactively through injected confirmation, reloads the ledger, and asserts event 1/2 policy and key bindings.
2. RED: race two differently signed bundles against the same empty ledger and assert one winner, one failure, no mixed policy/key chain, and no initialized-only state.
3. RED: pre-initialize the ledger with an unexpected bundle and assert the intended operator gets a compromise/already-initialized failure rather than silently adding a second genesis key.
4. RED: verify wrong expected fingerprint cannot create operator coverage and secure bootstrap still enables required-only authorization consumption after successful genesis.
5. Run focused E2E and enforcement tests and confirm the secure-bootstrap cases fail before implementation.
6. GREEN: make only the minimal integration changes required by the new bootstrap service and CLI output; do not alter authorization scope or consumption precedence.
7. Verify the packed trust plugin includes the new bootstrap module and bundled steward-auth-core support.
8. Run focused tests, package suites, pack-bundle test, typechecks, and linter diagnostics.

**Definition of Done:**
- [x] Atomic bootstrap works across package boundaries
- [x] Concurrent hostile/intended bundles cannot mix
- [x] Unexpected pre-initialization is a visible failure
- [x] Wrong expected key never yields operator coverage
- [x] Required-only grant consumption remains intact
- [x] Packed artifact contains the secure bootstrap implementation
- [x] Target tests/typechecks pass with no new linter errors

### Task 6: Update operator guidance and canonical capability claims

**Objective:** Document the secure software baseline, legacy escape hatch, recovery procedure, and residual compromised-host risk without presenting TTY confirmation as strong MFA.

**Files:**
- Modify: `docs/architecture/steward-operator-authorization.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `plugin-trust/README.md`
- Modify: `docs/CAPABILITY_STATUS.md`

**Steps:**
1. Update the maintainer sequence to use `bootstrap-template` / external signing / `bootstrap-admit --expected-key-ref`.
2. Document how the expected fingerprint must be obtained independently, what the operator must inspect, and how to respond when a ledger already exists unexpectedly.
3. Label TTY/fingerprint confirmation as a software-only attention and race-hardening control, not protection against privileged malware.
4. Document the explicit `legacy-tofu` compatibility profile and discourage it for new deployments.
5. Keep OpenPGP steward authorization `PARTIAL`; narrow the gap text to distinguish secure local bootstrap from missing OOB/hardware and remote anti-rollback guarantees.
6. Cross-check every command against CLI tests and run documentation-safe checks for links/anchors.

**Definition of Done:**
- [x] Secure bootstrap is the primary documented workflow
- [x] Legacy TOFU is clearly labeled insecure compatibility behavior
- [x] Recovery guidance treats unexpected genesis as a compromise indicator
- [x] TTY confirmation is not marketed as MFA or malware resistance
- [x] Capability status remains conservative
- [x] No broken documentation links or new linter errors

### Task 7: Make first-valid-writer genesis actually atomic

**Objective:** Move the authoritative empty-ledger check inside the genesis transaction lock so a stale contender cannot append a second genesis pair or replace policy.

**Files:**
- Modify: `packages/steward-auth-core/src/ledger.ts`
- Modify: `packages/steward-auth-core/src/ledger.test.ts`

**Steps:**
1. RED: reproduce the reviewed stale-check schedule with a deterministic barrier: contender B observes empty, contender A commits, then B acquires the lock; assert B fails and the final ledger still contains exactly A’s two events and policy.
2. RED: assert the genesis transaction rejects any non-empty `tx.events` or existing `tx.policy` before its first append, including initialized-only legacy state.
3. RED: inject write/fsync/rename failures and assert no four-event or initialized-only chain becomes authoritative; verify parent-directory durability behavior where the platform supports it.
4. Run the focused ledger test and confirm the stale contender currently appends a second pair before returning failure.
5. GREEN: remove the security decision from the pre-lock snapshot; perform emptiness/policy checks inside the `transact()` callback while the lock is held.
6. GREEN: make the transaction callback append nothing on failed preconditions, and fsync the parent directory after atomic rename where supported.
7. Run steward-auth-core tests, typecheck, and linter diagnostics.

**Definition of Done:**
- [x] A stale contender cannot append or replace policy
- [x] Exactly one two-event genesis can exist
- [x] Losers fail before any durable mutation
- [x] Legacy initialized-only state fails with an explicit recovery diagnostic
- [x] Crash-durability behavior is tested and documented per platform
- [x] Steward-auth-core tests/typecheck pass with no new linter errors

### Task 8: Harden audience, key, and private-material validation

**Objective:** Require bootstrap values to agree with independent host configuration and reject inconsistent key metadata or any recognized OpenPGP secret-key armor before output or admission.

**Files:**
- Modify: `packages/protocol-core/src/steward-authorization.ts`
- Modify: `packages/protocol-core/src/steward-authorization.test.ts`
- Modify: `packages/steward-auth-core/src/bootstrap-service.ts`
- Modify: `packages/steward-auth-core/src/bootstrap-service.test.ts`
- Modify: `plugin-trust/src/steward-cli.ts`
- Modify: `plugin-trust/src/steward-cli.test.ts`
- Modify: `plugin-trust/src/steward-bootstrap.test.ts`

**Steps:**
1. RED: prove `PGP PRIVATE KEY BLOCK` and `PGP SECRET KEY BLOCK` payloads are rejected by schema parsing and CLI template generation before material is printed or written.
2. RED: reject `subjectKey.algorithm` values that do not equal the algorithm parsed from `subjectKey.keyRef`.
3. RED: call `StewardBootstrapService.admitBootstrap()` without `expectedAudience` and assert it fails rather than trusting `bootstrap.audience`.
4. RED: prove `bootstrap-admit` supplies the configured host `defaultAudience` when the option is omitted and rejects payload/policy audiences that differ from it.
5. Run focused protocol, steward-core, and CLI tests and confirm the current payload default and armor checks fail these cases.
6. GREEN: centralize secret-armor detection for both private/secret block labels and enforce key algorithm/ref consistency in protocol parsing.
7. GREEN: make expected audience mandatory in the core API; source it from trusted host configuration in the CLI, with explicit override only when independently supplied by the operator.
8. Run affected package tests, typechecks, and linter diagnostics.

**Definition of Done:**
- [x] Secure core admission never derives expected audience from the payload
- [x] Cross-instance bootstrap replay fails by default
- [x] Both private and secret OpenPGP armor forms fail before output/admission
- [x] Key algorithm and key-ref algorithm must agree
- [x] Existing valid public-key bootstrap bundles remain compatible
- [x] Target tests/typechecks pass with no new linter errors

### Task 9: Complete CLI/E2E evidence and assurance documentation

**Objective:** Exercise the actual command actions and document that the completed remediation is a software-only local bootstrap, with stronger presence factors deferred per platform.

**Files:**
- Modify: `plugin-trust/src/steward-cli.test.ts`
- Modify: `test/steward-operator-authorization-e2e.test.ts`
- Modify: `plugin-trust/pack-bundle.test.ts`
- Modify: `docs/architecture/steward-operator-authorization.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `plugin-trust/README.md`
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `docs/ROADMAP.md`

**Steps:**
1. RED: drive the real `bootstrap-template` and `bootstrap-admit` action callbacks through valid, non-TTY, wrong-answer, explicit-decline, wrong-audience, wrong-key, pre-existing-ledger, and legacy-init-only scenarios; assert every failure leaves the ledger unchanged.
2. RED: update E2E coverage to pass through the CLI action rather than separately invoking the prompt helper and bootstrap service.
3. RED: assert output never reveals signature/private material and that packed artifacts contain the remediated validator/service/CLI modules.
4. Run focused CLI/E2E/pack tests and confirm the missing action-level cases fail before remediation.
5. GREEN: add only the command integration and diagnostics required by those tests; do not add a pseudo-security CAPTCHA or claim the confirmation suffix is secret.
6. Document the software-only assurance ceiling and add a deferred roadmap item for separately designed FIDO2/WebAuthn, OOB second-device, and OS-auth profiles; record the user-confirmed platform-specific scope boundary.
7. Keep capability status `PARTIAL` and state that privileged local compromise remains outside this profile.
8. Run focused tests, affected package suites, E2E, pack-bundle, typecheck, build, and linter diagnostics.

**Definition of Done:**
- [x] Real CLI actions are covered end to end
- [x] Every rejected ceremony is proven no-write
- [x] Legacy collisions produce explicit recovery guidance
- [x] Packaged code contains all remediation
- [x] Software-only assurance is not described as non-scriptable or MFA
- [x] Platform-specific stronger factors are deferred explicitly
- [x] Target tests/build/typecheck pass with no new linter errors

### Task 10: Wire trusted steward configuration into production CLI registration

**Objective:** Make the production trust-plugin path use the configured steward ledger and a stable, independently trusted host audience, with no random or signed-payload fallback for secure bootstrap admission.

**Files:**
- Modify: `packages/trust-core/src/create-trust-stack.ts`
- Modify: `packages/trust-core/src/create-trust-stack.path.test.ts`
- Modify: `plugin-trust/openclaw.plugin.json`
- Modify: `plugin-trust/src/index.ts`
- Modify: `plugin-trust/src/index.test.ts`
- Modify: `plugin-trust/src/config.test.ts`
- Modify: `plugin-trust/src/cli.ts`
- Modify: `plugin-trust/src/steward-cli.ts`
- Modify: `plugin-trust/src/steward-cli.test.ts`
- Modify: `plugin-trust/README.md`
- Modify: `docs/architecture/steward-operator-authorization.md`

**Steps:**
1. RED: initialize the real plugin with non-default `stewardAuthorizationLedgerPath` and `stewardInstanceAudience`; capture CLI registration and assert both resolved values reach `registerStewardCli`.
2. RED: invoke secure `bootstrap-template` and `bootstrap-admit` through production registration without a configured audience or explicit `--audience`; assert a clear configuration error occurs before template emission, signature verification, prompting, or ledger writes.
3. RED: supply a signed payload audience without a trusted configured/explicit audience and assert admission fails; prove a random `instance:local-*` audience is never minted.
4. RED: configure relative and absolute ledger paths and assert they resolve through the same workspace-safe configuration semantics as other trust-core paths.
5. RED: add manifest/config contract tests requiring `stewardAuthorizationLedgerPath` and `stewardInstanceAudience` to be recognized consistently, without silently inventing a global default audience.
6. Run focused trust-config/plugin/CLI tests and confirm the current production registration omits both dependencies and falls back to random or payload-derived audience data.
7. GREEN: extend merged trust configuration with the steward ledger path and optional stable instance audience, validate non-empty audience syntax, and pass both values from `initStack()` through `registerFppTrustCli()` to `registerStewardCli()`.
8. GREEN: remove random audience minting and all secure-path fallback to `loaded.policy.instanceAudience`; require trusted host configuration or an independently supplied CLI option. Keep legacy TOFU behavior explicitly profile-gated.
9. Update operator documentation with the exact plugin keys and explain that the instance audience is a stable deployment identifier, not a secret or a new presence factor.
10. Run focused suites, trust/plugin package suites, pack-bundle tests, typecheck, build, and linter diagnostics.

**Definition of Done:**
- [x] Production plugin registration uses the configured steward ledger path
- [x] Secure bootstrap commands use a stable configured or independently supplied host audience
- [x] Signed payload data is never used as its own expected audience
- [x] No random audience is generated for secure bootstrap
- [x] Manifest, runtime config, CLI wiring, and documentation agree on both keys
- [x] Focused and affected tests, pack checks, build, and typechecks pass with no new linter errors

### Task 11: Preserve committed bootstrap results after post-rename durability failure

**Objective:** Avoid reporting a secure bootstrap as failed after its atomic ledger replacement has already committed, while retaining fail-closed behavior for every pre-rename write, file-fsync, or rename failure.

**Files:**
- Modify: `packages/steward-auth-core/src/ledger.ts`
- Modify: `packages/steward-auth-core/src/ledger.test.ts`

**Steps:**
1. RED: inject a parent-directory fsync failure after rename and assert secure genesis returns a committed result whose ledger verifies.
2. GREEN: distinguish post-rename directory-fsync failure from pre-commit durability failures so callers do not retry a committed ceremony as if it failed.
3. Run focused steward ledger tests, package typecheck, and linter diagnostics.

**Definition of Done:**
- [x] Post-rename parent-directory fsync failure does not report an uncommitted bootstrap
- [x] Pre-rename write, file-fsync, and rename failures remain no-publish failures
- [x] Focused steward tests and typecheck pass with no new linter errors

## Testing Strategy

### RED evidence

```bash
npx tsx --test packages/protocol-core/src/steward-authorization.test.ts
npx tsx --test packages/steward-auth-core/src/ledger.test.ts
npx tsx --test packages/steward-auth-core/src/bootstrap-service.test.ts
npx tsx --test plugin-trust/src/steward-bootstrap.test.ts plugin-trust/src/steward-cli.test.ts
npx tsx --test test/steward-operator-authorization-e2e.test.ts
```

Each new test must fail because the secure bootstrap contract, atomic write, verifier, or command is missing—not because OpenPGP fixtures, TTY injection, or temporary paths are malformed.

### GREEN and regression evidence

```bash
npm test -w @ovrsr/fpp-protocol-core
npm test -w @ovrsr/fpp-steward-auth-core
npm test -w @ovrsr/fpp-enforcement-core
npm test -w @ovrsr/openclaw-fpp-trust
npx tsx --test test/steward-operator-authorization-e2e.test.ts
npm run typecheck
npm run build:core
```

Concurrency tests must use barriers/deferred promises or isolated processes, not timing-only sleeps. Tests must inspect the final verified ledger chain, not only CLI exit codes.

## Risks & Mitigations

- **TTY presented as human identity proof:** State explicitly that TTY confirmation is an attention control. Per the user’s 2026-07-20 decision, OOB, hardware, and OS-auth factors require separate platform-specific work.
- **Policy changed after offline signing:** Include all immutable policy caps in the signed bootstrap bundle.
- **Stale genesis precheck:** Verify cryptography before the transaction, but decide ledger emptiness only after acquiring the same lock used for the two-event commit.
- **Fingerprint sourced from attacker payload:** Require `--expected-key-ref` separately and compare it with both payload and parsed certificate.
- **Breaking existing deployments:** Preserve loading and post-genesis operation of current ledgers; gate legacy creation behind an explicit compatibility profile.
- **Private-key exposure:** Reject both OpenPGP `PRIVATE KEY` and `SECRET KEY` armor before template output or admission.
- **False irreversibility claims:** Document explicit wipe/restore recovery and the audit discontinuity it creates; do not call a hostile genesis the constitution itself.
- **Test-only dependency wiring masks production failure:** Exercise plugin initialization and capture the actual CLI dependency object instead of testing only direct helper registration.
- **Audience circularity:** Never accept the signed bootstrap payload as the source of the value against which its audience is checked.
- **Unstable deployment identity:** Require configuration or an explicit operator argument; do not synthesize a random audience that changes between invocations.

## Handoff

All implementation tasks are complete. Run:

`/verify docs/plans/2026-07-20-2-steward-genesis-bootstrap-hardening.md`
