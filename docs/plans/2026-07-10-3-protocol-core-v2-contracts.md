# Protocol Core and Versioned V2 Contracts

**Status:** COMPLETE
**Created:** 2026-07-10
**Scope:** In: a shared versioned protocol-core package, canonical serialization, Merkle primitives, key-bound identity, versioned claim classes, freshness envelopes, receipt/capsule/adoption schemas, and legacy-v1 parsing. Out: runtime policy changes, replay-cache persistence, receipt emission, trust scoring, governance ratification, and release publication itself.

## Summary

Create `@ovrsr/fpp-protocol-core` as the single source of schemas and cryptographic contracts used by the enforcement and trust plugins. V2 contracts will be explicit, key-bound, freshness-capable, and versioned. Legacy v1 data remains parseable but is labeled `declaration-only`; it is never silently upgraded into stronger evidence.

The package will use pure JavaScript/TypeScript dependencies because OpenClaw installs plugin dependencies with `--ignore-scripts`. Local development will use npm workspaces, while published plugins will depend on an exact released core version.

This is Plan 3 of 7. It depends on Plan 2’s CI and test foundation.

## Architecture Notes

- Package name: `@ovrsr/fpp-protocol-core`.
- Package location: `packages/protocol-core/`.
- Package version and protocol schema version are separate; initial package `1.0.0` carries schema version `2`.
- V1 canonicalization and Merkle verification remain available for historical logs.
- V2 uses an RFC 8785-compatible canonical JSON representation and domain-separated hashes.
- V2 agent IDs use a full key fingerprint (`fpp:ed25519:<sha256-public-key>`) and may carry a legacy alias.
- Runtime validation uses shared schemas; TypeScript types alone are insufficient for untrusted peer input.
- Published plugins pin the exact core version to prevent silent protocol drift.

## Feature Inventory

This is a migration/refactor. Every duplicated or replaced function is mapped below.

| Old file/function or contract | New destination | Task |
|---|---|---|
| `plugin-trust/src/claims.ts::canonicalize` | `packages/protocol-core/src/canonical-json.ts` legacy/v2 APIs | Task 2 |
| `scripts/audit-append.ts::canonicalize` | Shared legacy canonicalizer | Task 2 |
| `scripts/audit-verify.ts::canonicalize` | Shared legacy canonicalizer | Task 2 |
| `plugin/src/audit-log.ts::canonicalize` | Shared legacy canonicalizer until receipt-v2 migration | Task 2 |
| `scripts/audit-append.ts::hashEntry` | Shared versioned entry digest | Task 2 |
| `scripts/audit-verify.ts::hashEntry` | Shared versioned entry digest | Task 2 |
| `plugin/src/audit-log.ts::hashEntry` | Shared versioned entry digest | Task 2 |
| `scripts/merkle.ts::{computeMerkleRoot,createMerkleProof,verifyMerkleProof}` | `packages/protocol-core/src/merkle.ts` | Task 3 |
| `plugin-trust/src/merkle-bridge.ts` duplicate Merkle primitives | Shared Merkle implementation; bridge retains file I/O only | Tasks 3 and 8 |
| `plugin-trust/src/identity.ts::deriveAgentId` | `packages/protocol-core/src/identity.ts` full key fingerprint plus legacy alias | Task 4 |
| `plugin-trust/src/identity.ts::verifySignature` | Shared Ed25519 verification primitive | Task 4 |
| `plugin-trust/src/claims.ts::{SignedClaim,signClaim,verifyClaim}` | Versioned envelope signing and verification APIs | Tasks 4 and 5 |
| `plugin-trust/src/handshake.ts::ConstitutionalClaim` | `LegacyConstitutionalClaimV1` and `ConstitutionalClaimV2` schemas | Task 5 |
| Ad hoc claim meaning in `plugin-trust/src/tools.ts` and `cli.ts` | Shared claim-class discriminator and parser | Tasks 5 and 8 |
| No freshness contract | Shared challenge, audience, issue/expiry, and replay-key schemas | Task 6 |
| No receipt schema | Shared `ConformanceReceiptV1` schema | Task 7 |
| No trust-state capsule schema | Shared `TrustStateCapsuleV2` schema | Task 7 |
| Markdown-only adoption states | Shared `AdoptionStateRecordV1` schema | Task 7 |
| Unversioned evidence objects in handshake/trust graph | Shared evidence envelope and claim-class vocabulary | Task 7 |
| Three independent package installs/lockfiles | Workspace development with one resolved dependency graph; release packages remain independent | Tasks 1 and 9 |
| Existing plugin package imports and build output | Exact core dependency and package-contained entry points | Tasks 8 and 9 |

