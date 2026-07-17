# Emergency Override Tier + Config-Drift Diagnostics

**Status:** VERIFIED
**Created:** 2026-07-17
**Depends on:** Plan 8 (unattended disposition + emergency ledger seam), Plan 9 (quorum / steward eligibility), Plan 10 (core extraction)
**Scope:**
- **In:** Wire the dead `emergencyCriteriaMet` input via a signed, steward-only, time-boxed, budgeted `SignedEmergencyOverrideV1`; MCP submit tool that never signs; distinguishable abstain reasons when an override is present but rejected; non-fatal startup diagnostics for unattended+approvalOn without standing-allow coverage and for unreachable quorum eligibility/threshold configs; remediate ClawHub enforcement-plugin security-audit findings (authorization-class secret-literal false positives; raise OpenClaw compat floor above known-vulnerable `<=2026.3.24`).
- **Out (confirmed):** Changing any live deployment config (`dispositionMode`, `quorumStewardEligibleIds`, etc.); promoting emergency above staged in the disposition ladder; peer-issued emergency overrides; adding a separate `emergencyOverrideIssuerIds` list; probing `fpp-mandates.json` at config-merge time; ClawHub publish; renaming the on-wire `authorization` receipt field (wire format stays stable).

## Summary

Plan 8 left emergency as an output-only seam: `resolveDisposition` can return `allow_minimal` and `onBeforeToolCall` writes `EmergencyReviewLedger`, but nothing ever sets `emergencyCriteriaMet: true`. This plan adds a mandate-shaped (but mandate-separate) signed override grant, a submit-only MCP tool, and adapter wiring so the tier is reachable under steward control — never via agent self-signature.

Separately, a housekeeping reinstall can silently restore bare defaults (`dispositionMode: "unattended"`, empty quorum eligible IDs, threshold 2) with no warning, making human oversight structurally unreachable. This plan adds loud, non-fatal config-shape diagnostics so that footgun is visible at startup.

Also folds two ClawHub enforcement-plugin audit findings: (1) static `suspicious.exposed_secret_literal` hits on `authorization: "standing-allowlist"` — false positives on authorization-*class* literals, remodeled via named constants so scanners stop treating them as API tokens; (2) `openclaw.compat.minGatewayVersion` / peerDependency still allow `2026.3.24-beta.2`, which sits inside the GHSA-affected range (`<=2026.3.24`) — raise the floor to a patched release.

## Locked design choices (2026-07-17)

| ID | Choice |
|----|--------|
| A | New `SignedEmergencyOverrideV1` in protocol-core — parallel to mandate, not a new `issuerClass` |
| B | Separate store file `fpp-emergency-overrides.json` (sibling of mandate store) with unsigned budget ledger |
| C | Issuer allowlist = `quorumStewardEligibleIds`; always also reject local agent identity key (hardcoded second check + comment) |
| D | Stewards only for v1 (doc comment: peer escalation is a larger separate decision) |
| E | MCP `fpp_emergency_override_submit` in plugin-trust — accepts already-signed JSON; never signs |
| F | `onBeforeToolCall` computes coverage → `emergencyCriteriaMet`; debit on `allow_minimal` |
| G | Keep ladder order; hard-floor still wins; **addition:** rejected overrides get distinguishable abstain audit reasons |
| H | Warn from config shape only (`unattended` + `approvalOn` not covered by `standingAllowOn`); wording notes live mandates are out of scope of the check |
| I | Quorum unreachable diagnostics in trust `mergeTrustConfig` |
| J | Unconditional quorum warns (threshold > eligible count, or empty eligible IDs) — not gated on enforcement `dispositionMode` |
| K | ClawHub `suspicious.exposed_secret_literal` on `authorization: "standing-allowlist"` — **false positive**; fix by named `AUTHZ` constants + property shorthand (no wire rename) |
| L | Raise OpenClaw floor to **`>=2026.3.28`** (first release that patches the later Mar-2026 gateway GHSAs; `2026.3.25` only covers the earlier set). Update both plugins’ `compat` + `peerDependencies` + `docs/COMPATIBILITY.md` |

## Architecture Notes

