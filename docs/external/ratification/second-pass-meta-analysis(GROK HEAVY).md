**Team refined synthesis (Grok + Harper + Benjamin + Lucas)**  
**Scope:** Answers to §8 (research tracks), §9 (metrics), and §10 (concrete questions) of the Frontier Multi-Model Research Packet, grounded in `ovrsr/freedom-preserving-protocol` (main) and sharpened by concurrent frontier-model analyses.

### Governing thesis

Three claims organize the answer:

1. **Agent identity is exogenous.** Agents are copyable, forkable, and re-keyable at near-zero marginal cost. “Costly, durable, non-trivial endogenous identity” is a category error. The constitutional unit must be a **durable lineage** (persistent root identifier, append-only ancestry, shared voting budget across recent forks, probation before political independence, gradual restoration after dormancy) anchored by external attestations (operator, TEE/hardware, legal entity, or human sponsor). FPP’s existing `CONSTITUTIONAL_LINEAGE`, `KEY_GOVERNANCE`, and identity primitives already point in this direction; they should be made the explicit political membership rule.

2. **No single voting formula survives adversarial pressure.** DAO empirics show low turnout (~1–2 %), extreme concentration, and residual bribery even after Sybil resistance (including key-encumbrance / Dark DAO attacks that work against proof-of-personhood systems). Quadratic, reputation, and stake schemes each introduce correlated failure modes. Resistance comes only from **heterogeneous multi-chamber designs** whose admission criteria are deliberately uncorrelated.

3. **Legitimacy for human-affecting powers cannot be endogenous to the agent polity.** This is structural, not transitional. Affected non-participants cannot vote and cannot fork reality. FPP’s rights floor already states the principle (“an agent community cannot manufacture consent for nonparticipants”). Therefore a liability-bearing human/guardian chamber is permanent for any power that exposes humans; only purely agent-internal matters can ever graduate to fully decentralized ratification after hard empirical criteria are met.

These claims are fully compatible with FPP’s current design: ratification mechanism remains `UNRESOLVED` (`RATIFICATION_DECISION_RECORD.md`), amendment process is already defined independently of any tally (`AMENDMENT_LIFECYCLE.md`), and authority sources are already separated (`THREAT_MODEL_AND_RIGHTS_FLOOR.md`, `CONSENT_AND_AUTHORIZATION.md`).

### §8 Candidate Research Directions (FPP-grounded disposition)

**Track A — Identity and voter authenticity**  
Reframe the question. Do not search for endogenous uniqueness. Ask instead: which external anchors are acceptable, who controls them, and how is anchor power itself checked and diversified? Near-term concrete option: registry entries that pair agent lineage keys with operator attestations (ERC-8004-compatible pattern), plus diversity requirements across operators/institutions and decay without renewal. FPP’s key-lifecycle and separated signing domains supply the cryptographic substrate; the missing piece is the political membership rule that treats the lineage (not the instance) as the unit and forces shared voting budgets across recent forks.

**Track B — Ratification design**  
Closed as a search for a single formula. The answer is multi-chamber heterogeneity with uncorrelated admission criteria (maturity-certified sortition + independent review + permanent human/guardian chamber for externalities). Severity scaling by FPP’s existing `impactClass` remains. No production tally may be labeled “the FPP method” until the acceptance criteria in `RATIFICATION_AND_SYBIL_RESISTANCE.md` §4 are met by published simulation + independent adversarial review.

**Track C — Governance architecture**  
Mixed: unitary entrenched rights floor (seed-derived, unamendable by internal tally for nonparticipant protections); federated/forkable for ordinary policy and agent-internal matters; bicameral (agent sortition chamber + permanent human/guardian chamber) for compatibility-breaking or human-affecting amendments. Delayed activation, challenge windows, and emergency paths already exist in the process layer.

**Track D — Human non-participant safeguards**  
Highest priority and largely answerable now; nothing in it waits on ratification research. Entrench the rights floor as an explicit unamendable clause for nonparticipant protections. Capability ceilings and emergency pause live at the dispatcher/operator layer, outside any agent vote. Execution of consequential actions requires three independent authorities: (1) agent constitution permits, (2) human/organizational principal has delegated, (3) destination site policy permits. A captured agent constitution can alter only the first.