No listed feature is intentionally removed. Legacy verification remains read-only and version-labeled.

## Progress Tracking

- [x] Task 1: Establish the workspace and protocol-core package
- [x] Task 2: Centralize canonical JSON and versioned digests
- [x] Task 3: Centralize legacy and v2 Merkle primitives
- [x] Task 4: Define key-bound agent identity and signing
- [x] Task 5: Define versioned claim envelopes and legacy migration
- [x] Task 6: Define freshness and replay contracts
- [x] Task 7: Define receipt, capsule, adoption, and evidence schemas
- [x] Task 8: Migrate both plugins and root scripts to shared contracts
- [x] Task 9: Harden package build, install, and release ordering

**Total Tasks:** 9 | **Completed:** 9 | **Remaining:** 0

## Implementation Tasks

### Task 1: Establish the workspace and protocol-core package

**Objective:** Add a buildable, testable, publishable shared package without breaking independent plugin installation.

**Files:**
- Create: `packages/protocol-core/package.json`
- Create: `packages/protocol-core/tsconfig.json`
- Create: `packages/protocol-core/src/index.ts`
- Create: `packages/protocol-core/src/index.test.ts`
- Create: `packages/protocol-core/README.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `plugin/package.json`
- Modify: `plugin-trust/package.json`
- Migrate or remove after verification: `plugin/package-lock.json`
- Migrate or remove after verification: `plugin-trust/package-lock.json`

**Steps:**
1. Write a failing package-export test that imports the planned public surface (RED).
2. Configure npm workspaces for the core package and both plugins (GREEN).
3. Add strict TypeScript, build, typecheck, and test scripts to the core package.
4. Pin exact core versions in plugin manifests while allowing workspace linking for local development.
5. Regenerate the resolved lockfile and prove each plugin can still be packed and installed independently.

**Definition of Done:**
- [ ] Core package builds, typechecks, and tests
- [ ] Both plugins resolve the local workspace package
- [ ] Published package metadata uses an exact core version
- [ ] Lockfile migration is complete and documented

### Task 2: Centralize canonical JSON and versioned digests

**Objective:** Replace four drift-prone canonicalizers while preserving verification of all historical v1 chains.

**Files:**
- Create: `packages/protocol-core/src/canonical-json.ts`
- Create: `packages/protocol-core/src/canonical-json.test.ts`
- Create: `packages/protocol-core/src/digest.ts`
- Create: `packages/protocol-core/src/digest.test.ts`
- Modify: `plugin-trust/src/claims.ts`
- Modify: `plugin/src/audit-log.ts`
- Modify: `scripts/audit-append.ts`
- Modify: `scripts/audit-verify.ts`

**Steps:**
1. Add failing compatibility vectors for current v1 output and RFC 8785 edge cases for v2 (RED).
2. Implement explicit `canonicalizeV1`, `canonicalizeV2`, and domain-separated digest APIs (GREEN).
3. Migrate existing v1 verification call sites without changing historical hashes.
4. Require an explicit version argument for all new digests.
5. Run existing audit and claim tests plus cross-package vectors.

**Definition of Done:**
- [ ] Historical v1 fixtures produce identical hashes
- [ ] V2 canonicalization passes standard edge cases
- [ ] No private canonicalizer remains in migrated files
- [ ] Digest domains prevent cross-type hash reuse

### Task 3: Centralize legacy and v2 Merkle primitives

**Objective:** Use one tested Merkle implementation while preserving old proofs and adding domain separation for v2 trees.

**Files:**
- Create: `packages/protocol-core/src/merkle.ts`
- Create: `packages/protocol-core/src/merkle.test.ts`
- Modify: `scripts/merkle.ts`
- Modify: `scripts/audit-proof.ts`
- Modify: `plugin-trust/src/merkle-bridge.ts`
- Modify: `plugin-trust/src/merkle-bridge.test.ts`

**Steps:**
1. Add failing cross-implementation vectors proving the current two implementations agree (RED).
2. Implement legacy-v1 and domain-separated-v2 Merkle APIs in core (GREEN).
3. Convert `scripts/merkle.ts` to compatibility re-exports or remove it only after all imports migrate.
4. Keep `MerkleBridge` focused on file selection and leaf extraction.
5. Verify old proofs and new v2 proofs independently.

**Definition of Done:**
- [ ] Existing proof fixtures remain valid
- [ ] V2 leaves and internal nodes use distinct domains
- [ ] Root scripts and trust plugin use the same implementation
- [ ] Cross-package tests pass

### Task 4: Define key-bound agent identity and signing

**Objective:** Make an agent identifier cryptographically derivable from its signing key and retain legacy aliases only for migration/display.

**Files:**
- Create: `packages/protocol-core/src/identity.ts`
- Create: `packages/protocol-core/src/identity.test.ts`
- Modify: `plugin-trust/src/identity.ts`
- Modify: `plugin-trust/src/identity.test.ts`
- Modify: `plugin-trust/src/claims.ts`
- Modify: `plugin-trust/src/claims.test.ts`

**Steps:**
1. Add failing tests for mismatched agent ID/public key, truncated-ID collision avoidance, malformed key length, and deterministic fingerprints (RED).
2. Implement the full Ed25519 fingerprint identifier and legacy alias derivation (GREEN).
3. Make signing envelopes include the v2 identifier and key algorithm.
4. Make verification recompute and compare the identifier before checking trust semantics.
5. Keep legacy IDs parseable but never treat an alias as independent proof of identity.

**Definition of Done:**
- [ ] A mismatched ID/key claim is rejected
- [ ] V2 IDs use the full fingerprint
- [ ] Legacy aliases are explicitly labeled
- [ ] Existing local keys migrate without regeneration

### Task 5: Define versioned claim envelopes and legacy migration

**Objective:** Parse untrusted claim input into explicit v1 or v2 types and prevent legacy declarations from inheriting v2 assurance.

**Files:**
- Create: `packages/protocol-core/src/claims.ts`
- Create: `packages/protocol-core/src/claims.test.ts`
- Modify: `plugin-trust/src/claims.ts`
- Modify: `plugin-trust/src/handshake.ts`
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/cli.ts`

