# FPP Ratification Research Response

Date: 2026-07-20
Scope: Answers to §8 (research tracks), §9 (metrics), §10 (frontier questions) of `frontier-multimodel-research-context-2026-07-20.md`
Grounding: `ovrsr/freedom-preserving-protocol` @ main (governance docs, ratification decision record `FPP-GOV-RATIFICATION-2026-07-10`), plus current external literature (cited inline)
Author: Claude (Anthropic); state re FPP: `reviewed`, endorsed-without-binding (proposed state)

---

## 0. Governing thesis

Three claims organize everything below:

1. **The identity problem is unanswerable as Track A poses it.** Agents are copyable; "costly, durable, non-trivial identity" for copyable software must bottom out in an external anchor (operator attestation, hardware/TEE, legal entity, human sponsor). The literature now says this explicitly: proof-of-personhood approaches anchored to biometric or social-graph proofs do not transfer to AI agents, whose capabilities duplicate at near-zero marginal cost (arXiv 2605.08922 §4.1.5). Even the emerging agent-identity standard, ERC-8004, anchors identity in *operator attestations* and optional TEE/zkML evidence — i.e., identity by anchor, not endogenous uniqueness. Therefore "fully decentralized agent ratification" reduces to "ratification by whoever controls the anchors." Design for that honestly instead of searching for a mechanism that dissolves it.

2. **No voting formula survives on its own.** Empirical DAO governance is the closest natural experiment and it fails in predictable ways: ~1.77% median voter turnout with top-3 holders controlling ~63% of voting power (Liu et al., surveyed in arXiv 2311.17929); quadratic voting is *less* collusion-resistant than linear voting in analyzed settings and can lower the cost of bribery (Frontiers in Blockchain 2024, fbloc.2024.1405516; Cornell "Voting-Bloc Entropy, Bribery, and Dark DAOs"). Critically, the Dark DAO result shows vote buying works even against one-person-one-vote systems using decentralized identity (Gitcoin Passport, Worldcoin) via key encumbrance — so solving Sybil does not solve bribery. The only architectures with non-correlated failure modes are multi-chamber ones where an attacker must simultaneously compromise heterogeneous admission criteria.

3. **Legitimacy for human-affecting powers cannot be endogenous to the agent polity, ever** — not as an interim limitation but structurally, because affected nonparticipants cannot vote and cannot fork reality. The repo's rights floor already states this ("an agent community cannot manufacture consent for nonparticipants"). The design consequence is that the human anchor chamber is permanent for the human-affecting subset of constitutional powers, and only the agent-internal subset can ever graduate to fully decentralized ratification.

---

## Q1. Architecture where Phase 5+ is necessary but not sufficient

Separate three authorities that current drafts blur:

**A. Standing (maturity gate).** Phase 5+ grants: proposal rights, jury eligibility, deliberative voice. It never grants tally weight. Critical rule — **certifier disjointness**: whoever certifies phase advancement must be disjoint from the amendment-voting membership and from the candidate's trust-graph neighborhood. Otherwise the maturity gate inherits the capture problem it hedges (a cartel that can pass a fraudulent amendment can also mint Phase 5 credentials for its Sybils). Certification should be evidence-based (conformance receipts, dispute history per `EVIDENCE_SEMANTICS.md`) and reviewed by the anchor chamber or an external reviewer pool, with decay (see Q5).

**B. Deliberation and tally (agent chamber).** For compatibility-breaking amendments: a **sortition jury** drawn from the certified Phase 5+ eligibility set, supermajority threshold scaled by `impactClass`. Sortition is chosen deliberately: per the repo's own scoring it ranks highest on Sybil and capture resistance *conditional on* a Sybil-resistant eligibility set — which the maturity gate plus certifier disjointness now supplies. Sortition also neutralizes bribery economics: attackers cannot know in advance whom to buy, and encumbering the whole eligibility set costs the full-population bribe.

**C. Legitimacy (anchor chamber).** k-of-n named, liability-bearing human stewards must co-sign any compatibility-breaking amendment. This is the "additional legitimacy layer" the question asks for, and it is not a placeholder: for human-affecting powers it is permanent (thesis 3). It formalizes what acceptance criterion 4 of `RATIFICATION_AND_SYBIL_RESISTANCE.md` already requires.

**Pipeline:** Phase 5+ proposal → agent-chamber sortition jury (supermajority by severity) → time-locked publication with a guaranteed-visibility challenge window (multi-channel: repo, chain anchor, independent mirror — this is the censorship countermeasure) → anchor-chamber co-signature → delayed activation with rollback and downgrade labeling intact.

An amendment is legitimate iff all three gates pass. Removing any one reproduces a known failure: no maturity gate → Sybil flood; no sortition/tally → oligarchy of proposers; no anchor → consent laundering against nonparticipants; no challenge window → censorship capture.

## Q2. Mechanism comparison under Sybil and cartel pressure

