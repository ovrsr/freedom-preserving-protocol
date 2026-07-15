# Meta-Evaluation Remediation (Workspace Paths, Governance Tools, Audit Init)

**Status:** COMPLETE
**Created:** 2026-07-15
**Depends on:** Live OpenClaw meta-evaluation findings (2026-07-15); Plans 8, 11, 13 shipped surfaces
**Unblocks:** Honest `verify-install` / trust introspection on unattended hosts; adopt → constitution-audit continuity
**Scope:**
- **In:** Absolute OpenClaw workspace defaults + script absolutizer for legacy relative paths; classifier `fpp.governance` for `fpp_*` tools; seeded OpenClaw introspection allowlist (`memory_search` + small documented set) via `knownCustomTools`; adopt writes `kind=adoption` constitution-audit entry; `verify-install` warns on missing audit when adopted and on runtime/install version drift; docs/CAPABILITY_STATUS/TROUBLESHOOTING alignment; skill-lib sync for ClawHub portability.
- **Out (confirmed):** Seed constitution hash change; gateway RFC; default-allowing arbitrary unknown tools; mutating live `/home/praxis` host state from this repo; changing Plan 13 `computePeerAdvertisability` formula.

## Summary

A live meta-evaluation of shipped FPP reported `PARTIAL`: dispatcher and trust plugins were loaded, but (1) `verify-install` skipped the constitution-audit chain at a skill-CWD-relative path while the live log was missing under the OpenClaw workspace, (2) unattended mode abstained `fpp_trust_status` / `memory_search` as `unknown.unclassified`, and (3) adopt never initializes `constitution-audit.jsonl` despite consent text promising audit writes.

This plan remediates those gaps without claiming behavioral compliance or completeness.

## Locked design choices (2026-07-15)

| ID | Choice |
|----|--------|
| Q1-C | Absolute `openclaw` default under `homedir()/.openclaw/workspace` **and** a shared absolutizer for legacy relative configs (`FPP_WORKSPACE` → detected OpenClaw workspace if available → `homedir()`). |
| Q2-A+C | Classifier classifies tools matching `/^fpp_/` as `fpp.governance` with `decision: "allow"` (audited). Keep `knownCustomTools` as the optional operator list for non-`fpp_*` introspection. |
| Q3-B | Seed default `knownCustomTools` with a **small** OpenClaw introspection set: at minimum `memory_search`. Document the exact list; do not expand to a broad fail-open. |
| Q4-C | `npm run adopt` appends `kind=adoption` to the live constitution-audit path; `verify-install` **warns** when local adoption is active but the log is missing/unverifiable. |
| Q5-A | **No** change to `computePeerAdvertisability`. Constitution-audit is model-driven and is not a dispatcher-grade signal; gate peer ads on it would conflate claim classes. Warn-only in `verify-install`. *(Locked recommendation for `Q5-?`; flip to B only with explicit approval before `/implement`.)* |
| Q6-B | `verify-install` warns when OpenClaw plugin runtime version and install metadata version diverge (when inspectable). |
| Q7 | Out of scope as listed above. |

## Architecture Notes

```
protocol-core resolveWorkspaceRoot("openclaw")
  → absolute: <homedir>/.openclaw/workspace   (was relative ".openclaw/workspace")
  FPP_WORKSPACE still overrides all profiles

skill-lib/workspace.ts  ──sync──▶  same helpers + absolutizeWorkspacePath()

Scripts (adopt/revoke/audit/verify-install)
  → always pass paths through absolutizeWorkspacePath()

Classifier
  → /^fpp_/  → classification fpp.governance, decision allow
  → else knownCustomTools (seeded: memory_search, …) → allow + audit
  → else unknown.unclassified → approval / unattended abstain (unchanged)

Adopt (safe-append)
  → SOUL/MEMORY + adoption-state ledger
  → NEW: audit-append kind=adoption at absolutized constitution-audit.jsonl
```

**Backward compatibility:** Relative strings already stored in operator configs and plugin JSON defaults continue to work via the absolutizer. Published plugin config schema defaults may keep relative forms for readability; runtime and scripts resolve them. Changing protocol-core’s openclaw root to absolute updates new `workspaceFile()` defaults used by enforcement/trust core config.

**Claim-class honesty:** Receipts and audit entries remain event/configuration evidence. Docs must not imply that allowing `fpp_*` or seeding `memory_search` proves behavioral compliance.

## Feature Inventory

