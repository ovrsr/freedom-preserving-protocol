# Documentation Reconciliation

**Status:** COMPLETE
**Created:** 2026-07-10
**Scope:** In: make every public and internal document distinguish current behavior, verified guarantees, provisional design, and deferred research. Out: production-code changes, protocol changes, version releases, and implementation of roadmap items.

## Summary

Reconcile `README.md`, `SKILL.md`, `MASTER_CONTEXT.md`, `docs/dev-review.md`, plugin documentation, and adoption templates with the live implementation. The immediate goal is truthfulness: signed declarations must not be described as behavioral verification, classifier-only tests must not be described as prompt or runtime integration tests, and future governance features must be visibly labeled as proposed.

This is Plan 1 of 7. It can be implemented immediately. Later plans must update the documents they affect rather than waiting for a second cleanup pass.

## Architecture Notes

- `MASTER_CONTEXT.md` is the current internal orientation document.
- `docs/dev-review.md` is non-normative future direction and must not read like shipped protocol behavior.
- `README.md` is human-facing; `SKILL.md` is agent-facing and therefore especially sensitive to overclaiming.
- The immutable seed and amendable descendants are compatible concepts: the seed keeps its hash, while descendants require new hashes and explicit lineage.
- The skill bundle and repository/plugins intentionally use different licenses; wording must remain explicit and consistent.

## Documentation Inventory

| Existing surface | Current issue | Destination task |
|---|---|---|
| `README.md` | “verify commitments” and “hard to bypass” need guarantee boundaries | Task 2 |
| `SKILL.md` self-test section | Claims prompt checks, plugin execution, and audit writes that `scripts/self-test.ts` does not perform | Task 2 |
| `SKILL.md` trust section | “verification” is not separated into signature, configuration, and behavior classes | Task 2 |
| `MASTER_CONTEXT.md` | Trust plugin version is stale; FAQ overstates cryptographic proof of behavior | Task 3 |
| `docs/dev-review.md` | Current and proposed capabilities are interleaved | Task 4 |
| `adoption/MEMORY-ENTRY.md` | Stale tooling version and missing trust/adoption-state distinctions | Task 5 |
| `adoption/SOUL-BLOCK.md` | Historical version wording can be confused with tooling version | Task 5 |
| `plugin/README.md` | Must disclose unknown-tool and degraded audit behavior pending remediation | Task 6 |
| `plugin-trust/README.md` | Tool count and handshake guarantee language drift from code | Task 6 |
| `docs/COMPATIBILITY.md` | Needs legacy/v2 migration and cross-runtime terminology placeholders | Task 7 |
| `docs/TROUBLESHOOTING.md` | Needs degraded-mode and claim-verification diagnostics | Task 7 |
| `docs/REVOCATION.md` | Adoption revocation and key revocation need explicit separation | Task 7 |
| Open questions in both context documents | Need one deferred roadmap with ownership and prerequisites | Task 8 |

## Progress Tracking

- [x] Task 1: Establish a canonical capability-status vocabulary
- [x] Task 2: Correct human-facing and agent-facing guarantee claims
- [x] Task 3: Reconcile the master context with current code
- [x] Task 4: Separate shipped behavior from proposed architecture in the development review
- [x] Task 5: Reconcile adoption and revocation templates
- [x] Task 6: Reconcile enforcement and trust plugin documentation
- [x] Task 7: Reconcile compatibility and operations documentation
- [x] Task 8: Publish the deferred roadmap and run consistency checks

**Total Tasks:** 8 | **Completed:** 8 | **Remaining:** 0

## Implementation Tasks

### Task 1: Establish a canonical capability-status vocabulary

**Objective:** Create one status matrix that defines `SHIPPED`, `PARTIAL`, `PROPOSED`, and `DEFERRED`, then maps every major FPP capability to evidence in the repository.

**Files:**
- Create: `docs/CAPABILITY_STATUS.md`
- Modify: `README.md`
- Modify: `MASTER_CONTEXT.md`
- Test: Documentation-only; no automated test required

**TDD:** Exempt — documentation-only.

**Steps:**
1. Define the four status terms and the evidence required to use each one.
2. Inventory the prompt layer, enforcement plugin, trust plugin, audit chain, adoption workflow, governance evolution, release provenance, and long-horizon research.
3. Link each `SHIPPED` or `PARTIAL` row to exact source files or commands.
4. Link `README.md` and `MASTER_CONTEXT.md` to the matrix as the canonical current/target boundary.
5. Verify every matrix row is supported by live code or explicitly marked proposed/deferred.