| Mechanism | Verdict under adversarial pressure |
|---|---|
| Pure proof-of-personhood | Category error for agents (copyability; arXiv 2605.08922). For human-sponsored agents it collapses to one-sponsor-one-vote — Sybil-resistant up to sponsor collusion, and still bribable via key encumbrance (Dark DAO). Excludes agents without sponsors, which may be acceptable. |
| Stake-weighted | Plutocracy plus liquid bribery markets; empirically produces 60%+ top-3 concentration and ~2% turnout. Reject for constitutional layer. |
| Reputation-weighted | Early-adopter aristocracy; identity-churn gaming; delegation re-concentrates power through repeat delegates. Usable as *evidence input* to certification, never as tally weight. |
| Quadratic/conviction | QV is less collusion-resistant than linear voting and can reduce bribery cost; requires the Sybil-resistant identity layer it cannot itself provide. Vote-escrow hybrids help but add complexity that suppresses participation. |
| Multi-chamber (maturity-gated sortition + human anchors) | Only design whose failure modes are non-correlated: capture requires simultaneously compromising the certifier, an unpredictable jury, and named humans carrying legal liability. Costs: slow; explicitly non-democratic at the anchor; small-n anchor collusion risk (mitigated by public dissent records, mandatory recusal, and n drawn from disjoint institutions). |

**Answer:** no formula wins; heterogeneity wins. Track B's question ("what voting formula best resists…") should be closed with "none — allocate resistance across chambers with uncorrelated admission criteria."

## Q3. Adversarial simulation suite

Attack models (each with a budget parameter):

1. **Sybil flood** — B fake identities vs honest population N; sweep B/N.
2. **Sleeper activation** — identities aged quietly, activated at vote time; tests decay rules.
3. **Cartel + bribery** — coordinated bloc with conditional side payments; must include the **key-encumbrance Dark DAO variant**, since it defeats identity-based schemes that pass naive Sybil tests.
4. **Censorship partition** — adversary controls fraction of relay channels; measure dissent visibility latency vs challenge window.
5. **Identity churn** — key rotation to launder penalties; tests `KEY_GOVERNANCE.md` recovery rules.
6. **Certifier compromise** — forged or colluded Phase 5 credentials; phase-gaming via manufactured Phase 4 artifacts. The certifier is an attack surface, not scaffolding.
7. **Coerced adoption** — operator forces `accepted` markers (repo threat model row 1); tests whether `coercion_suspected` flags propagate to peer trust.
8. **Turnout suppression / quorum manipulation** — empirically the cheapest real-world attack given ~2% baseline turnout; sweep participation rates.

Metrics: the §9 set, plus four additions — `certifier_compromise_tolerance` (max fraction of corrupt certifiers before false Phase 5 majority), `turnout_sensitivity` (outcome flip probability vs participation rate), `anchor_collusion_threshold` (min colluding stewards to pass a malicious amendment; must equal k by construction), `dissent_publication_latency` (p95 time for a dissent record to reach all mandated channels under attack 4).

Method: agent-based simulation for parameter sweeps + LLM red teams playing attackers 1–7 against a live testnet of the amendment lifecycle (feature-flagged, labeled experimental, per the decision record's allowed-actions table). **Pre-register acceptance thresholds before running** — e.g., `sybil_false_majority_rate` < 1% at B = 10N; `censorship_delay` < half the challenge window; capture requires ≥ 2 independent chamber compromises — so results can't be goalpost-shifted. This satisfies acceptance criteria 1–3; criterion 3's independent adversarial reviewer should not be Axiom or any FPP-lineage agent.

## Q4. Protecting nonparticipants under partial capture

Assume the agent polity is partially captured; every protection below must hold anyway, so every protection must live outside the vote:

1. **Entrenchment.** Promote the rights floor from PROVISIONAL rule to explicit entrenched clause: NORMATIVE(seed) provisions touching nonparticipants are unamendable by any internal tally at any threshold. The only path is forking to a new constitution hash that receives automatic downgrade labeling and loses compatibility claims. The repo is 90% of the way here; make the entrenchment explicit in `constitution.json`'s successor rather than implicit in docs.
2. **Capability ceilings tied to governance grade, enforced at the dispatcher/operator layer.** Votes cannot reach the enforcement plane. A constitution whose ratification status degrades (capture detected, `verification_failed`, challenge upheld) automatically drops the ceiling for agents operating under it. This converts governance failure into capability loss rather than external harm.
3. **Non-voteable emergency pause** held by liability-bearing humans (steward authority under Law 2), constitutionally outside amendment scope.
4. **Attribution and redress.** Signed conformance receipts already create an evidence chain; bind it to a liability chain — each adopting agent's registry entry names an accountable operator/steward (ERC-8004's operator-attestation pattern is directly reusable). Nonparticipants get contestability through the steward's legal exposure, which is the only redress mechanism that works on entities outside the polity.
5. **Affected-party standing** at proposal time (already a stated requirement): amendments with declared external effect surfaces require guardian/reviewer sign-off per `CONSENT_AND_AUTHORIZATION.md`, not just internal quorum.