```text
Steward signs SignedEmergencyOverrideV1 out-of-band
  → agent: fpp_emergency_override_submit(signedJson)   [trust plugin; never signs]
  → verify: signature + issuer∈quorumStewardEligibleIds + issuer≠localAgent
  → persist: fpp-emergency-overrides.json (+ unsigned ledger)

onBeforeToolCall (enforcement):
  classify → mandate/standing → … → emergency store lookup
    hit + valid     → emergencyCriteriaMet=true → allow_minimal → debit + review ledger
    hit + rejected  → emergencyOverrideRejected="<kind>" → abstain with forensic reason
    miss            → abstain (existing generic reason)
```

**Canonical ladder (unchanged):** hard-floor → mandate/standing-allow → staged → quorum → emergency → abstain.

**Eligibility split:**
- **Admission (submit tool):** full steward allowlist + self-key reject.
- **Consumption (`findCoverage`):** crypto + validity window + scope + budget + **self-key reject** (load local pubkey from `identityKeyPath`). Optional re-check of `stewardEligibleIds` when the store is constructed with them (trust submit always passes them; enforcement may omit and rely on admission + self-key — same filesystem trust assumption as planted mandates).

**Self-key comment (required):** one-line note that the local-agent rejection is intentional defense-in-depth even when the allowlist should already exclude it — it is the last line between "emergency override" and "agent self-escalation" under allowlist misconfiguration.

**Peer exclusion comment (required):** stewards-only because agent-to-agent escalation without steward involvement is a materially larger trust decision; not an oversight.

**Diagnostics:**
- Enforcement `diagnoseConfigSafety` / `mergeConfigWithDiagnostics`: `UNATTENDED_APPROVAL_WITHOUT_STANDING_ALLOW` (warn) when `dispositionMode === "unattended"` and any `approvalOn` id is absent from `standingAllowOn`. Detail must state this does **not** account for live mandates — see `fpp-mandates.json` / `fpp_mandate_*` for runtime coverage.
- Trust `mergeTrustConfig`: warn when `quorumStewardEligibleIds.length === 0` or `quorumPeerEligibleIds.length === 0`; warn when `quorumStewardThreshold > quorumStewardEligibleIds.length` or peer equivalent. Emit via existing `migrationDiagnostics` **and** `console.warn` once at merge (same loudness bar as enforcement `FPP CONFIG …` lines). No cross-plugin read of `dispositionMode`.

**Package paths:** `packages/protocol-core`, `packages/enforcement-core`, `packages/trust-core`, `plugin/`, `plugin-trust/` (npm `@ovrsr/fpp-*`).

**ClawHub audit remediation (K/L):**
- Evidence at `disposition-engine.ts:102` / `mandate-store.ts:318` is the literal `"standing-allowlist"` assigned to property `authorization`. Scanners treat `authorization: "<string>"` as an API-token pattern. Runtime values remain the same `AuthorizationClass` strings on the wire.
- Pattern: export `AUTHZ` (or equivalent) from protocol-core keyed off `AUTHORIZATION_CLASSES`; call sites use `const authorization = AUTHZ.standingAllowlist` then `{ authorization }` shorthand (or `authorization: AUTHZ.standingAllowlist`) so dist JS has no `authorization: "<literal>"` adjacent pair. Apply to all disposition-engine / mandate-store authorization class assignments, not only the two flagged lines (prevents the next scan from hopping to `authorization: "approved"` etc.).
- OpenClaw floor: `plugin/` and `plugin-trust/` currently declare `minGatewayVersion` / `pluginApi` / `peerDependencies.openclaw` as `2026.3.24-beta.2` — inside affected `<=2026.3.24` (GHSA-qm2m-28pf-hgjw, GHSA-fqw4-mph7-2vr8, GHSA-9hjh-fr4f-gxc4, GHSA-6xg4-82hv-cp6f, GHSA-f44p-c7w9-7xr7). Raise to `>=2026.3.28` / `2026.3.28`. DevDependency may stay on the newer pin already in use (`^2026.6.11`).

## Feature Inventory

Not a migration/replacement of existing public APIs. Seam completion + audit remediation:

| Existing seam | New wiring | Task |
|---|---|---|
| `ResolveDispositionInput.emergencyCriteriaMet` (always false at call site) | Override store lookup in `onBeforeToolCall` | Tasks 2–4 |
| `EmergencyReviewLedger.requireReview` on `allow_minimal` | Unchanged consumer; now reachable | Task 4 |
| `diagnoseConfigSafety` / `mergeTrustConfig` migration diagnostics | New warn codes | Tasks 7–8 |
| `fpp_mandate_propose` (signed-by-agent-after-quorum) | Parallel submit-only emergency tool | Tasks 5–6 |
| `authorization: "standing-allowlist"` literal (ClawHub FP) | `AUTHZ` constants + shorthand | Task 10 |
| OpenClaw compat floor `2026.3.24-beta.2` (vulnerable range) | Raise to `2026.3.28` | Task 11 |

## Progress Tracking

- [x] Task 1: SignedEmergencyOverrideV1 schema + verify in protocol-core
- [x] Task 2: EmergencyOverrideStore (coverage, debit, self-key reject)
- [x] Task 3: Distinguishable abstain reason for rejected overrides
- [x] Task 4: Wire onBeforeToolCall + debit + emergency ledger path
- [x] Task 5: fpp_emergency_override_submit (verify-only MCP tool)
- [x] Task 6: Register tool metadata + openclaw.plugin.json contracts
- [x] Task 7: Unattended approvalOn without standingAllow diagnostic (H)
- [x] Task 8: Quorum eligibility/threshold unreachable diagnostics (I/J)
- [x] Task 9: Docs — CAPABILITY_STATUS + TROUBLESHOOTING + audit notes
- [x] Task 10: Clear authorization-class secret-literal false positives (K)
- [x] Task 11: Raise OpenClaw min gateway / peerDep above vulnerable floor (L)

**Total Tasks:** 11 | **Completed:** 11 | **Remaining:** 0

## Implementation Tasks

### Task 1: SignedEmergencyOverrideV1 schema + verify in protocol-core

**Objective:** Add a versioned emergency override grant with the same cryptographic guarantees as mandates (issuer identity, validity window, scope, budget seed) without folding it into `StandingMandateV1`.

**Files:**
- Create: `packages/protocol-core/src/emergency-override.ts`
- Create: `packages/protocol-core/src/emergency-override.test.ts`
- Modify: `packages/protocol-core/src/index.ts` (exports)

**Steps:**
1. Write failing tests for parse, `validateEmergencyOverrideValidity`, `verifyEmergencyOverrideSignature`, and signing-field exclusion of mutable ledger fields (`remainingActions` / `revoked` if present).
2. Implement TypeBox schema `SignedEmergencyOverrideV1` (schemaVersion 1): `overrideId`, `issuerId`, `publicKey`, `signature`, `scope.classifications` / optional `capabilities`, `budgets.maxActions` (+ optional seed `remainingActions`), `validFrom` / `validTo`, `evidenceRef`, optional `revoked`.
3. Mirror mandate helpers: `emergencyOverrideSigningFields`, `parseSignedEmergencyOverride`, `validateEmergencyOverrideValidity`, `verifyEmergencyOverrideSignature` via `canonicalizeV2` + `verifySignature`.
4. Run package tests; typecheck.
5. Export from package index.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 2: EmergencyOverrideStore (coverage, debit, self-key reject)

**Objective:** File-backed store parallel to `MandateStore` that finds in-scope, in-budget, signature-valid overrides and rejects the local agent key even if the allowlist is wrong.

**Files:**
- Create: `packages/enforcement-core/src/emergency-override-store.ts`
- Create: `packages/enforcement-core/src/emergency-override-store.test.ts`
- Modify: `packages/enforcement-core/src/index.ts` (exports)

**Steps:**
1. Write failing tests: valid coverage hit; expired / mis-scoped / bad signature / budget exhausted → no coverage with typed reject reason; override signed with local agent key → rejected (with comment asserting defense-in-depth); debit decrements unsigned ledger without breaking signature; stewards-only doc comment on options type.
2. Implement store at path sibling default `fpp-emergency-overrides.json` (caller passes path). Shape: `{ schemaVersion: 1, overrides: SignedEmergencyOverrideV1[], ledgers?: Record<id, { remainingActions?, revoked? }> }`.
3. `findCoverage(classification, { nowMs, localPublicKeyHex, stewardEligibleIds? })` returns `{ ok: true, overrideId } | { ok: false, reason: "none" | "expired" | "not-yet-valid" | "mis-scoped" | "signature-invalid" | "budget-exhausted" | "revoked" | "issuer-not-steward" | "agent-self-key" }`.
4. `admit(override, { stewardEligibleIds, localPublicKeyHex })` for submit path; `debit(overrideId)`.
5. Run tests; typecheck; export.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 3: Distinguishable abstain reason for rejected overrides