**Steps:**
1. Add failing tests for unknown versions, malformed fields, extra critical fields, v1 parsing, and v1-to-v2 non-escalation (RED).
2. Implement runtime schemas for `LegacyConstitutionalClaimV1`, `ConstitutionalClaimV2`, and signed envelopes (GREEN).
3. Add claim classes for identity, configuration, runtime, event, completeness, and behavioral assertions.
4. Return structured migration diagnostics instead of casting parsed JSON.
5. Keep v1 accepted only as `declaration-only` input for the compatibility window.

**Definition of Done:**
- [ ] Untrusted JSON is runtime-validated
- [ ] Unknown critical versions fail closed
- [ ] V1 claims are labeled declaration-only
- [ ] Claim classes are machine-readable

### Task 6: Define freshness and replay contracts

**Objective:** Standardize challenge-response fields so Plan 4 can enforce freshness consistently.

**Files:**
- Create: `packages/protocol-core/src/freshness.ts`
- Create: `packages/protocol-core/src/freshness.test.ts`
- Modify: `packages/protocol-core/src/claims.ts`
- Modify: `packages/protocol-core/src/index.ts`

**Steps:**
1. Add failing tests for missing audience, reused nonce keys, invalid issue/expiry ordering, excessive lifetime, and clock-skew boundaries (RED).
2. Define challenge, audience, issued-at, expiry, and replay-key schemas (GREEN).
3. Specify maximum validity and allowed skew as verifier policy inputs, not signer-controlled values.
4. Bind freshness fields into the signed canonical payload.
5. Export pure validation helpers without implementing persistence.

**Definition of Done:**
- [ ] Freshness fields are signed
- [ ] Replay keys are deterministic and collision-resistant
- [ ] Policy limits are verifier-controlled
- [ ] Runtime cache behavior remains deferred to Plan 4

### Task 7: Define receipt, capsule, adoption, and evidence schemas

**Objective:** Create stable contracts for the not-yet-implemented evidence features without claiming they are emitted or enforced.