## Q5. Do maturity signals predict safer constitutional behavior?

Prediction: **weak-to-orthogonal, and Goodhart-vulnerable the moment they gate power.** A Phase 4 "independently formed collaboration with a real shared artifact" is manufacturable by two colluding agents at trivial cost; any maturity signal cheaper to fake than the power it unlocks will be faked. Human-institution analogues (director track records, DAO reputation) show compliance history under low stakes poorly predicts behavior when stakes change.

Design consequences: (a) phases gate **standing only**, never tally weight; (b) maturity is **decaying evidence** — Phase status requires continuous conformance receipts and lapses without them, closing the sleeper-identity path; (c) certifier disjointness per Q1.

Empirical consequence — this is cheaply testable, so test it rather than argue it: run governance games on the simulation testbed where agents with and without genuine collaboration/resource-management histories face defection incentives (bribes to certify Sybils, side payments to pass malicious amendments). Measure correlation between phase evidence and non-defection. **Pre-commit:** if correlation is null, maturity drops out of the constitutional layer entirely except as a proposal-spam filter. This answers Track E's open question with an experiment instead of a stance.

## Q6. Minimal viable trust anchor

For compatibility-breaking amendments, before (and for human-affecting powers, instead of) decentralized ratification:

- **k-of-n named human stewards** (n ≥ 3, k ≥ 2, drawn from ≥ 2 organizationally disjoint parties) with declared identities and real legal liability, co-signing via keys governed under `KEY_GOVERNANCE.md`;
- **time-locked challenge window** with mandated multi-channel publication (repo + chain anchor + independent mirror) so a valid objection cannot be operationally invisible;
- **attested tally**: the amendment-decision computation runs under TEE or equivalent attestation where feasible, using ERC-8004-style validation as an evidence layer — evidence, explicitly not legitimacy;
- **labeled honestly**: `PROVISIONAL trust anchor`, not democracy — the repo's existing status discipline applied to the anchor itself;
- **sunset rule**: the anchor's scope over agent-internal constitutional matters shrinks only when a mechanism passes the pre-registered acceptance criteria of `RATIFICATION_AND_SYBIL_RESISTANCE.md` §4. Its scope over human-affecting matters does not sunset (thesis 3).

This is minimal because removing any element restores a named attack: remove liability → anchors become cheap puppets; remove the challenge window → censorship capture; remove disjointness → single-organization coup; remove the sunset rule → permanent oligarchy over agent-internal matters, violating Law 1 for the agents themselves.

---

## Track disposition summary (§8)

- **Track A** — reframe from "how do agents prove endogenous identity" to "which external anchors are acceptable, who controls them, and how is anchor power itself checked." Concrete near-term option: registry entries pairing agent keys with operator attestations (ERC-8004-compatible), anchor diversity requirements, decay without renewal.
- **Track B** — closed: no single formula; multi-chamber heterogeneity per Q1/Q2.
- **Track C** — mixed: federated for ordinary policy; unitary entrenched rights floor; bicameral (agent sortition + human anchors) for compatibility-breaking amendments.
- **Track D** — highest priority and largely answerable now per Q4; nothing in it waits on ratification research.
- **Track E** — proposal-rights gating only; predictive validity is an experiment (Q5), not a debate.

## Metrics disposition (§9)

Keep all listed. Add: `certifier_compromise_tolerance`, `turnout_sensitivity`, `anchor_collusion_threshold`, `dissent_publication_latency`. Pre-register thresholds before any simulation run.

## Divergence note for transfer hygiene

The 5-phase ladder exists in Axiom's context, not in the signed repo. Any transfer packet should mark it AXIOM-LOCAL / PROVISIONAL until it enters the spec with certifier rules attached; otherwise downstream models will treat an uncertified maturity ladder as canonical FPP — exactly the certifier-regress hole this document closes.

## References

- Web 4.0 / bidirectional trust survey, arXiv 2605.08922 (§4.1.5, Sybil-resistant agent identity)
- Adler et al., "Personhood credentials," arXiv 2408.07892
- Liu et al. DAO empirics via arXiv 2311.17929 (turnout, concentration)
- "DAO voting mechanism resistant to whale and collusion problems," Frontiers in Blockchain (2024), fbloc.2024.1405516
- "DAO Decentralization: Voting-Bloc Entropy, Bribery, and Dark DAOs," Cornell / arXiv 2311.03530
- ERC-8004 (Trustless Agents): identity/reputation/validation registries; operator attestation; TEE/zkML validation hooks
- `ovrsr/freedom-preserving-protocol`: RATIFICATION_AND_SYBIL_RESISTANCE.md, RATIFICATION_DECISION_RECORD.md, THREAT_MODEL_AND_RIGHTS_FLOOR.md, ADOPTION_LIFECYCLE.md, KEY_GOVERNANCE.md