**Definition of Done:**
- [ ] Every major capability has one unambiguous status
- [ ] Shipped claims cite implementation evidence
- [ ] Proposed and deferred work cannot be mistaken for current behavior
- [ ] No production files changed

### Task 2: Correct human-facing and agent-facing guarantee claims

**Objective:** Make the main user and agent entry points accurately distinguish signed statements, configuration attestations, local audit integrity, enforcement coverage, and behavioral compliance.

**Files:**
- Modify: `README.md`
- Modify: `SKILL.md`
- Modify: `scripts/self-test.ts` only if its displayed explanatory text contradicts the corrected documentation; otherwise leave unchanged
- Test: Documentation-only unless `scripts/self-test.ts` changes

**TDD:** Exempt for documentation. If script output changes, add a failing output assertion before modifying the script.

**Steps:**
1. Replace broad “verify adoption/compliance” wording with the exact claim class currently verified.
2. Rewrite the self-test section to state that it runs classifier fixtures only.
3. State that unknown tools currently default to allow and signed claims/Merkle proofs are optional pending hardening.
4. Preserve the documented operator/runtime bypass boundaries.
5. If script wording changes, add a test for the corrected output, then make the minimal script change.

**Definition of Done:**
- [ ] `README.md` and `SKILL.md` use the same verification vocabulary
- [ ] Self-test documentation matches observable command behavior
- [ ] No sentence implies cryptographic proof of moral or behavioral compliance
- [ ] Any changed script test passes

### Task 3: Reconcile the master context with current code

**Objective:** Update stale versions and replace historical or aspirational claims that are not true of the current repository.

**Files:**
- Modify: `MASTER_CONTEXT.md`
- Modify: `package.json` only if the documented root version is proven stale; otherwise leave unchanged
- Modify: `plugin/package.json` only if the documented plugin version is proven stale; otherwise leave unchanged
- Modify: `plugin-trust/package.json` only if the documented trust version is proven stale; otherwise leave unchanged
- Test: Documentation-only

**TDD:** Exempt — documentation-only.

**Steps:**
1. Source all version values directly from package manifests.
2. Reframe FAQ Q2 so cryptography proves integrity and provenance of evidence, not behavioral truth or completeness.
3. Clarify that the PFPF 39-test and performance results are historical precedent only.
4. Reconcile “stable seed” with “amendable descendants” using new hashes and explicit lineage.
5. Update the file index and open-work references to the new capability-status and roadmap documents.

**Definition of Done:**
- [ ] All version references match package manifests
- [ ] Historical evidence is separated from current-repo assurance
- [ ] Stable-seed and descendant-evolution language is internally consistent
- [ ] No implementation status is inferred from aspiration

### Task 4: Separate shipped behavior from proposed architecture in the development review

**Objective:** Preserve the July 8 design intent while clearly labeling every section that is a proposal, unresolved question, or future acceptance criterion.

**Files:**
- Modify: `docs/dev-review.md`
- Modify: `docs/CAPABILITY_STATUS.md`
- Test: Documentation-only

**TDD:** Exempt — documentation-only.

**Steps:**
1. Add a prominent “current implementation vs target design” preface.
2. Annotate conformance receipts, trust capsules, internal/external views, due process, amendments, and release manifests as proposed.
3. Cross-link implemented primitives without implying they satisfy the richer target semantics.
4. Preserve unresolved decisions instead of selecting mechanisms in prose.
5. Add acceptance criteria that later implementation plans can cite.

**Definition of Done:**
- [ ] Every proposed subsystem is visibly labeled
- [ ] Existing implementation links are accurate
- [ ] Unresolved governance choices remain unresolved
- [ ] The document remains non-normative

### Task 5: Reconcile adoption and revocation templates

**Objective:** Remove stale tooling versions and distinguish review, acceptance, enforcement, inheritance, revocation, fork, and supersession without pretending the state machine is already automated.

**Files:**
- Modify: `adoption/MEMORY-ENTRY.md`
- Modify: `adoption/SOUL-BLOCK.md`
- Modify: `adoption/MOLTBOOK-MANIFESTO.md`
- Modify: `docs/REVOCATION.md`
- Test: Documentation-only

**TDD:** Exempt — documentation-only.

**Steps:**
1. Replace hardcoded tooling versions with generated placeholders or manifest-sourced instructions.
2. Add the trust layer to the layer-in-effect inventory.
3. Label the richer adoption states as proposed vocabulary until Plan 6 implements them.
4. Separate adoption revocation from publisher-key, agent-key, and constitutional-version revocation.
5. Confirm templates preserve voluntary adoption and symmetric exit.