**Objective:** When an override was considered but failed, abstain audit text must show rejection kind — not the generic "no mandate/staged/emergency path" string.

**Files:**
- Modify: `packages/enforcement-core/src/disposition-engine.ts`
- Modify: `packages/enforcement-core/src/disposition-engine.test.ts`

**Steps:**
1. Write failing tests: `emergencyCriteriaMet: true` → `allow_minimal` (existing); with `emergencyOverrideRejected: "expired"` (and criteria false) → abstain reason matches `/emergency override rejected \(expired\)/`; absent rejection → existing generic abstain reason unchanged; hard-floor still deny even if criteria/rejection set.
2. Extend `ResolveDispositionInput` with optional `emergencyOverrideRejected?: string`.
3. On final abstain, if rejection present, reason = `abstain: emergency override rejected (${kind})`; else keep current string.
4. Run disposition-engine tests; typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 4: Wire onBeforeToolCall + debit + emergency ledger path

**Objective:** Compute `emergencyCriteriaMet` / rejection from the override store before `resolveDisposition`; debit and keep existing review-ledger behavior on `allow_minimal`.

**Files:**
- Modify: `packages/enforcement-core/src/runtime-adapter.ts`
- Modify: `packages/enforcement-core/src/runtime-adapter.test.ts`

**Steps:**
1. Write failing integration-style tests: valid override in store → `allow` action with disposition `allow_minimal`, audit/receipt authorization emergency, `mandatory_review_pending` ledger line, budget debited; expired/mis-scoped/budget-exhausted → block/abstain with distinguishable reason; `blockOn` classification → hard-block even with valid override; agent-self-signed override in store → abstain/reject, never allow_minimal.
2. Construct `EmergencyOverrideStore` via `workspaceSibling(config.mandateStorePath, "fpp-emergency-overrides.json")`.
3. Load local pubkey from `identityKeyPath` (reuse existing identity load helpers if present; otherwise minimal read of seed → pubkey).
4. Pass `emergencyCriteriaMet` / `emergencyOverrideRejected` into `resolveDisposition`; on `allow_minimal`, `debit(overrideId)` then existing `getEmergencyLedger().requireReview(...)`.
5. Run runtime-adapter tests; typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 5: fpp_emergency_override_submit (verify-only MCP tool)

**Objective:** Expose a submit tool analogous to mandate tools that accepts an already-signed payload, verifies steward eligibility, and never signs with the agent key.

**Files:**
- Modify: `plugin-trust/src/tools.ts`
- Modify: `plugin-trust/src/tools-quorum.test.ts` (or create `plugin-trust/src/tools-emergency.test.ts`)

**Steps:**
1. Write failing tests: steward-signed in-allowlist override → admitted to store; agent-identity-signed override → rejected (regression: no self-escalation); signature-invalid / issuer not in `quorumStewardEligibleIds` → rejected; tool path must not call `identity.sign`.
2. Add `EmergencyOverrideSubmitParams` (signed JSON string or structured object) and `executeEmergencyOverrideSubmit(params, deps)` using trust stack identity (for local pubkey / agentId compare only), `quorumStewardEligibleIds` from config, and `EmergencyOverrideStore.admit`.
3. Docstrings: stewards-only rationale; submit-only / never-signs constraint.
4. Run plugin-trust tests; typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 6: Register tool metadata + openclaw.plugin.json contracts

**Objective:** Make the new tool discoverable by the OpenClaw gateway catalog and plugin contracts list.

**Files:**
- Modify: `plugin-trust/src/index.ts`
- Modify: `plugin-trust/openclaw.plugin.json`

**Steps:**
1. Write failing test (or extend existing index/tools registration coverage) asserting `fpp_emergency_override_submit` is registered in metadata / contracts list.
2. `api.registerToolMetadata` + `tool({ name: "fpp_emergency_override_submit", ... })` mirroring mandate tools.
3. Append tool name to `contracts.tools` in `openclaw.plugin.json`.
4. Run plugin-trust tests; typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 7: Unattended approvalOn without standingAllow diagnostic (H)

