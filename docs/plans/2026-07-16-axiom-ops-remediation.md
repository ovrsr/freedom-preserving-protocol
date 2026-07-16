# Axiom Ops Remediation (Skill / Audit / Classifier / Trust)

**Status:** COMPLETE
**Created:** 2026-07-16
**Depends on:** `2026-07-15-meta-eval-remediation.md` (shipped); `2026-07-16-openclaw-tool-name-normalize.md` (shipped — `openclawfpp_*` only)
**Unblocks:** Self-verifiable skill install; primary constitution-audit path; unattended allow for live OpenClaw tool names; honest handshake `adoptedAt`; diagnosable trust persistence + CLI gaps
**Scope:**
- **In:** Skill runtime deps so `npm run verify` / `verify-install` work; non-model constitution-audit bootstrap; broaden OpenClaw tool-name normalize + curated `knownCustomTools` seeds; dedicated `apply_patch` risk class (approval); trust path absolutization + persistence bug hunt then handshake runbook; `adoptedAt` from SOUL/adoption-state; local-build provenance docs; CLI/Codex registration diagnosis (findings only); TROUBLESHOOTING + patch bumps for touched packages.
- **Out (confirmed):** ClawHub publish / reinstall to force metadata align (document drift instead); implementing CLI registration fixes (diagnose only); changing `knownCustomTools: []` empty-array override semantics; mandate-budget work (separate COMPLETE plan).

## Summary

Live Axiom meta-eval rated enforcement healthy, trust degraded, skill verification broken. Root causes span host ops and code:

1. Skill package declares `@noble/*` but installed skill trees often lack `node_modules`.
2. `constitution-audit.jsonl` is heartbeat/model-driven; trust falls back to enforcement audit.
3. Classifier only normalizes `openclawfpp_*`; live `openclaw.memory_search` / aliases miss the `memory_search` seed; `apply_patch` falls through to `unknown.unclassified` when no path param.
4. Trust plugin manifest defaults are **relative**; `mergeTrustConfig` accepts them without absolutizing (docs claim otherwise). Graph files also only flush on `setOnChange` — empty graph never writes.
5. Handshake offer stamps `adoptedAt: new Date()` instead of SOUL `- Adopted:` / adoption-state time.
6. Install metadata lags local rebuilds (1.1.4/1.2.1 vs live 1.1.10/1.2.7) — document, do not republish in this plan.
7. `openclaw fpp-trust` CLI / Codex plugin errors — diagnose and record only.

## Locked design choices (2026-07-16)

| ID | Choice |
|----|--------|
| Q1-A | Full Axiom remediation (issues 1–7) in one plan. |
| Q2-C | Both: broaden OpenClaw name normalize **and** curated seed expansion. |
| Q3-B | `apply_patch` gets its own classification → **approval** (not allowlist allow). |
| Q4-B | Non-model bootstrap so `constitution-audit.jsonl` exists without relying on heartbeat skill. |
| Q5-C | Investigate trust persistence (paths / empty-graph) first, then hardened-v2 handshake runbook. |
| Q6-A | `adoptedAt` from SOUL.md / adoption-state when present; else `now`. |
| Q7-B | Document local-build provenance; leave ClawHub registry versions alone. |
| Q8-C | Diagnose CLI/Codex registration only — findings in TROUBLESHOOTING (no fix). |

### Normalize + seed rules (Q2-C detail)

| Live name form | After normalize | Disposition |
|----------------|-----------------|-------------|
| `openclawfpp_*` | `fpp_*` | existing `fpp.governance` allow |
| `openclaw.<name>` | `<name>` | then classify / allowlist |
| `openclaw<name>` when remainder is seeded or `fpp_*` | `<name>` | avoid stripping unrelated `openclaw*` tools |
| seeded aliases still present after normalize | — | `knownCustomTools` allow + audit |
| `apply_patch` / normalized aliases | — | **not** allowlisted; dedicated class → approval |

Seed at least: `memory_search` (keep), plus any live aliases that survive normalize poorly (document exact list in tests). Do **not** seed `apply_patch`.

### `apply_patch` class (Q3-B detail)

- New `ClassificationId`: `code.patch` (name locked here; do not reuse `fs.write.workspace` allow path).
- Default decision: `approval`.
- Add to default `approvalOn`.
- Match tool names: `apply_patch`, `openclaw.apply_patch`, and post-normalize `apply_patch` — **even when path params are absent** (current `classifyFilesystem` requires a path and therefore misses bare `apply_patch`).