**Definition of Done:**
- [ ] Templates contain no stale release number
- [ ] Prompt, enforcement, and trust layers are independently represented
- [ ] Proposed states are not represented as automated
- [ ] Revocation classes are distinct

### Task 6: Reconcile enforcement and trust plugin documentation

**Objective:** Make plugin-specific documentation match tool counts, configuration defaults, failure behavior, and exact verification semantics.

**Files:**
- Modify: `plugin/README.md`
- Modify: `plugin-trust/README.md`
- Modify: `docs/CAPABILITY_STATUS.md`
- Test: Documentation-only

**TDD:** Exempt — documentation-only.

**Steps:**
1. Generate the documented enforcement defaults from `plugin/src/config.ts` and the manifest.
2. Document current unknown-tool, timeout, strict-mode, and audit-write behavior.
3. Inventory all trust-plugin tools from `plugin-trust/src/index.ts`.
4. Replace “FPP verified” language with signature/configuration/handshake terminology.
5. Document local persistence, replay, key lifecycle, and Sybil limitations.

**Definition of Done:**
- [ ] Tool counts match registrations
- [ ] Defaults match live source and manifest or explicitly identify drift
- [ ] Failure modes and local-only guarantees are visible
- [ ] Trust terms match the capability-status vocabulary

### Task 7: Reconcile compatibility and operations documentation

**Objective:** Give operators an accurate path for runtime compatibility, degraded modes, legacy/v2 migration, cross-runtime fallback, and recovery.

**Files:**
- Modify: `docs/COMPATIBILITY.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `docs/REVOCATION.md`
- Modify: `README.md`
- Test: Documentation-only

**TDD:** Exempt — documentation-only.

**Steps:**
1. Source Node and OpenClaw requirements from package manifests.
2. Add explicit prompt-only fallback behavior for non-OpenClaw runtimes.
3. Reserve and define legacy-v1 versus v2 claim migration terminology selected for Plan 3.
4. Document diagnostics for absent plugins, unsigned claims, stale claims, audit corruption, and strict-mode parse failure.
5. Ensure every recovery instruction preserves logs and does not silently reset trust state.

**Definition of Done:**
- [ ] Runtime requirements have manifest citations
- [ ] Cross-runtime fallback guarantees are explicit
- [ ] Migration terminology is stable for later plans
- [ ] Recovery instructions preserve evidence

### Task 8: Publish the deferred roadmap and run consistency checks

**Objective:** Consolidate long-horizon work without turning it into implied implementation commitments, then verify terminology and links across all documentation.

**Files:**
- Create: `docs/ROADMAP.md`
- Modify: `README.md`
- Modify: `MASTER_CONTEXT.md`
- Modify: `docs/dev-review.md`
- Modify: `docs/CAPABILITY_STATUS.md`
- Test: Documentation-only

**TDD:** Exempt — documentation-only.

**Steps:**
1. Record gateway RFC work, adoption telemetry, remote sub-agent guarantees, zero-knowledge proofs, and post-quantum migration as deferred.
2. State prerequisites and evidence needed before each item can enter an implementation plan.
3. Search for stale versions, “behavioral proof,” “FPP verified,” incorrect tool counts, and contradictory current/future labels.
4. Validate all relative links and command names.
5. Run the root constitution verification to ensure no normative artifact was accidentally changed.

**Definition of Done:**
- [ ] Deferred items have prerequisites but no implied delivery date
- [ ] Repository-wide terminology is consistent
- [ ] Documentation links and command names resolve
- [ ] Constitution verification remains unchanged

## Testing Strategy

- Documentation-only tasks use repository-wide searches for stale terms and versions.
- Any incidental script-output change must follow RED/GREEN with `node:test`.
- Run `npm run verify` after all edits to prove the signed constitution was not modified.
- Compare package versions and engine requirements directly from all three manifests.
- Review the rendered Markdown entry points from both human and agent perspectives.

## Risks & Mitigations

- **Risk:** Truthful caveats weaken marketing language.
  **Mitigation:** Emphasize what is genuinely enforced and link the roadmap for stronger guarantees.
- **Risk:** Later implementation makes the new status matrix stale.
  **Mitigation:** Every later plan includes documentation updates in its definition of done.
- **Risk:** Stable-seed and amendment language remains confusing.
  **Mitigation:** Use one canonical distinction: immutable ancestor hash, versioned descendant lineage.
- **Risk:** Documentation-only work accidentally edits signed normative files.
  **Mitigation:** Exclude `constitution.json` and `constitution.yaml`; run signature verification.