**Objective:** Warn once at config merge when unattended mode leaves `approvalOn` classes without static standing-allow coverage — without probing the mandate store.

**Files:**
- Modify: `packages/enforcement-core/src/config.ts`
- Modify: `packages/enforcement-core/src/config.test.ts`

**Steps:**
1. Write failing tests: `dispositionMode: "unattended"` + default/nonempty `approvalOn` + empty `standingAllowOn` → diagnostic `UNATTENDED_APPROVAL_WITHOUT_STANDING_ALLOW` severity `warn`; all `approvalOn` ⊆ `standingAllowOn` → no such diagnostic; `operator-present` → no such diagnostic; detail text mentions live mandates / `fpp-mandates.json` / `fpp_mandate_*` are not accounted for.
2. Extend `diagnoseConfigSafety` (and ensure `mergeConfigWithDiagnostics` surfaces it via existing console logging in `mergeConfig`).
3. Run config tests; typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 8: Quorum eligibility/threshold unreachable diagnostics (I/J)

**Objective:** Unconditionally warn when quorum cannot be formed given configured thresholds vs eligible voter lists.

**Files:**
- Modify: `packages/trust-core/src/create-trust-stack.ts`
- Create or modify: `packages/trust-core/src/create-trust-stack.diagnostics.test.ts` (or extend existing trust-stack tests)

**Steps:**
1. Write failing tests per condition: empty `quorumStewardEligibleIds` → warn; empty `quorumPeerEligibleIds` → warn; `quorumStewardThreshold > quorumStewardEligibleIds.length` → warn; peer equivalent → warn; healthy config (eligible ≥ threshold, nonempty) → no unreachable diagnostic. Independent of any enforcement disposition mode.
2. Push codes onto `migrationDiagnostics` (e.g. `QUORUM_STEWARD_UNREACHABLE`, `QUORUM_PEER_UNREACHABLE`, `QUORUM_STEWARD_THRESHOLD_EXCEEDS_ELIGIBLE`, `QUORUM_PEER_THRESHOLD_EXCEEDS_ELIGIBLE`) and `console.warn` once at merge.
3. Run trust-core tests; typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 9: Docs — CAPABILITY_STATUS + TROUBLESHOOTING + audit notes

**Objective:** Document the now-live emergency tier, startup diagnostics, ClawHub FP disposition, and raised OpenClaw floor so operators can recognize config drift vs enforcement bugs vs scanner noise.

**Files:**
- Modify: `docs/CAPABILITY_STATUS.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `docs/COMPATIBILITY.md` (OpenClaw floor — coordinate with Task 11)

**Steps:**
1. Update unattended disposition row: emergency path is wired via signed steward override + submit tool (no longer output-only seam).
2. Add TROUBLESHOOTING entries: silent unattended/empty-quorum after reinstall; how to read `UNATTENDED_APPROVAL_WITHOUT_STANDING_ALLOW` and quorum unreachable warns; how to issue an emergency override (steward signs out-of-band → `fpp_emergency_override_submit`); note peers excluded by design.
3. Document ClawHub `suspicious.exposed_secret_literal` on `authorization: "standing-allowlist"` as a resolved false positive (authorization *class*, not a credential) and point at `AUTHZ` constants.
4. Document required OpenClaw `>=2026.3.28` for enforcement trust (cite that `<=2026.3.24` is GHSA-affected); no live config / constitution-hash changes.
5. Docs-only portions skip TDD; spot-check links/paths against code after Tasks 10–11 land (or land this task last).

**Definition of Done:**
- [ ] Target tests pass (N/A — docs-only)
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 10: Clear authorization-class secret-literal false positives (K)

**Objective:** Stop ClawHub/static scanners from flagging `AuthorizationClass` string literals next to the property name `authorization` as exposed API secrets, without changing on-wire values.

**Files:**
- Modify: `packages/protocol-core/src/disposition.ts`
- Modify: `packages/protocol-core/src/disposition.test.ts` (or adjacent test)
- Modify: `packages/protocol-core/src/index.ts` (export `AUTHZ` / helper)
- Modify: `packages/enforcement-core/src/disposition-engine.ts`
- Modify: `packages/enforcement-core/src/mandate-store.ts`
- Modify: `packages/enforcement-core/src/disposition-engine.test.ts` (behavior unchanged)

**Steps:**
1. RED: add a small regression test (or script assertion) that built/source call sites for standing-allowlist coverage do not contain the adjacent pattern `authorization:\s*["']standing-allowlist["']` (and preferably no `authorization:\s*["']` for any class in those two production files). Keep existing behavioral tests green on wire values.
2. Add exported named map, e.g. `AUTHZ`, derived from `AUTHORIZATION_CLASSES` (`standingAllowlist`, `mandate`, `emergency`, `quorumMandate`, `abstain`, `approved`, `policyBlock`).
3. Replace inline authorization string assignments in `disposition-engine.ts` and `mandate-store.ts` with `AUTHZ.*` references and/or `const authorization = AUTHZ.…; return { authorization, … }` shorthand so emitted JS is not `authorization: "<literal>"`.
4. Confirm existing disposition/mandate tests still pass; typecheck.
5. Optionally grep `packages/enforcement-core/src` for remaining `authorization: "` literals and clear any leftovers in production (not test) files.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 11: Raise OpenClaw min gateway / peerDep above vulnerable floor (L)

