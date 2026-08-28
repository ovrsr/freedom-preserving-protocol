# Ratification Research Navigation Documents

**Status:** COMPLETE
**Created:** 2026-07-20
**Scope:** In: add overview, synthesis, and artifact-index documents under `docs/external/ratification/`. Out: alter research artifacts, governance specifications, or ratification decisions.

## Summary

Create three complementary entry points for the ratification research packet:

- `README.md` explains the directory's purpose, status, contents, and recommended reading order.
- `SUMMARY.md` condenses the cross-model consensus, material disagreements, and decision-ready conclusions.
- `INDEX.md` catalogs every current artifact by role and provides direct relative links.

The documents will clearly distinguish external research from normative FPP specifications and preserve the repository's `UNRESOLVED` ratification status.

## Architecture Notes

- The directory currently contains one background debate, one source packet, three first-pass model responses, and three second-pass syntheses.
- Navigation will be layered: orientation in `README.md`, substantive synthesis in `SUMMARY.md`, and exhaustive lookup in `INDEX.md`.
- Links will be relative and will use Markdown destinations that safely handle spaces and parentheses in filenames.
- The three documents will not introduce a new ratification decision or imply that external model consensus changes normative repository status.

## Progress Tracking

- [x] Task 1: Create the directory README
- [x] Task 2: Create the consolidated summary
- [x] Task 3: Create the artifact index and verify navigation

**Total Tasks:** 3 | **Completed:** 3 | **Remaining:** 0

## Implementation Tasks

### Task 1: Directory README

**Objective:** Create a concise landing page that explains why the research collection exists, how it relates to FPP governance documents, and how readers should approach the artifacts.

**Files:**
- Create: `docs/external/ratification/README.md`

**Steps:**
1. Describe the research packet's scope and non-normative status.
2. Explain the source-packet, first-pass, and second-pass structure.
3. Add a recommended reading order with links to `SUMMARY.md` and `INDEX.md`.
4. State the key provenance and interpretation cautions, including that Phase 5+ is external/provisional and ratification remains unresolved.

**Definition of Done:**
- [x] Purpose and status are explicit
- [x] Reading paths are clear
- [x] Navigation links use the intended relative destinations
- [x] No research conclusion is presented as ratified FPP policy

### Task 2: Consolidated summary

**Objective:** Synthesize the eight existing artifacts into a compact account of shared findings, meaningful differences, and the resulting research disposition.

**Files:**
- Create: `docs/external/ratification/SUMMARY.md`

**Steps:**
1. Summarize the consensus on lineage, maturity, heterogeneous chambers, human non-participant safeguards, and adversarial validation.
2. Capture material refinements and disagreements, including chamber composition, anchor scope, ballot properties, and threshold uncertainty.
3. Separate decision-ready recommendations from unresolved empirical or governance questions.
4. Link readers to the source packet and artifact index for evidence and provenance.

**Definition of Done:**
- [x] All major consensus themes are represented
- [x] Material disagreements remain visible
- [x] Normative status is not overstated
- [x] Claims are traceable to the indexed source artifacts

### Task 3: Artifact index and navigation verification

**Objective:** Catalog every current artifact with a short description and verify all links among the new navigation documents.

**Files:**
- Create: `docs/external/ratification/INDEX.md`
- Verify: `docs/external/ratification/README.md`
- Verify: `docs/external/ratification/SUMMARY.md`

**Steps:**
1. Group the source packet, first-pass responses, and second-pass syntheses.
2. Add a direct relative link and concise role description for each of the eight current artifacts.
3. Add cross-links among `README.md`, `SUMMARY.md`, and `INDEX.md`.
4. Run a fresh local Markdown-link validation or equivalent file-existence check for every relative link in the three new files.
5. Review the diff to confirm no existing research artifact was changed.

**Definition of Done:**
- [x] All eight existing artifacts are indexed
- [x] All relative links resolve
- [x] README, summary, and index cross-link cleanly
- [x] Existing research artifacts remain unchanged

## Testing Strategy

This is documentation-only work, so TDD, type checking, and runtime tests do not apply. Verification will consist of:

1. A fresh relative-link existence check over the three new Markdown files.
2. A content check confirming all eight current artifacts appear in `INDEX.md`.
3. A Git diff/status review confirming only the plan and requested documents changed during this task.

## Risks & Mitigations

- **Risk:** External analysis is mistaken for normative FPP policy.  
  **Mitigation:** Put a prominent non-normative status statement in all three entry points.
- **Risk:** Filenames containing spaces and parentheses produce broken links.  
  **Mitigation:** Use safe Markdown link destinations and verify each target locally.
- **Risk:** Compression hides model disagreement or unsupported numerical thresholds.  
  **Mitigation:** Preserve a dedicated unresolved/differences section and label thresholds provisional.
- **Risk:** New research artifacts later make the index stale.  
  **Mitigation:** Explain that `INDEX.md` is the maintained inventory for this directory.
