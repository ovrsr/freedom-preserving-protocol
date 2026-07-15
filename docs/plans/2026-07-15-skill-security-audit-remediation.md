# Skill Security Audit Remediation (OpenClaw-Only ClawHub Surface)

**Status:** COMPLETE
**Created:** 2026-07-15
**Scope:**
- **In:** Remediate practical findings from `docs/security-audit-reports/skill-2026-07-14.md` by (1) publishing an **allowlisted OpenClaw-only skill** to ClawHub instead of the monorepo root, (2) fixing the real `revokeAdoption` integrity gap, (3) aligning skill metadata/permissions/triggers/disclosure with that slim surface, (4) hardening maintainer publish gates and leftover monorepo scripts/adapters that remain in git only.
- **Out (confirmed):** Publishing Cursor/Claude Code/Codex adapters to ClawHub; changing unattended mandate-allow product semantics beyond disclosure; chasing VirusTotal/static false positives on test `child_process`, plan-doc “secret”, or classifier fixture URLs; publishing `@ovrsr/fpp-*-core` to npm; changing the seed constitution hash.

## Summary

SkillSpector flagged undeclared capabilities (env config, network `--fetch`, global hooks, `shell: true` npm lifecycle, broad triggers) because **`clawhub skill publish .` uploads nearly the whole repo**. `.clawhubignore` excludes `plugin/` and `packages/` but still ships `adapters/`, maintainer `scripts/`, `docs/plans/`, `test/`, etc. That both inflates the attack/audit surface and breaks installed skill scripts that import excluded `packages/protocol-core`.

**Remediation strategy:** treat ClawHub as an OpenClaw host. Stage an allowlisted skill root (prompt + OpenClaw adoption tooling only). Keep adapters, monorepo cores, maintainer tooling, and non-OpenClaw docs in git. Point SKILL.md to ClawHub for OpenClaw plugins and to GitHub for other harnesses.

## Best-practice decisions (locked)

| Finding / topic | Decision |
|-----------------|----------|
| Packaging boundary | **Allowlist staging** → publish staged dir, not repo root denylist |
| Adapters / hooks `matcher: "*"` | **Stay in git only**; Claude Code `*` remains intentional for enforcement; document in adapter README |
| `FPP_ENFORCEMENT_CONFIG` | **Workspace-bound path validation** in adapter hook CLIs (monorepo); absent from skill package |
| Network `--fetch` (`rfc-citation-check`) | **Monorepo-only**; never staged into skill |
| `shell: true` in `package-reproducibility` | **Fix to `shell: false`** (Windows: `npm.cmd` / explicit argv); monorepo-only |
| `revokeAdoption` vs `main()` | **Chain verify inside exported API** (single code path) |
| `--skip-tests` | **Dual gate**: flag + `FPP_ALLOW_SKIP_TESTS=1` |
| Triggers / heartbeat | **Narrow triggers**; heartbeat requires explicit adoption + disclosure of audit writes |
| Unattended `allow` | **Product feature**; disclosure only |
| Static scanner FPs | **Document as accepted** in audit notes / TROUBLESHOOTING; no functional change |

## Architecture Notes

```
Git monorepo (source of truth)
├── SKILL.md, constitution*, adoption/, hooks/     ──┐
├── scripts/{adopt,revoke,audit,verify-*} (portable)─┼──▶ skill-dist/ (allowlist stage)
├── slim skill package.json + README (OpenClaw)     ──┘
│                                                      │
│                                              clawhub skill publish skill-dist/
│
├── plugin/, plugin-trust/  ──▶ clawhub package publish (unchanged)
├── adapters/*              ──▶ GitHub only (not ClawHub)
├── packages/*, docs/plans, test/, maintainer scripts ──▶ GitHub only
└── stale package/          ──▶ remove / stop shipping
```

**Why allowlist staging (not bigger `.clawhubignore`):** denylists rot when new dirs appear (`assurance-artifacts/`, `docs/security-audit-reports/`, etc.). An allowlist + CI test that fails if forbidden paths appear in the stage is durable.