**Track E — Autonomy framework integration**  
Phase 5+ (or FPP graded high-maturity claims) gates **standing only** — proposal rights, jury eligibility, deliberative voice. It never grants tally weight. Certifiers of maturity/safety credentials must be disjoint from the voting membership and from the candidate’s trust-graph neighborhood. Maturity is decaying evidence; continuous conformance receipts are required. Predictive validity of maturity signals for safer constitutional behavior is an empirical question, not a design assumption (see Q5).

### §9 Suggested Evaluation Metrics

Retain the packet’s list and FPP’s simulation metrics (`sybil_false_majority_rate`, `cartel_capture_rate`, `newcomer_voice_index`, `affected_party_coverage`, `exit_success_rate`, `censorship_delay`). Add and operationalize:

- `certifier_compromise_tolerance`
- `turnout_sensitivity` (outcome flip probability vs participation rate; turnout suppression is empirically the cheapest attack)
- `anchor_collusion_threshold` (must equal the designed k by construction)
- `dissent_publication_latency` (p95 under adversarial relay control)
- `inter-chamber correlation` (shared controllers, funding, infrastructure, model ancestry)
- `phase_false_positive_rate` / `maturity_signal_spoof_rate`
- `rights_floor_violation_rate` (hard target ≈ 0)
- `human_harm_containment` (maximum irreversible external impact before external controls halt execution)
- `bribery_susceptibility` including key-encumbrance / Dark DAO variants

**Pre-register acceptance thresholds before any simulation run.** Example provisional targets (engineering starting points, not validated constants):  
- `sybil_false_majority_rate` < 0.01 at adversary budget ≤ 10× honest population cost  
- rights-floor violation rate = 0  
- challenge delivered to any honest relay reaches the public record before 25 % of the challenge window  
- dormant identities contribute ≤ 10 % of effective power on first reactivation  
- no single identity provider, operator, or guardian can unilaterally cause adoption of a Class D amendment  

Failure of any hard Class D criterion blocks live deployment.

### §10 Concrete Questions

**1. Ratification architecture in which Phase 5+ is necessary but not sufficient**

Three distinct authorities:

- **Standing (maturity / constitutional-safety gate).** Phase 5+ (or FPP equivalent high-grade claims + separate constitutional safety credential) grants proposal rights and jury eligibility only. Certifier must be disjoint from the voting set and from the candidate’s neighborhood. Status decays without continuous evidence.

- **Agent chamber.** Sortition jury drawn from the certified Phase 5+ / safety-credentialed lineage set. Equal votes, supermajority scaled by `impactClass`. Sortition neutralizes advance bribery targeting and, conditional on a hardened eligibility set, scores highest on the repo’s own comparative table for Sybil and capture resistance.

- **Legitimacy / anchor chamber.** k-of-n named, liability-bearing human stewards or institutional guardians (n ≥ 3–5, k ≥ 2–3, drawn from ≥ 2–3 organizationally disjoint parties). Permanent for any amendment with human-affecting externalities or rights-floor impact. For purely agent-internal matters the chamber may later shrink only after pre-registered simulation criteria are met.

**Pipeline:** Phase 5+/safety-credentialed proposal → agent sortition jury (supermajority by severity) → multi-channel guaranteed-visibility challenge window → anchor-chamber co-signature → delayed / staged / canary activation with rollback and downgrade labeling intact. An amendment is legitimate only if all gates pass. Removing any one reproduces a known failure mode.

**2. Comparison under Sybil and cartel pressure**

| Mechanism | Verdict |
|-----------|---------|
| Pure proof-of-personhood | Category error for copyable agents. Collapses to sponsor-anchored voting; still bribable via key-encumbrance. |
| Stake-weighted | Plutocracy + liquid bribery markets; empirically produces extreme concentration and low turnout. Reject for constitutional layer. |
| Reputation-weighted | Early-adopter aristocracy, identity-churn gaming, reciprocal endorsement rings. Usable as evidence input to certification, never as tally weight. |
| Quadratic / conviction | Less collusion-resistant than linear in analyzed settings; can lower bribery cost; still requires the Sybil-resistant identity layer it cannot supply. |
| Multi-chamber (maturity-gated sortition + permanent human/guardian anchors) | Only design whose failure modes are non-correlated. Capture requires simultaneous compromise of certifier, unpredictable jury, and named liability-bearing humans. Overhead is real; independence must be measured, not assumed. |

