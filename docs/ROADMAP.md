# Deferred Roadmap

Long-horizon work the project acknowledges but has **not** committed to
implementing. Every item here is `DEFERRED` in `docs/CAPABILITY_STATUS.md`.
Items list prerequisites and the evidence needed before they can graduate into
an implementation plan — they carry **no implied delivery date**. Nothing on
this page is current behavior.

Items that are designed-but-unbuilt with nearer-term intent (`PROPOSED` status:
conformance receipts, trust capsules, amendments, due process, release
manifests, richer adoption states) are tracked in `docs/dev-review.md` and its
Appendix A acceptance criteria, not here. Governance evolution specifications
(actors, lineage, adoption/amendment lifecycles, consent, evidence, due process,
keys) and the implementation-readiness gate live under `docs/governance/` —
see `docs/governance/README.md`. Ratification/Sybil mechanism selection remains
`blocked` until `docs/governance/RATIFICATION_DECISION_RECORD.md` changes.

## 1. Gateway-level enforcement RFC

**What:** Constitutional gating at the OpenClaw tool-router boundary, so
enforcement cannot be bypassed by disabling a plugin. Working title:
*"Voluntary Constitutional Layer in the Gateway."*

**In-repo draft:** `docs/rfc/0001-voluntary-constitutional-layer.md`
(submission package: `docs/rfc/SUBMISSION.md`). Status of the **draft** is
`PROPOSED` in `docs/CAPABILITY_STATUS.md`. **Upstream implementation remains
`DEFERRED`** until Foundation intake and a serious Discussion thread exist —
do not treat the draft as shipped gateway enforcement.

**Why deferred (implementation):** Requires the OpenClaw Foundation's RFC
process, which was still forming when this project shipped. Coordinate with
AOS Phase 2 rather than competing with it (`docs/rfc/AOS-COORDINATION.md`).

**Prerequisites before an implementation plan:**
- OpenClaw Foundation publishes an RFC intake process. *(still open)*
- A draft RFC exists referencing `arXiv:2603.11853` (OpenClaw PRISM) and
  `arXiv:2603.16586` (runtime governance policies). *(satisfied in-repo by
  Plan 12 draft)*
- Agreement on what the gateway logs: constitution hash + policy engine version
  in tamper-evident records. *(proposed in draft; upstream agreement pending)*
- Plans 8–11 disposition model, enforcement-core, and harness adapters
  available to inform the RFC. *(satisfied for drafting)*

**Evidence needed:** an accepted or seriously-discussed RFC thread on
`openclaw/openclaw` GitHub Discussions.

## 2. Adoption telemetry

**What:** A public, opt-in dashboard of agents that ran `verify-install` with
an overall `[PASS]`, so the network effect of adoption is visible in aggregate.

**Why deferred:** Requires infrastructure (a reporting endpoint, privacy
review) and raises Law 1 questions — telemetry must be consensual and must not
leak SOUL/MEMORY content.

**Prerequisites:** a privacy design consistent with Law 1 (consent, data
minimization); hosting; an opt-in reporting flag in `verify-install`.

**Evidence needed:** a privacy design document reviewed against the five laws.

## 3. Remote sub-agent transitive guarantees

**What:** A parent agent vouching for a child agent's adoption on a remote
host, via signed claim exchange, so fleets do not rely on each host installing
independently.

**Why deferred:** Depends on hardened claims (v2 claim format with mandatory
signatures and freshness — see the reserved migration terminology in
`docs/COMPATIBILITY.md`) and on cross-host identity semantics that do not
exist yet.

**Prerequisites:** v2 claims shipped; a vouching semantics that does not let a
parent manufacture compliance for a child it cannot observe (this is a
completeness-claim problem — see `docs/dev-review.md` §8).

**Evidence needed:** a threat-model write-up for parent-child vouching,
including what happens when the child is compromised after vouching.

## 4. Zero-knowledge compliance proofs

**What:** Proving properties of the audit log (e.g., "no blocked action in
this interval") without revealing the log, beyond today's Merkle selective
disclosure.

**Why deferred:** Substantial cryptographic engineering; the semantics of what
a ZK proof would actually establish (given that behavioral compliance is not
cryptographically provable at all — see `docs/CAPABILITY_STATUS.md` claim
classes) are unresolved.

**Prerequisites:** a precise statement of which claim class a ZK proof would
strengthen; a candidate proof system compatible with append-only JSONL + Merkle
evidence.

**Evidence needed:** a feasibility memo with concrete proof statements and
cost estimates.

## 5. Post-quantum key migration

**What:** A migration path off Ed25519 (and ECDSA P-256 in the PFPF lineage)
for constitution signing, agent identity, and claims.

**Why deferred:** No urgency signal yet; key-lifecycle basics (rotation,
revocation registries — see `docs/REVOCATION.md` revocation classes) must land
first, since a PQ migration is itself a mass key-rotation event.

**Prerequisites:** key rotation and publisher-key revocation mechanisms exist
(`docs/dev-review.md` §12, Appendix A.7); a chosen PQ signature scheme with
acceptable key/signature sizes for handshake payloads.

**Evidence needed:** a migration design covering dual-signing during
transition and how lineage survives the algorithm change.

---

**Rule:** an item leaves this page only by becoming an implementation plan in
`docs/plans/` that cites the prerequisites above as satisfied — and the same
change must update its row in `docs/CAPABILITY_STATUS.md`.