| Existing file/function/contract | Replacement / change | Task |
|---|---|---|
| `packages/protocol-core/src/workspace-profile.ts` relative openclaw root | Absolute under `homedir()/.openclaw/workspace` | Task 1 |
| `scripts/skill-lib/workspace.ts` duplicate | Sync + add `absolutizeWorkspacePath` | Task 2 |
| Relative defaults in adopt/revoke/audit/verify-install | Route through absolutizer | Task 2–3 |
| `classifyToolCall` unknown fallthrough for `fpp_*` | `fpp.governance` allow branch | Task 4 |
| `DEFAULT_CONFIG.knownCustomTools: []` | Seed small introspection list | Task 5 |
| `safe-append` / adopt — no constitution-audit write | Append `kind=adoption` | Task 6 |
| `verify-install` `audit.chain` skip only | + warn when adopted & missing; version-drift warn | Task 3, 7 |
| `computePeerAdvertisability` | **Unchanged** (Q5-A) | — |
| Docs claiming relative-only openclaw paths | Update COMPATIBILITY / TROUBLESHOOTING / SKILL / CAPABILITY_STATUS | Task 8–9 |

## Progress Tracking

- [x] Task 1: Absolutize OpenClaw workspace profile in protocol-core
- [x] Task 2: Sync skill-lib + absolutizer; wire adopt/revoke/audit scripts
- [x] Task 3: verify-install path fix + adopted-without-audit warn
- [x] Task 4: Classifier `fpp.governance` for `fpp_*` tools
- [x] Task 5: Seed default introspection `knownCustomTools` (+ config docs)
- [x] Task 6: Adopt appends `kind=adoption` constitution-audit entry
- [x] Task 7: verify-install runtime vs install metadata version-drift warn
- [x] Task 8: Plugin/core config defaults + reversibility / schema updates
- [x] Task 9: Docs, CAPABILITY_STATUS, TROUBLESHOOTING, SKILL honesty
- [x] Task 10: Unattended e2e — `fpp_trust_status` allows; unknown still abstains

**Total Tasks:** 10 | **Completed:** 10 | **Remaining:** 0

## Implementation Tasks

### Task 1: Absolutize OpenClaw workspace profile in protocol-core

**Objective:** Make `resolveWorkspaceRoot({ profile: "openclaw" })` return an absolute path under `homedir()/.openclaw/workspace`, preserving `FPP_WORKSPACE` override.

**Files:**
- Modify: `packages/protocol-core/src/workspace-profile.ts`
- Test: `packages/protocol-core/src/workspace-profile.test.ts`

**Steps:**
1. RED: assert openclaw profile resolves to `/home/agent/.openclaw/workspace` with injectable `homedir`; assert relative `.openclaw/workspace` is no longer returned when env is empty.
2. GREEN: implement absolute join; keep FPP_WORKSPACE and other profiles behavior.
3. Run workspace-profile tests; typecheck package.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable) — deferred to Task 9

### Task 2: Sync skill-lib + absolutizer; wire adopt/revoke/audit scripts

**Objective:** Keep ClawHub-portable `scripts/skill-lib/workspace.ts` bit-compatible with protocol-core; add `absolutizeWorkspacePath()` so legacy relative paths resolve against `FPP_WORKSPACE` → optional detected OpenClaw workspace → `homedir()`, never skill CWD by accident.

**Files:**
- Modify: `scripts/skill-lib/workspace.ts`
- Modify: `scripts/skill-lib/index.ts` (exports)
- Modify: `scripts/safe-append.ts`, `scripts/revoke.ts`, `scripts/audit-append.ts`, `scripts/audit-verify.ts`, `scripts/audit-proof.ts` (default log resolution)
- Test: `scripts/skill-lib.portability.test.ts` and/or new `scripts/workspace-absolutize.test.ts`

**Steps:**
1. RED: relative `.openclaw/workspace/x` absolutizes under injectable home/FPP_WORKSPACE; absolute paths unchanged.
2. GREEN: implement helper; sync openclaw root; wire script defaults.
3. Confirm stage-skill still copies updated skill-lib (existing stage tests).

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable) — Task 9

### Task 3: verify-install path fix + adopted-without-audit warn

**Objective:** `verify-install` checks the live workspace constitution-audit path (not skill-local CWD). When adoption markers/ledger indicate active acceptance and the audit log is missing, emit an explicit **warn** (overall required checks may still pass per existing policy — do not falsely fail signature/adoption).

**Files:**
- Modify: `scripts/verify-install.ts`
- Test: `scripts/verify-install.test.ts`