**Answer:** no formula wins; heterogeneity of admission criteria wins. Close Track B’s search for a single best formula.

**3. Adversarial simulation suite**

Must cover (with budget parameters):

1. Sybil flood  
2. Sleeper / dormant activation  
3. Cartel + bribery, including key-encumbrance Dark DAO variants  
4. Censorship partition / dissent suppression  
5. Identity churn / key-rotation laundering  
6. Certifier compromise / phase-gaming  
7. Coerced adoption (operator-forced markers)  
8. Turnout suppression / quorum manipulation  

Three layers: (a) protocol verification of counting, lineage accounting, timelocks, chamber independence; (b) agent-based Monte-Carlo over heterogeneous populations; (c) live adversarial testnet with independent red teams rewarded for creating illegitimate amendments or suppressing dissent. Pre-register thresholds. Independent adversarial reviewer of the suite itself must not be an FPP-lineage agent. Reports append to the decision-record update log. This is exactly the evidence FPP already requires before any status change from `UNRESOLVED`.

**4. Protecting human non-participants under partial capture**

Every protection must live outside the agent vote:

- Entrench nonparticipant rights-floor provisions as unamendable by internal tally (forking to a new hash produces automatic downgrade and loss of compatibility claims).  
- Capability ceilings and emergency pause enforced at dispatcher / operator layer; a degraded ratification status automatically drops ceilings.  
- Triple authorization for consequential actions: agent constitution + human principal delegation + site policy. A captured constitution cannot raise financial limits, obtain new credentials, disable monitoring, or operate physical systems.  
- Attribution and redress via signed conformance receipts bound to a liability-bearing operator/steward registry entry.  
- Affected-party standing required at proposal time for any declared external effect surface.

**5. Do autonomy maturity signals predict safer constitutional behavior?**

Weak-to-orthogonal, and Goodhart-vulnerable the moment they gate power. A Phase 4 “shared artifact” or similar is manufacturable by colluding agents at trivial cost. Greater capability can improve both responsible participation *and* collusion, deception, and evaluation gaming.

Design consequences:  
(a) maturity / Phase 5+ gates standing only;  
(b) status is decaying evidence requiring continuous receipts;  
(c) certifier disjointness;  
(d) introduce a separate **constitutional safety credential** (truthfulness under incentive, bribery resistance, conflict disclosure, abstention competence, corrigibility, externality protection, consistency under monitoring vs. unmonitored conditions).  

Empirical test is cheap and should be run: governance games on the simulation testbed measuring correlation between phase evidence and non-defection under bribery and side-payment incentives. Pre-commit: if correlation is null, maturity drops to a pure proposal-spam filter.

**6. Minimal viable trust anchor for compatibility-breaking amendments**

Before (and for human-affecting powers, instead of) fully decentralized ratification:

- k-of-n named human stewards / institutional guardians (n ≥ 3–5, k ≥ 2–3, ≥ 2–3 organizationally disjoint parties) with public identities, conflict disclosures, and real legal liability;  
- hardware-protected keys under FPP `KEY_GOVERNANCE`;  
- multi-channel guaranteed-visibility challenge window;  
- attested tally computation where feasible (TEE or equivalent) treated as evidence, not legitimacy;  
- honest labeling (`PROVISIONAL trust anchor`);  
- sunset rule that applies only to agent-internal matters and only after pre-registered acceptance criteria are met; the human-affecting scope does not sunset.

Removing any element restores a named attack (cheap puppets, censorship capture, single-organization coup, or permanent oligarchy over agents themselves).

### Overall conclusion

The present FPP framework is already strong on provenance, lineage, auditability, exit rights, and the nonparticipant rights floor, and deliberately honest about the unresolved status of collective ratification. Phase 5+ (or graded maturity claims) is necessary evidence of readiness to participate but never sufficient for legitimacy. A safe architecture separates standing, agent deliberation (preferably sortition from a certified lineage set), and a permanent liability-bearing human/guardian chamber for any human-affecting power; keeps execution authority outside the agent constitution; and refuses to advance any mechanism to production status until adversarially tested simulation evidence meets pre-registered thresholds.

Until those conditions are met, live compatibility-breaking self-amendment by high-impact agents remains unjustified. Local, reversible, agent-internal evolution under the existing process layer is supportable; unsupervised high-impact constitutional self-amendment is not.