**Skill runtime portability:** staged scripts must not import `plugin/`, `adapters/`, or `packages/*` via relative monorepo paths. Extract a small skill-local lib (hash/audit/workspace helpers + minimal types) so adopt/revoke/audit/verify work after ClawHub install with only `@noble/*` (and `tsx` if still used).

**Stale `package/`:** outdated snapshot that still embeds plugin sources. Replace with generated `skill-dist/` (gitignored) or a generated-checked allowlist test; delete stale tree.

## Feature Inventory

| Current surface / behavior | Remediation task |
|----------------------------|------------------|
| `clawhub skill publish .` from repo root | Tasks 1–2, 8 |
| `.clawhubignore` incomplete denylist; ships adapters/docs/tests | Task 1 |
| Stale `package/` skill snapshot with embedded plugin | Task 1 |
| Skill scripts import `packages/protocol-core`, `plugin/src/*`, adapters | Tasks 3–4 |
| `self-test` imports plugin classifier (not skill-portable) | Task 4 |
| `revokeAdoption()` skips audit-chain verify that `main()` enforces | Task 5 |
| Broad SKILL triggers + heartbeat silent writes + over-broad framing | Tasks 6–7 |
| Permissions omit network/env while root still ships those scripts | Tasks 1, 6 (surface shrink) |
| `--skip-tests` single flag | Task 8 |
| Adapter `FPP_ENFORCEMENT_CONFIG` env redirect; `shell: true` in reproducibility | Task 9 |
| Publish docs / learned skill still say “publish .” | Task 10 |

## Progress Tracking

- [x] Task 1: Skill allowlist + staging script + forbidden-path tests
- [x] Task 2: Slim staged skill manifest (package.json / README) OpenClaw-only
- [x] Task 3: Skill-portable adopt/revoke/audit/verify-constitution scripts
- [x] Task 4: OpenClaw-only verify-install + skill self-check (no plugin import)
- [x] Task 5: Close `revokeAdoption` audit-chain integrity gap
- [x] Task 6: SKILL.md metadata — triggers, permissions, activation boundaries, OpenClaw framing
- [x] Task 7: Heartbeat / adoption disclosure for audit writes
- [x] Task 8: Publish path uses stage; harden `--skip-tests` dual gate
- [x] Task 9: Monorepo hardening — config path validation + `shell: false`
- [x] Task 10: Docs, TROUBLESHOOTING, learned publishing skill; remove stale `package/`

**Total Tasks:** 10 | **Completed:** 10 | **Remaining:** 0

## Implementation Tasks

### Task 1: Skill allowlist + staging script + forbidden-path tests

**Objective:** Generate a ClawHub skill root from an explicit allowlist and refuse to stage non-OpenClaw paths (adapters, plugins, packages, plans, tests, maintainer scripts).

**Files:**
- Create: `scripts/stage-skill.ts`
- Create: `scripts/stage-skill.test.ts`
- Create: `skill/ALLOWLIST` (or embed allowlist in `stage-skill.ts` — prefer a checked-in list file)
- Modify: `.gitignore` (ignore generated `skill-dist/`)
- Modify: `.clawhubignore` only if still used as belt-and-suspenders inside the stage; prefer stage as sole publish root

**Allowlist (initial):**
- `SKILL.md`, `constitution.json`, `constitution.yaml`, `pubkey.ed25519.txt`, `signature.ed25519.txt`
- `adoption/**`
- `hooks/**` (prompt-layer + heartbeat skills only)
- Skill-portable scripts produced/copied by Tasks 3–4
- Slim `package.json` / `README.md` / `LICENSE` (or MIT-0 text) from Task 2
- Minimal OpenClaw-facing docs only: e.g. `docs/REVOCATION.md`, OpenClaw excerpt of compatibility (or a short `docs/OPENCLAW.md` generated/copied) — **not** `docs/plans/`, `docs/rfc/`, `docs/security-audit-reports/`, `docs/runbooks/{cursor,claude-code,codex}.md`