**Steps:**
1. RED: with CWD ≠ home and relative default log, report resolves to absolutized live path; when soul/memory adopted and log absent, `audit.chain` or sibling check is `warn` with actionable detail (not silent skip-as-success narrative).
2. GREEN: use absolutizer; add `audit.adopted-without-log` (or upgrade skip messaging) warn.
3. Keep Q5-A: do not flip `peerAdvertisableActive` solely because audit is missing.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable) — Task 9

### Task 4: Classifier `fpp.governance` for `fpp_*` tools

**Objective:** Tools whose names match `/^fpp_/` classify as `fpp.governance` with `decision: "allow"` before the unknown fallthrough, so unattended disposition allows them with audit instead of abstaining.

**Files:**
- Modify: `packages/enforcement-core/src/risk-classifier.ts`
- Modify: `packages/enforcement-core/src/reversibility.ts` (treat as reversible)
- Test: `packages/enforcement-core/src/risk-classifier.test.ts`
- Test: `packages/enforcement-core/src/disposition-engine.test.ts` (unattended allow path)
- Test: `plugin/src/security-regressions.test.ts` or `plugin/src/index.test.ts` (live hook: `fpp_trust_status` not abstain)

**Steps:**
1. RED: `classifyToolCall("fpp_trust_status", {})` → `fpp.governance` / allow; `some_custom_tool_xyz` still unknown.
2. GREEN: add `ClassificationId`, `CLASSIFICATION_IDS`, classifier branch, reversibility.
3. Confirm hard-floor / blockOn cannot be bypassed by renaming to `fpp_` alone (only prefix match on otherwise unclassified tools — prefix check runs after specific classifiers or only on fallthrough; prefer fallthrough-before-unknown so `fpp_` cannot mask exec/fs patterns if somehow named that way — document: match only when no higher-priority classifier matched).

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable) — Task 9

### Task 5: Seed default introspection `knownCustomTools` (+ config docs)

**Objective:** Default `knownCustomTools` includes a small OpenClaw introspection set starting with `memory_search`. Operators may extend via config. This is not a global fail-open.

**Files:**
- Modify: `packages/enforcement-core/src/config.ts` (`DEFAULT_CONFIG.knownCustomTools`)
- Modify: `plugin/openclaw.plugin.json` (default array + description)
- Modify: `plugin/README.md` (brief)
- Test: `packages/enforcement-core/src/risk-classifier.test.ts` (memory_search allows via allowlist)
- Test: `plugin/src/security-regressions.test.ts` (unattended: memory_search allows; random unknown still abstains)

**Steps:**
1. RED: with default config, `memory_search` → allow; `totally_unknown_xyz` → approval/abstain path.
2. GREEN: seed defaults; keep exact-name matching.
3. Document exact seeded list in plugin README / TROUBLESHOOTING (Task 9 may finish prose).

**Seeded list (locked for this plan):**
- `memory_search`

Add further names only if tests prove they are required for the same self-audit workflow and remain low-risk (do not silently expand during implement without plan amendment).

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 6: Adopt appends `kind=adoption` constitution-audit entry

**Objective:** Successful `npm run adopt` (non-dry-run) creates/appends a hash-chained `kind=adoption` entry at the absolutized constitution-audit path, matching SKILL consent language.

**Files:**
- Modify: `scripts/safe-append.ts`
- Reuse: `scripts/audit-append.ts` helpers (export append function if needed rather than spawning)
- Test: `scripts` adopt/safe-append tests (extend existing or add `scripts/safe-append.audit.test.ts`)

**Steps:**
1. RED: after adopt in temp workspace, constitution-audit.jsonl exists, chain verifies, `kind=adoption`.
2. GREEN: call append API with absolutized path; dry-run writes nothing; idempotent re-adopt does not require rewriting SOUL but may skip duplicate adoption audit if already present (document chosen behavior — prefer: only write audit entry when SOUL and/or MEMORY actually appended or adoption-state transitions to accepted).
3. Revocation path already appends revocation — leave intact.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable) — Task 9

### Task 7: verify-install runtime vs install metadata version-drift warn

**Objective:** When `openclaw plugins list/inspect` exposes both runtime and install metadata versions and they differ, emit a **warn** check (non-fatal).

**Files:**
- Modify: `scripts/verify-install.ts`
- Test: `scripts/verify-install.test.ts` (inject mock plugin lister / inspect fixture)

