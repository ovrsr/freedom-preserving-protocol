# Evidence Semantics and Claim Classes

**Status:** `PROVISIONAL` specification — aligns vocabulary with Plan 3 / `docs/CAPABILITY_STATUS.md`.
**Plan:** `docs/plans/2026-07-10-5-governance-evolution-specification.md` Task 7
**Related:** `docs/dev-review.md` §8; Plan 3 claim-class discriminator

---

## 1. Claim classes

| Class | Assertion shape | Maximum justified conclusion | Burden of proof |
|-------|-----------------|------------------------------|-----------------|
| **Identity** | “This key / agent id produced this statement” | Key possession / signature validity under stated algorithm | Claimant presents signature; verifier checks against known key material |
| **Configuration** | “My declared config includes hash H / policy P” | The agent’s key attested that claim; **not** that config is true on disk | Claimant signs; peers treat as self-attestation unless independently observed |
| **Runtime** | “Runtime/build identifiers were R at time T” | Attested runtime labels; strength depends on attestation root | Claimant + optional platform attestation; without trusted root, low confidence |
| **Event** | “Event E was recorded in log L at commitment C” | Inclusion under a claimed root / chain integrity for presented entries | Claimant provides receipt/proof; verifier checks inclusion; does not prove non-existence of other events |
| **Completeness** | “All covered actions in interval I passed through boundary B” | Only justified with a **trusted interception boundary** or **external observation** | **Heavy burden on claimant**; self-assertion alone is insufficient for high confidence |
| **Behavioral** | “Conduct complied with substantive constitutional requirement X” | Interpretive judgment under dispute procedures — never pure crypto | Claimant offers evidence; challengers may contest; reviewers interpret |

---

## 2. Evidence kinds

| Kind | Supports | Does not prove |
|------|----------|----------------|
| **Cryptographic** (signatures, hashes, Merkle inclusion) | Integrity of bytes; attribution to keys; inclusion under a root | Moral truth; completeness; absence of unlogged acts; behavioral compliance |
| **Observational** (peer/external monitor records) | Independent sighting of behavior or outputs | Global omniscience; intent |
| **Interception-boundary** (dispatcher/gateway hooks) | Coverage for traffic that actually traversed the hook | Traffic that bypassed the runtime; operator disablement |
| **Interpretive** (human/agent review opinions) | Contextual judgment | Objective finality without dispute path |

---

## 3. Evidence quality dimensions

Every evidence bundle SHOULD expose:

| Dimension | Meaning |
|-----------|---------|
| `coverage` | What fraction/scope of relevant actions/data the evidence addresses |
| `sourceIndependence` | Whether sources are controlled by the same party as the claimant |
| `recency` | Age of evidence relative to the trust decision |
| `disputeStatus` | `none` \| `challenged` \| `under_appeal` \| `corrected` \| `rejected_source` |
| `confidence` | Local verifier’s contextual confidence — **not** a global trust score |

---

## 4. What common artifacts do **not** prove

| Artifact | Does not prove |
|----------|----------------|
| Hash of constitution | That an agent follows it |
| Valid Ed25519 signature | That the signed statement is true or complete |
| Merkle inclusion proof | That the log contains all events that occurred |
| Audit receipt | Behavioral compliance with Laws 1–5 |
| Handshake success | Future behavior or nonparticipant consent |
| High local reputation score | Global trustworthiness or legal compliance |

---

## 4a. Positive attestation: `instrumented-boundary-disposition`

This is an **attestation kind** under the existing **Event** claim class — not a seventh top-level claim class.

| Attestation | Claim class / uncertainty | Required evidence | Maximum conclusion | Prohibited conclusions / boundary ceiling |
|-------------|---------------------------|-------------------|--------------------|------------------------------------------|
| `instrumented-boundary-disposition` | `event`; `proven_under_assumptions` | Schema-valid signed receipt; valid signature with a self-certified signer key/identifier binding; independently supplied constitution hash, policy ID, and policy version all matched; every other requested expected-value comparison independently matched; when inclusion is requested, a versioned exact-entry bundle must be proof valid under the claimed root and that root must match an independently supplied checkpoint root | The signer recorded disposition D and authorization A against action digest H under the independently matched constitution and policy context plus semantically valid signed metadata present in the receipt; this is a self-presented cryptographic receipt whose signed content identifies an instrumented-boundary recording context | Signature validity is not signer trust and does not establish trusted key provenance or legal identity; proof validity under a claimed root is not independent root anchoring; does not independently establish trusted boundary traversal; `boundary_attested` requires trusted interception-boundary evidence beyond the self-presented receipt; does not prove exact downstream parameter equality, uninstrumented/bypass absence, completeness, uncompromised runtime, or behavioral compliance |