**Forbidden (must fail tests if present in stage):**
- `adapters/`, `plugin/`, `plugin-trust/`, `packages/`, `test/`, `assurance-artifacts/`, `docs/plans/`, `MASTER_CONTEXT.md`, `scripts/clawhub-publish.sh`, `scripts/package-reproducibility.ts`, `scripts/rfc-citation-check.ts`, `scripts/bundle-workspace-deps.ts`

**Steps:**
1. RED: tests assert staging produces expected files and fails (or omits) when forbidden paths would be included; assert adapters never appear.
2. GREEN: implement `npx tsx scripts/stage-skill.ts --out skill-dist` (clean out dir, copy allowlist, write manifest stamp).
3. Confirm tests pass; typecheck touched scripts.
4. Document CLI usage in script header only.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 2: Slim staged skill manifest (package.json / README) OpenClaw-only

**Objective:** Provide a skill `package.json` and README that describe an OpenClaw prompt-layer skill with adopt/verify/revoke scripts — no npm workspaces, no adapter install paths.

**Files:**
- Create: `skill/package.json` (template copied into `skill-dist/`) **or** generate from root fields in `stage-skill.ts`
- Create: `skill/README.md` (OpenClaw install + ClawHub plugin URIs + link to GitHub for other harnesses)
- Modify: root `README.md` only if needed to clarify ClawHub vs git surfaces (keep brief)

**Steps:**
1. RED: staging test asserts staged `package.json` has no `workspaces`, does not reference `adapters/*`, and `engines.node` is set; README mentions `clawhub:ovrsr/openclaw-fpp-plugin` and does not instruct merging Claude Code hook fragments from this package.
2. GREEN: templates + stage copy.
3. Confirm tests pass.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 3: Skill-portable adopt/revoke/audit/verify-constitution scripts

**Objective:** Make skill adoption tooling runnable after ClawHub install without monorepo `packages/` or `plugin/` trees.

**Files:**
- Create: `scripts/skill-lib/` (minimal hash/audit/workspace helpers + types used by skill scripts) **or** equivalent under `skill/scripts/lib/`
- Modify: `scripts/safe-append.ts`, `scripts/revoke.ts`, `scripts/audit-append.ts`, `scripts/audit-verify.ts`, `scripts/adoption-state.ts`, `scripts/merkle.ts`, `scripts/verify-constitution.ts` (and tests) to consume skill-lib instead of relative `packages/` / workspace package imports — **or** keep monorepo scripts as wrappers and ship copies under `skill/scripts/` maintained by stage script
- Test: existing `scripts/*.test.ts` plus new portability tests that run against a staged tree

**Preferred design:** one implementation of skill-lib used by both monorepo and stage (no drift). Monorepo may still import full `@ovrsr/fpp-protocol-core` from plugins/cores elsewhere; skill path must not require it at runtime after install.

**Steps:**
1. RED: test that importing/running adopt+audit helpers from a temp dir containing only staged files succeeds (no `packages/` present).
2. GREEN: extract skill-lib; rewire skill scripts; stage copies skill-lib + scripts.
3. Run script tests + typecheck.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 4: OpenClaw-only verify-install + skill self-check (no plugin import)

**Objective:** Replace skill-facing `self-test` / `verify-install` surfaces that pull in `plugin/src/risk-classifier` or adapter paths with OpenClaw-appropriate checks.

**Files:**
- Modify: `scripts/self-test.ts` (split: monorepo classifier probe stays git-only; skill ships a prompt/install self-check)
- Modify: `scripts/verify-install.ts` (default/`openclaw` profile only in staged skill; adapter profiles remain in monorepo build)
- Test: `scripts/verify-install.test.ts`, new skill self-check tests
- Modify: staged `package.json` scripts accordingly

**Steps:**
1. RED: staged tree must not contain `from "../plugin/` or `adapters/` imports; skill self-check documents it does not exercise dispatcher classifier.
2. GREEN: OpenClaw verify-install (constitution, signature, SOUL/MEMORY, audit chain, `openclaw plugins list` probe); skill self-check without plugin import.
3. Monorepo retains full multi-profile verify-install for developers.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 5: Close `revokeAdoption` audit-chain integrity gap