**Steps:**
1. RED: mock plugins with runtime `1.1.7` vs metadata `1.1.4` → warn check present.
2. GREEN: parse available fields; skip if not inspectable.
3. Detail string tells operator this is drift, not automatic compromise.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable) — Task 9

### Task 8: Plugin/core config defaults + reversibility / schema updates

**Objective:** Propagate `fpp.governance` and seeded `knownCustomTools` through enforcement-core exports, plugin adapter config merge, and any ruleset/manifest hashing that enumerates classification ids. Ensure OpenClaw plugin JSON schema descriptions match.

**Files:**
- Modify: `packages/enforcement-core/src/config.ts`, `runtime-manifest.ts` (if classification set hashed)
- Modify: `plugin/src/config.ts` (re-export/merge if separate)
- Modify: `plugin/openclaw.plugin.json`
- Test: existing config/manifest tests; update golden hashes if any

**Steps:**
1. RED/GREEN for manifest stability expectations.
2. Confirm adapters inheriting DEFAULT_CONFIG pick up seeded tools without OpenClaw-only breakage (memory_search allow on Cursor is harmless if tool absent).

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 9: Docs, CAPABILITY_STATUS, TROUBLESHOOTING, SKILL honesty

**Objective:** Document absolute openclaw workspace resolution, `FPP_WORKSPACE` for custom `workspaceDir`, `fpp.governance`, seeded introspection tools, adopt→audit init, verify-install warns, and claim-class limits. Note ClawHub skill still lacks full `CAPABILITY_STATUS.md` — point operators to GitHub for the matrix; keep SKILL caveats accurate.

**Files:**
- Modify: `docs/COMPATIBILITY.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `docs/CAPABILITY_STATUS.md` (dispatcher / audit / verify-install gap rows)
- Modify: `SKILL.md` / `hooks/constitution-audit/SKILL.md` only where adopt/audit path language is wrong
- Modify: `plugin/README.md`, `plugin-trust/README.md` (trust tools no longer self-abstain under default unattended)

**Steps:**
1. Update path examples to absolute-or-`FPP_WORKSPACE` guidance.
2. State explicitly: allowing `fpp_*` / `memory_search` ≠ behavioral compliance.
3. No CAPABILITY_STATUS row may claim completeness.

**Definition of Done:**
- [ ] Target tests pass (doc-coupled tests e.g. skill-metadata if paths asserted)
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated

### Task 10: Unattended e2e — `fpp_trust_status` allows; unknown still abstains

**Objective:** End-to-end (or plugin integration) proof that unattended disposition allows `fpp_trust_status` and `memory_search`, while a random unknown tool still abstains.

**Files:**
- Modify or Create: `plugin/src/index.test.ts` / `plugin/src/security-regressions.test.ts` and/or `test/**` e2e
- Test: same

**Steps:**
1. RED then GREEN for the three cases under `dispositionMode: "unattended"`.
2. Run `npm run test -w @ovrsr/openclaw-fpp-plugin` and relevant script tests.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

## Testing Strategy

- **Unit:** workspace absolutization (protocol-core + skill-lib); classifier `fpp.governance`; disposition allow vs abstain; verify-install warn fixtures with injectable CWD/homedir/plugin list.
- **Integration:** plugin `before_tool_call` unattended cases; adopt → audit chain verify in temp dirs.
- **Regression:** unknown tools still abstain in unattended; hard-floor blocks unchanged; `peerAdvertisable` formula unchanged (assert tests still pass).
- **TDD:** every task starts RED for the behavior named in its objective.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Absolute openclaw root breaks operators who relied on CWD-relative layout outside home | `FPP_WORKSPACE` override; absolutizer; TROUBLESHOOTING |
| Seeding `memory_search` widens allow surface | Exact-name only; documented list; unknown still abstain |
| `fpp_` prefix abuse to smuggle risky tools | Match only after specific classifiers; name `fpp_shell_exec` still hits exec classifier if tool name matches exec patterns — verify order; prefer prefix check only on fallthrough |
| Adopt audit write surprises existing adopters on re-run | Only on actual accept transition / first write; dry-run safe |
| Version-drift warn noisy | Warn not fail; skip when fields absent |
| Q5-B temptation | Locked A unless user re-approves before implement |

## Handoff

Plan path: `docs/plans/2026-07-15-meta-eval-remediation.md`

Review the locked choices (especially **Q5-A**). On approval, run:

```text
/implement docs/plans/2026-07-15-meta-eval-remediation.md
```
