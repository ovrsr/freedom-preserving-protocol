# Constitutional Lineage and Compatibility Classes

**Status:** `PROVISIONAL` specification — schema-shaped; not implemented as runtime validation.
**Plan:** `docs/plans/2026-07-10-5-governance-evolution-specification.md` Task 2
**Seed hash:** `71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993`
**Related:** `docs/dev-review.md` §10; Plan 3 claim/lineage schemas

---

## 1. Purpose

Descendants must prove ancestry without impersonating the signed seed. Changing any normative constitutional text always produces a **new** content hash. The seed hash never moves.

Package / tooling versions (`SKILL.md`, plugin semver) are **orthogonal** to constitutional lineage. A tooling bump that leaves `constitution.json` bytes unchanged remains `FPP-identical` to the seed.

---

## 2. Compatibility classes

| Class | Criteria (testable) | May claim seed hash? | May claim lineage from seed? |
|-------|---------------------|----------------------|------------------------------|
| **FPP-identical** | Byte-identical normative constitution (same SHA-256 as ancestor, typically the seed) and no substantive amendment list | Yes, if hash equals seed | Yes (trivial: self) |
| **FPP-compatible** | Descendant hash ≠ seed; lineage chain reaches seed; all `compatibilityRequirements` of the declared ancestor profile are satisfied; no entry in `coreDivergences` that the profile marks as compatibility-breaking | No | Yes |
| **FPP-derived** | Descendant hash ≠ seed; lineage chain reaches seed; one or more substantive divergences from the seed or from an intermediate ancestor | No | Yes |
| **FPP-inspired** | Borrows concepts, vocabulary, or structure without a verifiable hash lineage chain to the seed | No | No — must not present `fpp_lineage` as constitutional proof |

### Compatibility-breaking vs non-breaking (PROVISIONAL profile for seed Laws 1–4 floor)

Until a ratified compatibility profile exists, treat as **compatibility-breaking**:

- Weakening nonparticipant option protection (Law 1 floor)
- Removing accountable corrigibility or safe interruption (Law 2)
- Abolishing reversibility preference for high-impact acts (Law 3)
- Removing the commitment safety valve (Law 4)
- Abolishing exit, fork, or dissent recording
- Claiming the seed hash while normative text differs

Treat as **non-breaking** (still requires new hash + lineage) when clarifying procedures, adding optional evidence fields, or tightening (not loosening) protections.

**UNRESOLVED:** Exact machine-readable compatibility requirement vectors for future profiles — deferred to ratification + schema work; do not invent a silent default that pretends to be final.

---

## 3. Lineage record fields

Machine-oriented shape (aligned with `docs/dev-review.md` §10; examples under `examples/`):

| Field | Required | Meaning |
|-------|----------|---------|
| `schemaVersion` | yes | Lineage document version (e.g. `lineage-1`) |
| `constitutionHash` | yes | SHA-256 of **this** normative constitution bytes |
| `constitutionVersion` | yes | Human/semver label for this descendant (not tooling version) |
| `compatibility` | yes | One of `FPP-identical` \| `FPP-compatible` \| `FPP-derived` \| `FPP-inspired` |
| `ancestorHash` | conditional | Immediate parent constitution hash; omit only for the seed itself |
| `lineage` | yes | Ordered list of ancestor hashes from seed → parent (seed alone for identical seed record) |
| `amendments` | yes | List of amendment IDs applied since parent (empty if identical) |
| `coreDivergences` | yes | Human-readable substantive divergences (empty if none) |
| `effectiveDate` | yes | ISO-8601 activation time for this constitution version |
| `ratificationProofRef` | conditional | Reference to ratification evidence; required for non-identical classes that claim community activation |
| `supersedes` | optional | Hash of constitution this record replaces for a community |
| `forkOf` | optional | Hash forked from, when creating a divergent branch without superseding the parent community |
| `signature` | optional | Signature over the lineage payload by an authorized amendment/domain key |

### Invariants

1. If `constitutionHash` equals the seed hash, then `compatibility` MUST be `FPP-identical`, `amendments` MUST be `[]`, and `coreDivergences` MUST be `[]`.
2. If normative text differs from an ancestor, `constitutionHash` MUST differ.
3. No descendant MAY set `constitutionHash` to the seed hash unless the bytes are identical to the seed.
4. `FPP-inspired` documents MUST NOT include a `lineage` array presented as cryptographic ancestry; use a separate `inspiredBy` prose/URI field if needed.
5. `lineage[0]` for any seed-descended record MUST be the seed hash (or the record is the seed).

---

## 4. Fork, merge, supersession, compatibility-loss

| Event | Semantics | Ancestry |
|-------|-----------|----------|
| **Fork** | New community adopts a descendant (or identical seed) without claiming to replace the parent community’s active version | Preserve full lineage; set `forkOf` |
| **Supersession** | A community marks constitution B as replacing A for *that* community | Preserve lineage; set `supersedes: A`; A remains historically valid |
| **Merge** | Two divergent descendants reconcile into a new hash C | `lineage` must include paths (or explicit `mergeParents[]`) back to shared ancestor; new hash required |
| **Compatibility-loss** | A descendant violates a declared compatibility profile | Class becomes `FPP-derived` (or unlabeled); MUST NOT advertise `FPP-compatible` |

Historical constitutions are never deleted. Peers evaluate which hash a counterpart currently represents.

---

## 5. Invalid lineage (normative rejection conditions)

A lineage claim is **invalid** if any of the following hold:

- `constitutionHash` equals seed while bytes or `coreDivergences` indicate modification
- `compatibility: FPP-identical` with non-empty `amendments` or `coreDivergences`
- `compatibility: FPP-compatible` with compatibility-breaking `coreDivergences`
- Broken chain: parent hash not in `lineage`, or `lineage` does not reach seed for descended classes
- `FPP-inspired` document includes `ratificationProofRef` claiming FPP constitutional ratification
- Missing `effectiveDate` or `constitutionVersion` on a non-seed activation record

Examples: `examples/lineage-identical.json`, `examples/lineage-derived.json`, `examples/lineage-invalid.json`.

---

## 6. Relationship to Plan 3 schemas

Plan 3 (`protocol-core` contracts) may later encode these fields as runtime-validated JSON Schema. Until then, examples are fixtures for review only — not production validators.