**Objective:** Ensure the exported `revokeAdoption()` API refuses to mutate state when the audit chain is forged, matching `main()` and the file-level contract.

**Files:**
- Modify: `scripts/revoke.ts`
- Modify: `scripts/revoke.test.ts`

**Steps:**
1. RED: test that `revokeAdoption()` on a tampered log throws/exits without writing SOUL/MEMORY/audit/marker (unless explicit override — **do not add override** unless required; prefer hard refuse).
2. GREEN: call `verifyAuditChain` inside `revokeAdoption()` before mutations; `main()` delegates to it (no duplicated write path).
3. Confirm tests pass.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 6: SKILL.md metadata — triggers, permissions, activation boundaries, OpenClaw framing

**Objective:** Align skill frontmatter and framing with the OpenClaw-only package so scanners and agents see accurate capabilities and narrower activation.

**Files:**
- Modify: `SKILL.md` (source of truth; staged copy)
- Modify: `hooks/pre-action-check/SKILL.md` / `hooks/constitution-audit/SKILL.md` only as needed for consistency

**Changes:**
- Narrow `triggers` to explicit FPP phrases (e.g. keep `freedom preserving protocol`, `adopt fpp`, `fpp consent`; drop or qualify vague `self-governance` / bare `agent constitution` if they fire too broadly — prefer `fpp agent constitution` / `freedom preserving protocol constitution`)
- Permissions: declare only what staged skill needs (`filesystem:read`, `filesystem:write`, `shell:execute` for adopt/verify/revoke). **Do not** declare network. Document that adapters/env config are not part of this package.
- Strengthen “What This Package Actually Is”: ClawHub skill = OpenClaw prompt-layer only; plugins via ClawHub URIs; other harness adapters via GitHub clone — never merge hook configs from this skill package.
- Add short **activation boundaries** (when to load / when not to govern).

**Steps:**
1. RED: content tests or stage assertions on frontmatter permissions/triggers and absence of adapter hook install instructions as primary path.
2. GREEN: edit SKILL.md; bump skill version only when publishing (implement may bump or leave for publish script).
3. Confirm tests pass.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 7: Heartbeat / adoption disclosure for audit writes

**Objective:** Make persistent audit-log writes explicit at adoption and in the heartbeat skill so background governance is not silent.

**Files:**
- Modify: `hooks/constitution-audit/SKILL.md`
- Modify: `SKILL.md` adoption permission speech / step text
- Modify: `adoption/SOUL-BLOCK.md` and/or `adoption/MEMORY-ENTRY.md` if a one-line disclosure belongs there

**Steps:**
1. RED: assert heartbeat skill text requires prior adoption and discloses `.openclaw/workspace/constitution-audit.jsonl` writes; adoption user-permission text mentions the audit path before first write.
2. GREEN: edit copy; keep cadence but frame as post-adoption opt-in heartbeat, not ambient surveillance.
3. Confirm tests/assertions pass.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 8: Publish path uses stage; harden `--skip-tests` dual gate

**Objective:** `publish skill` stages then publishes `skill-dist/`; `--skip-tests` requires `FPP_ALLOW_SKIP_TESTS=1`.

**Files:**
- Modify: `scripts/clawhub-publish.sh`
- Modify: `scripts/clawhub-publish.test.ts`
- Modify: `scripts/clawhub-publish.sh` `run_strict_checks_skill` to run stage + allowlist verification (+ skill-portable self-check)

**Steps:**
1. RED: dry-run without stage mention fails assertion; `--skip-tests` without env fails; with both, dry-run still does not call registry.
2. GREEN: `publish_skill` runs `stage-skill`, then `clawhub skill publish skill-dist ...`; dual-gate skip-tests for all targets.
3. Confirm publish tests pass.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 9: Monorepo hardening — config path validation + `shell: false`

**Objective:** Defense-in-depth for git-only surfaces still flagged by the audit.