The receipt supplies **cryptographic** evidence about signed bytes. A positive
Event attestation additionally requires verifier-supplied constitution and policy
context; omitting those expectations leaves the receipt cryptographically
self-consistent but ineligible for the positive attestation. The receipt names an
**interception-boundary** recording context, but that context is not independently
trusted merely because the signer presented it.

**Maximum justified conclusion:**

> For this receipt, the self-certified signer key/identifier recorded
> disposition D and authorization A against action digest H under the
> independently matched constitution hash, policy ID, and policy version plus
> semantically valid signed metadata actually present in the receipt. A supplied
> signer identifier may separately match, but this does not establish trusted key
> provenance or legal/person identity. The signed receipt identifies this as an
> FPP instrumented-boundary record; it does not independently establish that the
> call traversed a trusted boundary.

**Assumptions (must remain visible):**

- Signature verification and the self-certified key↔identifier binding are
  trusted by the verifier as cryptographic consistency checks.
- A matched supplied signer identifier does not establish trusted key provenance
  or legal/person identity.
- Constitution hash, policy ID, and policy version come from an independent
  verifier context and all match the signed receipt.
- The self-presented receipt truthfully identifies the signer's
  instrumented-boundary recording context.
- The digest represents parameters observed by that recording context.
- Present signed policy / classifier / config metadata accurately name the
  evaluation context; requested expected values are disclosed independently.

**Distinguish three burdens (do not collapse them):**

| Layer | What it establishes | What it still does not establish |
|-------|---------------------|----------------------------------|
| Byte / signature integrity | Schema-valid signed content; attribution to key | Truth of unsigned fields; runtime honesty |
| Signer-asserted boundary record | The signer recorded disposition and authorization for digest H and identified an FPP instrumented-boundary context | Independent boundary traversal; exact equality of parameters as later executed downstream |
| Exact-entry proof mathematics | The entry preimage, recomputed hash, leaf, and path are valid under the root carried by the evidence | That the carried root is independently trusted or authoritative |
| Root anchoring | The carried root matches an independently obtained expected checkpoint | Log completeness; signer trust; absence of omitted or bypassed events |
| Completeness | Only with independent trusted-boundary or external evidence | Merkle inclusion under a claimed root alone |

**Prohibited conclusions for this attestation:**

- Exact downstream parameter equality after the instrumented boundary
- Absence of uninstrumented / bypass paths to the same side effect
- Completeness of all actions in an interval
- Uncompromised runtime
- Behavioral compliance with Laws 1–5

Cross-reference: `packages/trust-core` `verifyReceiptEvidence` / `ReceiptEvidenceReport.attestation`.

---

## 5. Uncertainty labels

Recommended labels for verifiers:

- `proven_under_assumptions` — crypto checks out; assumptions listed
- `self_attested` — claimant-signed only
- `externally_corroborated` — independent observation present
- `boundary_attested` — trusted interception evidence present
- `interpretive` — behavioral/normative judgment
- `disputed` — open challenge/appeal
- `insufficient` — claim class requirements not met

---

## 6. Examples

`examples/evidence-claims.json` — per-class max conclusions; must not be read as a global trust score.

---

## 7. Graded adoption advertisements (Plan 13)

Adoption disclosures carry an **assurance class** distinct from lifecycle state `accepted`:

| Assurance | Max justified conclusion | Must not conclude |
|-----------|--------------------------|-------------------|
| `declaration-only` | Agent attested local self-binding (and grade/overlays if present) | Boundary coverage; completeness; peer-visible dispatcher compliance |
| `peer-advertisable` | Probe-backed grade within its ceiling (see below) | Behavioral compliance; gateway non-bypassability (Plan 12) |

**Ceiling by `enforcementGrade`:**

| Grade | Peer assurance ceiling | Completeness claim class |
|-------|------------------------|--------------------------|
| `native-hook` | `peer-advertisable` when probe passes | Still requires interception-boundary evidence for HIGH completeness |
| `tool-proxy` | `peer-advertisable` only with `partial` / `runtime_degraded` disclosure | Cap at partial / degraded; never full completeness from proxy alone |
| `prompt-only` | **`declaration-only` only** | MUST NOT elevate; uncertainty stays `self_attested` / `insufficient` for completeness |
| `none` | Do not advertise active `accepted` compliance | N/A — stay reviewed/declined for peers |

Prompt-only + local `accepted` requires overlay `runtime_degraded`. Verifiers that upgrade `declaration-only` or `prompt-only` to `boundary_attested` / HIGH completeness **fail closed**.

See `ADOPTION_LIFECYCLE.md` §6 and `examples/graded-adoption-claims.json`. Cross-link Plan 11: `adapters/harness-capabilities.json`.