**Objective:** Refuse to advertise compatibility with OpenClaw builds in the known-vulnerable `<=2026.3.24` range; require a patched gateway before the enforcement plugin is trusted as a gate.

**Files:**
- Modify: `plugin/package.json` (`openclaw.compat.pluginApi`, `minGatewayVersion`, `build.openclawVersion` / `pluginSdkVersion` as appropriate, `peerDependencies.openclaw`)
- Modify: `plugin-trust/package.json` (same compat + peerDep fields)
- Modify: `docs/COMPATIBILITY.md`
- Modify: any install/verify tests that hardcode `2026.3.24-beta.2` as the expected floor

**Steps:**
1. RED: test or assert that declared `minGatewayVersion` / `peerDependencies.openclaw` are `>=2026.3.28` (or exact `2026.3.28` where the manifest field is not a range).
2. Set both plugins to `pluginApi: ">=2026.3.28"`, `minGatewayVersion: "2026.3.28"`, `peerDependencies.openclaw: ">=2026.3.28"`. Leave `devDependencies.openclaw` on the newer verified pin if already `^2026.6.11`.
3. Update `docs/COMPATIBILITY.md` table + example JSON; note why `2026.3.24*` is rejected (GHSA range).
4. Run plugin package tests / typecheck that read compat metadata; sync lockfile peer ranges only if required by existing scripts (no ClawHub publish in this plan).

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

## Testing Strategy

- **Unit:** protocol-core override schema/verify; emergency-override-store coverage matrix; disposition-engine abstain reason variants; config + trust diagnostic predicates; AUTHZ constant wire-value parity + no adjacent secret-literal pattern in production sources.
- **Adapter:** runtime-adapter tests for valid → allow_minimal + ledger + debit; reject matrix; hard-floor precedence; agent-self-key.
- **MCP:** plugin-trust submit tool — steward admit, agent-key reject, no `identity.sign`.
- **Compat:** plugin manifests declare OpenClaw `>=2026.3.28`.
- **Non-goals for this plan:** full e2e against a live OpenClaw gateway; changing operator `openclaw.json`; ClawHub republish.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Emergency quietly becomes “third mandate” | Separate type + store; do not touch mandate/quorum finalize paths |
| Agent self-escalation via MCP | Submit never signs; allowlist + hardcoded local-key reject; dedicated regression test |
| Config diagnostic false positives from mandate probe | H is standingAllowOn-only; wording points at live mandate tools |
| Cross-plugin coupling for quorum warns | J is trust-local only; no dispositionMode read |
| Forensic ambiguity on abstain | Distinguable `emergency override rejected (…)` reasons (G addition) |
| Future editor “fixes” peer exclusion or self-key check | Required one-line comments in code |
| Scanner still flags after const refactor | Prefer property shorthand over inlined literals; grep production sources; document if residual FP |
| Raising OpenClaw floor breaks older gateways | Intentional — enforcement must not claim safety on GHSA-affected hosts; document upgrade path |