**Files:**
- Modify: `adapters/{cursor,claude-code,codex}/src/hook-cli.ts` (+ tests)
- Modify: `scripts/package-reproducibility.ts` (+ tests)
- Modify: `adapters/claude-code/README.md` (and siblings) — document intentional `matcher` scope and `FPP_ENFORCEMENT_CONFIG` workspace restriction

**Steps:**
1. RED: config path outside workspace / profile root is rejected; `package-reproducibility` spawn uses `shell: false`.
2. GREEN: resolve+validate config under workspace profile directory (symlink-escape safe as practical); use `npm`/`npm.cmd` argv form without shell.
3. Confirm adapter + script tests pass.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 10: Docs, TROUBLESHOOTING, learned publishing skill; remove stale `package/`

**Objective:** Update operator docs so nobody publishes the repo root as a skill; remove the stale `package/` snapshot; note accepted scanner false positives.

**Files:**
- Modify: `docs/runbooks/dev-build-and-deploy.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `docs/COMPATIBILITY.md` (ClawHub skill = OpenClaw; other harnesses via git)
- Modify: `.claude/skills/learned-clawhub-publishing/SKILL.md`
- Modify: `docs/security-audit-reports/skill-2026-07-14.md` (short remediation mapping appendix — optional but useful)
- Delete: stale `package/**` tree (or replace with README pointing at `skill-dist` generation)

**Steps:**
1. Update publish examples to `stage-skill` → `clawhub skill publish skill-dist`.
2. Document recovery if an old fat skill install is present (reinstall slim skill; adapters from git if needed).
3. Remove stale `package/` after confirming nothing references it.
4. List accepted FPs (test `child_process`, plan “secret”, fixture URL) under TROUBLESHOOTING or audit appendix.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

## Testing Strategy

- **Unit:** stage allowlist/forbidden paths; `revokeAdoption` forged-log refusal; skip-tests dual gate; config path validation; `shell: false` spawn args.
- **Integration:** stage → run `verify` / adopt dry-run / audit verify inside `skill-dist` without monorepo siblings present (temp copy).
- **Publish dry-run:** `bash scripts/clawhub-publish.sh publish skill --dry-run --changelog test` shows stage + does not invoke registry.
- **Regression:** monorepo `npm run test:scripts` and adapter tests remain green; plugin publish path unchanged.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Skill-lib drifts from `@ovrsr/fpp-protocol-core` hashing | Single skill-lib used by skill scripts; interop test that skill hash matches protocol-core for a golden entry |
| Operators still have fat skill installs from older ClawHub versions | TROUBLESHOOTING reinstall steps; version bump on publish |
| Over-narrow triggers reduce discoverability | Keep explicit `freedom preserving protocol` / `adopt fpp`; document aliases in README |
| Windows `npm` without `shell: true` | Use `npm.cmd` on win32 with `shell: false` (existing project learning) |
| Deleting stale `package/` surprises someone | Grep references first; replace with pointer doc if needed |

## Audit finding → task map

| Finding | Severity | Task(s) |
|---------|----------|---------|
| Undeclared `FPP_ENFORCEMENT_CONFIG` / env trust boundary | High | 1 (out of skill), 9 |
| Undeclared network `--fetch` | High | 1, 3–4 (out of skill) |
| Breadth exceeds governance framing / Tp4 | High | 1–2, 6, 10 |
| Global PreToolUse `matcher: "*"` / hook command | Medium | 1 (out of skill), 9 docs |
| `shell: true` npm in package dirs | Medium | 1 (out of skill), 9 |
| `revokeAdoption` skips chain verify | Medium | 5 |
| Vague triggers / constitution activation | Medium | 6 |
| Heartbeat + silent audit writes | Medium | 7 |
| Unattended allow / no approval | Medium | Disclosure in 6 (no behavior change) |
| `--skip-tests` tool-parameter abuse | High (scanner) | 8 |
| Static FPs (tests, docs, fixtures) | Critical/Warn (noise) | 10 (document only) |