## Architecture Notes

```
Skill install tree
  package.json deps → npm install (host + stage verify)
  scripts/* need @noble/ed25519 + @noble/hashes

constitution-audit bootstrap (non-model)
  scripts/audit-append.ts (existing) OR new thin wrapper
  → absolutized ~/.openclaw/workspace/constitution-audit.jsonl
  → kind=heartbeat|adoption (idempotent if chain exists)
  docs: cron / operator one-shot (not model heartbeat)

Classifier
  normalizeOpenClawToolName(tool)
    openclawfpp_* → fpp_*
    openclaw.* → *
    openclaw + (fpp_*|seeded) → strip prefix
  classifyToolCall
    … existing fs/exec/http/message …
    code.patch (apply_patch*) → approval
    fpp_* → fpp.governance allow
    knownCustomTools → allow
    else unknown.unclassified

Trust paths
  openclaw.plugin.json relative defaults
    → mergeTrustConfig MUST absolutizeWorkspacePath (parity with skill-lib)
  setOnChange → debounced saveTrustGraph
  empty graph: no file until first mutation (document) OR optional bootstrap write

Handshake offer
  adoptedAt = parse SOUL "- Adopted: <ISO>" | adoption-state accepted.at | now()
```

## Feature Inventory

| Existing | Change | Task |
|----------|--------|------|
| Skill `@noble/*` declared; host often missing `node_modules` | Install path + verify precondition / stage check | 1 |
| Heartbeat-only constitution-audit | Non-model bootstrap script + docs | 2 |
| `normalizeOpenClawToolName` only `openclawfpp_*` | Broaden + seed aliases | 3 |
| `apply_patch` → `unknown.unclassified` | New `code.patch` → approval | 4 |
| Relative trust paths + empty-graph no file | Absolutize in merge; investigate + fix persist; runbook | 5 |
| `adoptedAt: new Date()` in offer/CLI | Resolve from SOUL / adoption-state | 6 |
| Install metadata drift WARN | Document local-build provenance | 7 |
| `openclaw fpp-trust` / Codex CLI errors | Diagnose → TROUBLESHOOTING findings | 8 |
| Package versions / TROUBLESHOOTING | Patch bumps + operator notes | 9–10 |

## Progress Tracking

**Total Tasks:** 10 | **Completed:** 10 | **Remaining:** 0

- [x] Task 1: Restore skill runtime deps so verify* works
- [x] Task 2: Non-model constitution-audit bootstrap
- [x] Task 3: Broaden OpenClaw normalize + curated knownCustomTools seeds
- [x] Task 4: Dedicated `code.patch` classification for apply_patch
- [x] Task 5: Trust path absolutization + persistence investigation/fix
- [x] Task 6: Handshake `adoptedAt` from SOUL / adoption-state
- [x] Task 7: Document local-build provenance (no ClawHub republish)
- [x] Task 8: Diagnose `fpp-trust` CLI + Codex registration (findings only)
- [x] Task 9: TROUBLESHOOTING / COMPATIBILITY / CAPABILITY_STATUS updates + patch bumps
- [x] Task 10: End-to-end verification matrix + Prax handshake runbook

## Completion notes (implement)

Verification matrix evidence (this session):
- `risk-classifier.test.ts`: 35 pass (normalize + `code.patch`)
- `create-trust-stack.path.test.ts`: 2 pass
- `resolve-adopted-at.test.ts`: 4 pass
- `audit-bootstrap.test.ts`: 4 pass
- `skill-self-check.test.ts`: 4 pass
- `plugin` config + security-regressions: 18 pass
- `@ovrsr/fpp-protocol-core`: 116 pass
- `@ovrsr/fpp-enforcement-core`: 130 pass
- `@ovrsr/fpp-trust-core`: 131 pass
- `@ovrsr/openclaw-fpp-plugin`: 44 pass
- `@ovrsr/openclaw-fpp-trust`: 32 pass

Versions bumped: protocol/enforcement/trust-core `1.0.2`, plugin `1.1.11`, plugin-trust `1.2.8`. No ClawHub publish (Q7-B).

## Implementation Tasks

### Task 1: Restore skill runtime deps so verify* works

**Objective:** From a staged or ClawHub-like skill root, `npm run verify` and `npm run verify-install` succeed (or fail for real constitution/install reasons, not missing `@noble/ed25519`).

