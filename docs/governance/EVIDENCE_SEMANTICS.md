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
