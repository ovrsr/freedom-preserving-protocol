# Hotfix: Normalize OpenClaw-mangled FPP tool names

**Status:** COMPLETE
**Created:** 2026-07-16
**Depends on:** `2026-07-15-meta-eval-remediation.md` (shipped); live host audit 2026-07-15/16
**Unblocks:** Unattended `fpp_trust_status` / trust introspection when OpenClaw prefixes tools as `openclawfpp_*`
**Scope:**
- **In:** Normalize live OpenClaw PreToolUse names `openclawfpp_*` → `fpp_*` before classify; unit + plugin e2e; TROUBLESHOOTING note; bump enforcement plugin patch version for release.
- **Out:** Changing `knownCustomTools` empty-array merge semantics; skill dep install on host; backfilling `constitution-audit.jsonl`; trust plugin bump; ClawHub publish (separate).

## Summary

Live audit showed enforcement `1.1.8` still abstaining `openclawfpp_trust_status` as `unknown.unclassified`. Remediation only matched `/^fpp_/`. OpenClaw surfaces trust tools without the underscore between `openclaw` and `fpp`. Normalize that mangling inside `classifyToolCall` so governance allow applies to the live name.

## Locked design

| ID | Choice |
|----|--------|
| N1 | Strip a leading `openclaw` prefix **only** when the remainder starts with `fpp_` (case-insensitive prefix match on `openclawfpp_`). |
| N2 | Normalize once at the start of `classifyToolCall` so exec/fs/http still win for names like `openclawfpp_shell_exec` → `fpp_shell_exec`. |
| N3 | Do not broaden to arbitrary `openclaw*` prefixes. |

## Feature Inventory

| Existing | Change | Task |
|----------|--------|------|
| `classifyToolCall` `/^fpp_/` only | + `normalizeOpenClawToolName` before classify | 1 |
| Plugin e2e `fpp_trust_status` only | + e2e for `openclawfpp_trust_status` | 2 |
| TROUBLESHOOTING / CAPABILITY_STATUS fpp_* wording | Note OpenClaw mangled form | 3 |
| `plugin/package.json` 1.1.8 | Patch → 1.1.9 | 3 |

## Progress Tracking

**Completed:** 3 | **Remaining:** 0

- [x] Task 1: Classifier normalize + unit tests
- [x] Task 2: Plugin unattended e2e for live mangled name
- [x] Task 3: Docs note + enforcement plugin 1.1.9 bump

## Tasks

### Task 1: Classifier normalize + unit tests

**Objective:** `openclawfpp_trust_status` → `fpp.governance` / allow; plain unknowns unchanged.

**Steps:**
1. RED: tests for mangled governance allow + mangled exec still hits exec + unknown unchanged.
2. GREEN: export `normalizeOpenClawToolName`; apply in `classifyToolCall`.

**DoD:** Unit tests green; `/^fpp_/` behavior preserved for un-mangled names.

### Task 2: Plugin unattended e2e for live mangled name

**Objective:** Hook path allows `openclawfpp_trust_status` in unattended mode.

**DoD:** security-regressions e2e green.

### Task 3: Docs note + enforcement plugin 1.1.9 bump

**Objective:** Operators know about mangling; plugin ready to publish as 1.1.9.

**DoD:** TROUBLESHOOTING (and brief CAPABILITY_STATUS/COMPATIBILITY if needed) updated; `plugin/package.json` (+ lock if present) at 1.1.9.

## Definition of Done

- [x] Mangled name classifies as `fpp.governance` allow
- [x] Unattended plugin e2e allows mangled trust status
- [x] Unknown tools still abstain/approval
- [x] Plugin version 1.1.9
- [x] Enforcement-core + plugin tests pass