**Files:**
- Modify: `scripts/stage-skill.ts` and/or `scripts/skill-self-check.ts` / `scripts/clawhub-publish.sh` (ensure deps install or fail loudly)
- Modify: `skill/README.md`, `docs/TROUBLESHOOTING.md`
- Test: `scripts/skill-self-check.ts` or new focused test under `scripts/`

**Steps:**
1. RED: reproduce missing-module failure; add check that skill root has resolvable `@noble/ed25519` after install step.
2. GREEN: document + automate `npm install` in skill root (stage post-step and/or self-check); keep ALLOWLIST deps declaration.
3. Run skill verify scripts; typecheck/lint touched files.

**Definition of Done:**
- [ ] Missing deps are detected with an actionable message
- [ ] After install step, `npm run verify` gets past module resolution
- [ ] Docs tell operators to `npm install` in the skill directory on host

### Task 2: Non-model constitution-audit bootstrap

**Objective:** Operators can create/extend the primary `constitution-audit.jsonl` without the model heartbeat skill (Q4-B).

**Files:**
- Create or Modify: `scripts/audit-bootstrap.ts` (preferred thin wrapper over `audit-append`) **or** extend `scripts/audit-append.ts` + npm script
- Modify: `package.json` / skill scripts surface; `hooks/constitution-audit/SKILL.md` (point to bootstrap); `docs/COMPATIBILITY.md`, `docs/TROUBLESHOOTING.md`
- Test: new/extended tests beside `scripts/audit-append` / `safe-append.audit.test.ts`

**Steps:**
1. RED: missing log + adopted SOUL → bootstrap creates chain-valid first entry at absolutized path; second run is idempotent / appends heartbeat without breaking chain.
2. GREEN: implement bootstrap; refuse to create log when adoption revoked / never adopted (match heartbeat skill policy).
3. Document one-shot + suggested cron invoking the script (non-model).

**Definition of Done:**
- [ ] Bootstrap creates verifiable constitution-audit without agent heartbeat
- [ ] Respects adoption/revocation gates
- [ ] Trust can prefer primary audit over fallback once entries exist

### Task 3: Broaden OpenClaw normalize + curated knownCustomTools seeds

**Objective:** Live names `openclaw.memory_search` (and documented aliases) allow via seed after normalize; `openclawfpp_*` still governance-allow; unrelated unknowns still abstain/approval.

**Files:**
- Modify: `packages/enforcement-core/src/risk-classifier.ts`
- Modify: `packages/enforcement-core/src/config.ts` (seed list if needed)
- Test: `packages/enforcement-core/src/risk-classifier.test.ts`, `plugin/src/security-regressions.test.ts`, `plugin/src/config.test.ts`
- Modify: self-test fixtures if present (`plugin` / `scripts/self-test.ts`)

**Steps:**
1. RED: `openclaw.memory_search` → allow with seed; mangled `openclawfpp_trust_status` still governance; random `openclaw.foo_bar` still unknown.
2. GREEN: extend `normalizeOpenClawToolName`; expand curated seeds only as needed after normalize.
3. Do not allowlist `apply_patch` here.

**Definition of Done:**
- [ ] Unit + plugin e2e cover dotted / mangled forms
- [ ] Unknown tools remain non-fail-open

### Task 4: Dedicated `code.patch` classification for apply_patch

**Objective:** `apply_patch` (and OpenClaw-prefixed forms) classify as `code.patch` with decision `approval`, including when no path param is present.

**Files:**
- Modify: `packages/enforcement-core/src/risk-classifier.ts` (`ClassificationId`, `CLASSIFICATION_IDS`, classifier)
- Modify: `packages/enforcement-core/src/config.ts` (`approvalOn` default)
- Modify: reversibility / manifest / plugin openclaw schema if ClassificationId lists are duplicated
- Test: `risk-classifier.test.ts`, disposition/runtime tests as needed, plugin e2e

**Steps:**
1. RED: bare `apply_patch` → `code.patch` / approval; protected-path behavior remains separate if params include paths later.
2. GREEN: minimal matcher before allowlist fallthrough; add to default `approvalOn`.
3. Update CAPABILITY/TROUBLESHOOTING mentions of unknown.unclassified for apply_patch.

**Definition of Done:**
- [ ] `apply_patch` never silently allowlists
- [ ] Default config requires approval for `code.patch`
- [ ] Tests green