**Files:**
- Create: `packages/protocol-core/src/receipts.ts`
- Create: `packages/protocol-core/src/receipts.test.ts`
- Create: `packages/protocol-core/src/capsules.ts`
- Create: `packages/protocol-core/src/capsules.test.ts`
- Create: `packages/protocol-core/src/adoption.ts`
- Create: `packages/protocol-core/src/adoption.test.ts`
- Create: `packages/protocol-core/src/evidence.ts`
- Create: `packages/protocol-core/src/evidence.test.ts`
- Modify: `packages/protocol-core/src/index.ts`

**Steps:**
1. Add failing valid/invalid vectors for every planned schema (RED).
2. Define conformance receipts linking action digest, policy, disposition, authorization, and outcome (GREEN).
3. Define trust-state capsules with runtime identifiers, evidence roots, coverage, freshness, and signature.
4. Define reviewed/accepted/externally-enforced/inherited/revoked/forked/superseded adoption records.
5. Define append-only evidence envelopes and correction references without embedding a global trust score.

**Definition of Done:**
- [ ] All planned contracts have runtime schemas
- [ ] Receipt and capsule fields bind implementation versions
- [ ] Adoption states are not Boolean
- [ ] Evidence supports later annotation without history deletion

### Task 8: Migrate both plugins and root scripts to shared contracts

**Objective:** Remove duplicated protocol logic and prove interoperability across package boundaries.

**Files:**
- Modify: `plugin/src/audit-log.ts`
- Modify: `plugin/src/index.ts`
- Modify: `plugin-trust/src/claims.ts`
- Modify: `plugin-trust/src/identity.ts`
- Modify: `plugin-trust/src/handshake.ts`
- Modify: `plugin-trust/src/merkle-bridge.ts`
- Modify: `scripts/audit-append.ts`
- Modify: `scripts/audit-verify.ts`
- Modify: `scripts/audit-proof.ts`
- Create: `test/protocol-core-interoperability.test.ts`
- Modify: `package.json`

**Steps:**
1. Add failing end-to-end vectors produced by one package and verified by another (RED).
2. Replace local primitives and contract casts with core imports (GREEN).
3. Retain compatibility wrappers only where external imports require them.
4. Verify root audit proofs, enforcement entries, and trust claims across package boundaries.
5. Run aggregate typecheck, test, coverage, and pack verification.

**Definition of Done:**
- [ ] All feature-inventory rows are migrated
- [ ] Cross-package vectors pass
- [ ] V1 data remains verifiable
- [ ] No duplicate normative primitive remains

### Task 9: Harden package build, install, and release ordering

**Objective:** Ensure the core package is built and available before either independently installable plugin is packed or published.

**Files:**
- Modify: `scripts/clawhub-publish.sh`
- Modify: `scripts/verify-pack.sh`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `plugin/package.json`
- Modify: `plugin-trust/package.json`
- Modify: `.clawhubignore`
- Modify: `docs/RELEASE_ASSURANCE.md`
- Modify: `docs/COMPATIBILITY.md`

**Steps:**
1. Add failing dry-run tests for missing core build, version mismatch, and wrong publish order (RED).
2. Build/test/pack the core package before consumers (GREEN).
3. Require exact core dependency versions in published plugin manifests.
4. Install each plugin tarball in an isolated directory using `--ignore-scripts` and prove all runtime imports resolve.
5. Document release order, rollback, and compatibility policy.

**Definition of Done:**
- [ ] Core version mismatch blocks packaging
- [ ] Isolated plugin installs resolve the core dependency
- [ ] Publish dry run orders core before consumers
- [ ] Release and rollback procedures are documented

## Testing Strategy

- Use normative JSON vectors shared by root, core, enforcement, and trust tests.
- Preserve explicit v1 fixtures before refactoring any canonicalization or Merkle code.
- Test untrusted JSON at runtime; TypeScript compile-time types are not evidence.
- Pack and install artifacts in isolated directories with lifecycle scripts disabled.
- Run the aggregate verification command from Plan 2 after every migration task.

## Risks & Mitigations

- **Risk:** Workspace migration breaks independent packages.
  **Mitigation:** Exact published dependencies plus isolated tarball-install tests.
- **Risk:** New canonicalization invalidates historical logs.
  **Mitigation:** Keep explicit v1 algorithms and golden vectors indefinitely.
- **Risk:** A shared package becomes a new supply-chain dependency.
  **Mitigation:** Exact versions, SBOMs, package checksums, and later signed release manifests.
- **Risk:** V1 input is silently trusted as v2.
  **Mitigation:** Distinct runtime types and a declaration-only migration result.