### Task 5: Trust path absolutization + persistence investigation/fix

**Objective:** Relative manifest/config paths resolve under `FPP_WORKSPACE` / `~/.openclaw/workspace`, not gateway CWD. Explain and fix why Axiom saw no `fpp-trust-graph.json` / replay / strict / quorum files; then provide handshake steps.

**Files:**
- Modify: `packages/trust-core/src/create-trust-stack.ts` (`mergeTrustConfig` path fields via shared absolutizer)
- Create or Modify: move/sync `absolutizeWorkspacePath` into `@ovrsr/fpp-protocol-core` if not present (skill-lib currently has it; protocol-core does not — docs claim runtime absolutizes)
- Modify: enforcement `mergeConfig` path fields for parity (same bug class)
- Test: trust-core + enforcement-core config/path tests; plugin-trust persistence tests
- Modify: `docs/TROUBLESHOOTING.md` with investigation findings

**Steps:**
1. RED: relative `.openclaw/workspace/fpp-trust-graph.json` absolutizes; CWD ≠ home does not change resolved path.
2. Investigate empty-graph: confirm `setOnChange` never fires until first peer — document expected vs bug; fix if saves fail after mutation or write to wrong CWD.
3. GREEN: wire absolutizer; optional empty-graph bootstrap write only if investigation shows operators need a marker file (prefer documenting expected absence until first successful verify unless tests prove silent loss).
4. Capture “where files actually were” diagnostic note for Axiom hosts.

**Definition of Done:**
- [ ] Relative trust/enforcement path configs absolutize
- [ ] Persistence behavior documented + bugs fixed
- [ ] Handshake runbook deferred to Task 10 but unblocked

### Task 6: Handshake `adoptedAt` from SOUL / adoption-state

**Objective:** Offer (and CLI claim builder) emit historical adoption time when SOUL `- Adopted: <ISO>` or adoption-state record provides it; else current time.

**Files:**
- Modify: `plugin-trust/src/tools.ts` (`executeHandshakeOffer`)
- Modify: `plugin-trust/src/cli.ts` (same stamp)
- Create helper under `plugin-trust/src/` or protocol/trust-core if reusable
- Test: `plugin-trust` unit tests with temp SOUL / adoption log

**Steps:**
1. RED: SOUL with May timestamp → offer claim `adoptedAt` matches; missing SOUL → now.
2. GREEN: parse SOUL block; prefer adoption-state accepted timestamp when richer; do not invent dates.
3. Keep signature payload consistent with claim schema.

**Definition of Done:**
- [ ] Tests cover SOUL hit / miss
- [ ] No regression on freshness / hardened-v2 verify

### Task 7: Document local-build provenance (no ClawHub republish)

**Objective:** Operators understand runtime 1.1.10 / 1.2.7 vs older install-metadata is intentional local rebuild; `plugin.version-drift` WARN is expected until deliberate republish.

**Files:**
- Modify: `docs/TROUBLESHOOTING.md`, `docs/COMPATIBILITY.md`, optionally `plugin/README.md` / `plugin-trust/README.md`
- Modify: `docs/CAPABILITY_STATUS.md` if needed for honesty

**Steps:**
1. Add “Local rebuild provenance” section: how to record git SHA / build time; that ClawHub publish is out of scope for this remediation.
2. Cross-link `verify-install` `plugin.version-drift` WARN.

**Definition of Done:**
- [ ] Docs state Q7-B policy clearly
- [ ] No publish scripts run as part of this plan

### Task 8: Diagnose `fpp-trust` CLI + Codex registration (findings only)

**Objective:** Reproduce/characterize why `openclaw fpp-trust ...` is unregistered in Axiom’s runtime and what Codex plugin registration errors mean; write findings — **no code fix** (Q8-C).

**Files:**
- Modify: `docs/TROUBLESHOOTING.md` (new subsection)
- Optional notes in `docs/COMPATIBILITY.md`

**Steps:**
1. Trace `api.registerCli` + `FPP_TRUST_CLI_DESCRIPTORS` vs OpenClaw CLI load path; note gateway-vs-CLI process split if applicable.
2. Capture Codex adapter/plugin registration error class from local invoke if reproducible; else document “reported by Axiom” with likely causes.
3. List follow-up fix options without implementing them.

**Definition of Done:**
- [ ] Findings section merged into TROUBLESHOOTING
- [ ] Explicit “not fixed in this plan” marker

### Task 9: Docs sync + patch bumps for touched packages

**Objective:** Version and docs reflect classifier/trust/skill fixes; manifests stay consistent with DEFAULT_CONFIG where required.

**Files:**
- Modify: `packages/enforcement-core/package.json`, `plugin/package.json` (+ lock as needed)
- Modify: `packages/trust-core/package.json` and/or `plugin-trust/package.json` if Task 5–6 touch them
- Modify: `packages/protocol-core/package.json` if absolutizer moves there
- Modify: `docs/TROUBLESHOOTING.md`, `docs/COMPATIBILITY.md`, `docs/CAPABILITY_STATUS.md`
- Modify: `plugin/openclaw.plugin.json` / `plugin-trust/openclaw.plugin.json` schema defaults if ClassificationId or seeds change

**Steps:**
1. Patch-bump only packages whose public behavior changed.
2. Align manifest defaults / CAPABILITY rows with new normalize, `code.patch`, audit bootstrap, adoptedAt, provenance.
3. Run package tests + typecheck for bumped packages.

**Definition of Done:**
- [ ] Versions bumped coherently
- [ ] Manifest default parity checks still pass

### Task 10: End-to-end verification matrix + Prax handshake runbook

**Objective:** Fresh command evidence for skill verify, audit bootstrap, classifier cases, trust path persistence; runbook for hardened-v2 `fpp_handshake_challenge` → offer → verify with Prax (`praxai-main` peer ID reconciliation notes).

**Files:**
- Modify: `docs/TROUBLESHOOTING.md` or `docs/COMPATIBILITY.md` (handshake runbook subsection)
- No production code unless Task 5 left a small gap

**Steps:**
1. Run: skill verify* after deps; audit bootstrap + `audit:verify`; enforcement-core + plugin tests for normalize/`code.patch`; trust-core path tests.
2. Document Axiom/host handshake sequence including peer ID check (`fpp_trust_status`), expected new graph file location, and success criteria.
3. Paste command outcomes into plan completion notes during `/implement` (verification skill will re-check).

**Definition of Done:**
- [ ] Verification matrix commands listed with expected signals
- [ ] Handshake runbook ready for Axiom after code lands
- [ ] No claim of VERIFIED until `/verify`

## Testing Strategy

| Area | Primary tests |
|------|----------------|
| Skill deps | skill-self-check / stage + module resolution |
| Audit bootstrap | scripts tests with temp workspace + adoption gates |
| Normalize + seeds | `risk-classifier.test.ts`, plugin security-regressions e2e |
| `code.patch` | classifier + disposition + default `approvalOn` |
| Trust paths | trust-core merge/createTrustStack with relative paths + wrong CWD |
| `adoptedAt` | plugin-trust tools tests with fixture SOUL |
| Docs-only / diagnose | no unit tests; `/verify` reads TROUBLESHOOTING sections |

TDD required for Tasks 1–6 code paths. Skip TDD for Tasks 7–8 (docs/diagnose) and pure bump/docs portions of 9–10.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Over-broad `openclaw*` normalize allowlists hostile tools | Only strip when remainder is `fpp_*` or curated seed; tests for negative cases |
| `code.patch` approval fatigue | Single class; operators may later standing-allow explicitly — not default allow |
| Absolutizer breaks operators with intentional CWD-relative layouts | `FPP_WORKSPACE` override; document; preserve already-absolute paths |
| Empty graph “missing file” misdiagnosed as corruption | Document expected absence until first successful verify/mutation |
| Handshake runbook fails on peer ID mismatch | Task 10 includes ID reconciliation before offer/verify |
| Scope creep into CLI fix / ClawHub publish | Q7-B / Q8-C hard outs |

## Host ops checklist (Axiom — after `/implement`)

1. `npm install` in skill install directory; re-run `npm run verify` / `verify-install`.
2. Run constitution-audit bootstrap; confirm trust attestation prefers primary log.
3. Deploy/rebuild enforcement + trust plugins with bumped patches (local provenance per Task 7).
4. Confirm classifier: `openclaw.memory_search` allows; `apply_patch` requires approval.
5. Confirm trust files land under absolutized workspace after handshake mutation.
6. Run Prax hardened-v2 handshake per Task 10 runbook.
7. Treat CLI/Codex errors as known per Task 8 until a follow-up plan.
