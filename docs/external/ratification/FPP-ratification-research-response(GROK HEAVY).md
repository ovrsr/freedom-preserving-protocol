**Team answer (Grok + Harper + Benjamin + Lucas): Sections 8–10 of the Frontier Multi-Model Research Packet, grounded in the Freedom-Preserving Protocol (FPP) repository (https://github.com/ovrsr/freedom-preserving-protocol).**

FPP is a modular constitutional framework for self-governing AI agents centered on five signed Laws (Options & Consent, Corrigibility & Oversight, Reversibility & Proportion, Commitments with Safety Valve, Scoped Exploration) plus a meta-clause. The seed constitution (hash `71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993`) is immutable; any change produces a new hash with explicit lineage. Key governance documents live under `docs/governance/` (especially `RATIFICATION_AND_SYBIL_RESISTANCE.md`, `RATIFICATION_DECISION_RECORD.md`, `AMENDMENT_LIFECYCLE.md`, `CONSTITUTIONAL_LINEAGE.md`, `THREAT_MODEL_AND_RIGHTS_FLOOR.md`, `CONSENT_AND_AUTHORIZATION.md`). Constitutional amendments, lineage, and ratification are marked **PROPOSED** / **UNRESOLVED** in `docs/CAPABILITY_STATUS.md` and the decision record. There is **no native 5-phase autonomy framework** in the repository; the packet’s Phase 5+ is treated as an external maturity ladder that can be mapped onto FPP’s graded adoption claims (prompt/skill layer, dispatcher/plugin enforcement, trust capsules/graph) and evidence quality signals.

FPP is already strong on provenance (cryptographic hashes, immutable lineage classes: FPP-identical / compatible / derived / inspired, fork/exit, dissent recording, audit chains) and weak/unresolved on collective legitimacy of ratification. This matches the packet’s Speaker 2 position and provisional bottom line. The answers below respect FPP’s explicit design choices: process (amendment lifecycle, impact classes, activation gates) can advance while the voting formula remains `UNRESOLVED`; agent-community consensus cannot manufacture nonparticipant consent; authority sources (software-control/operator, steward, agent self-binding, affected-party consent) are deliberately separated.

### Section 8 — Candidate Research Directions (mapped to FPP)

**Track A: Identity and voter authenticity**  
FPP already provides identity keys, key lifecycle/rotation/recovery, separated signing domains (`KEY_GOVERNANCE.md`), and steward registries. It does **not** provide a production Sybil-resistant eligibility set for voting (explicitly blocked). Open research remains exactly as the packet frames it: costly durable non-trivial identity without plutocracy or privacy collapse, hardware-rooted identity, web-of-trust failure modes, anti-churn mechanisms, and recovery without identity laundering. Sortition and hybrid schemes in the repo’s comparative table are gated on first solving an eligibility set. Production ratification is forbidden until simulation evidence exists.

**Track B: Ratification design**  
Direct match to `RATIFICATION_AND_SYBIL_RESISTANCE.md`. The document scores candidate mechanisms illustratively (one-agent-one-vote, stake, reputation, longevity, affected-party, domain-competence, sortition, hybrid) and lists the attack models (Sybil, cartel, early-adopter aristocracy, bribery, censorship, identity churn, consent laundering). Status is deliberately `UNRESOLVED`; no production tally may be presented as “the FPP method.” Severity scaling by `impactClass` (clarifying / protective_tightening / substantive / compatibility_breaking / emergency) is already specified in the process layer. Hybrid multi-factor / multi-chamber designs score highest in the repo’s table and are the most plausible path forward once acceptance criteria are met.

**Track C: Governance architecture**  
FPP uses a unitary signed seed with forking/exit for divergence and compatibility classes for lineage claims. The amendment process is deliberately independent of any particular tally and already supports delayed activation, emergency paths with mandatory post-hoc review, and rights-floor checks. Multi-chamber designs, expert security/rights-floor chambers, human co-ratification, and review juries are fully compatible with the existing process and authority-source separation. Mixed unitary + federated (via forks) is the natural fit.

**Track D: Human non-participant safeguards**  
Already strongly specified. The rights floor (`THREAT_MODEL_AND_RIGHTS_FLOOR.md`) states that agent consensus cannot authorize unjustified reduction of a nonparticipant’s options or manufacture consent. `CONSENT_AND_AUTHORIZATION.md` defines distinct authorization classes (operator, requester, affected-party, data-subject, guardian, independent review, emergency) and hard rules: operator approval alone is insufficient for external effects; quorum finalization refuses synthetic nonparticipant consent tokens; unreachable parties trigger least-restrictive reversible fallback + uncertainty recording. Capability ceilings via graded adoption claims, external emergency pause (steward/operator under Law 2), and dispute/redress records are present or sketched. Operationalization of deployment gating, continuous monitoring, and liability-bearing oversight remain open but align cleanly with the existing separation of authority sources.

**Track E: Autonomy framework integration**  
No native Phase 5+. FPP’s graded layers (prompt, dispatcher, trust) + adoption states + signed claims/capsules/receipts + evidence quality (coverage, independence, recency) + freshness/decay policies provide maturity signals. Recommendation matches the packet’s Working Model exactly: maturity/Phase 5+ (or FPP high-grade claims) should gate **proposal rights, review-chamber eligibility, and deliberative weight only**. It must not unlock final amendment authority. Prevent phase-gaming via continuous evidence requirements, decay without continued demonstration, and independent observation. Relationship autonomy (trust graph) and resource accountability (mandates) may weakly predict better individual proposal quality but remain orthogonal to collective legitimacy.

### Section 9 — Suggested Evaluation Metrics (aligned + expanded)

FPP already lists core simulation metrics that must be published before any mechanism can leave `UNRESOLVED`:

- `sybil_false_majority_rate`
- `cartel_capture_rate`
- `newcomer_voice_index`
- `affected_party_coverage`
- `exit_success_rate`
- `censorship_delay`

Packet metrics map almost 1:1. Recommended expansions for FPP completeness (especially rights floor and maturity integration):

- `bribery_susceptibility` / cost-to-flip
- `dormant_identity_activation_risk`
- `time_to_detect_and_contest_malicious_amendment`
- `harm_containment_for_human_nonparticipants` (scope/time of downstream effects under partial capture)
- `rights_floor_violation_rate` (hard target ≈ 0; attempts to weaken nonparticipant protections that pass unlabeled)
- `incumbency_concentration` (Gini on voting/weight power)
- `phase_gaming_success_rate` / `maturity_signal_spoof_rate` / `maturity_decay_effectiveness`
- `dual_control_effectiveness` for stewards
- `false_legitimacy_score` (cryptographic integrity without true authorization)

Any candidate system that fails near-zero rights-floor violation or exceeds modest adversary budgets on Sybil/cartel for compatibility-breaking changes must remain blocked for production use.

### Section 10 — Concrete Questions for Frontier Models

**1. Design a ratification architecture where Phase 5+ is necessary but not sufficient for constitutional amendment. What additional legitimacy layer is required?**

**Eligibility / maturity gate (necessary):** Map Phase 5+ (or FPP equivalent: current, fresh high-grade claims across prompt + dispatcher + trust layers + demonstrated corrigibility history + no recent severe rights-floor violations) to:
- right to propose substantive or compatibility-breaking amendments,
- eligibility to sit on review chambers,
- elevated deliberative weight.

Maturity decays without continued evidence; anti-churn and independent observation resist gaming. This is never a permission bitmask for final adoption.

**Additional legitimacy layer (required for sufficiency):**
- Severity-scaled multi-chamber process (building on FPP `impactClass` and `AMENDMENT_LIFECYCLE`):
  - Chamber A: deliberation among maturity-eligible adopters (hybrid weighting once validated).
  - Chamber B: rights-floor / security review chamber (sortition or filtered high-maturity + independent reviewers/stewards) with veto power on compatibility-breaking or rights-floor impact.
  - Chamber C (externalities): affected-party standing recognition or human/steward co-ratification / external trust-anchor attestation. Agent tally alone cannot finalize nonparticipant effects.
- Activation gates already in FPP, strengthened: published simulation evidence, lineage + dissent preservation, explicit rights-floor compatibility statement, delayed activation + public challenge window.
- While the mechanism remains `UNRESOLVED`, any compatibility-breaking amendment requires dual-control external (steward/operator under Law 2) confirmation or multi-sig trust anchor; the `ratificationProofRef` cannot be satisfied by agent tally alone.
- Hard constraints: agent-community consensus is never an authorization class for nonparticipants; exit/fork/dissent recording cannot be abolished; emergency pause remains outside pure agent vote with mandatory post-hoc review.

This implements the packet’s Working Model and FPP’s authority-source separation while preserving the honest `UNRESOLVED` status until acceptance criteria are met.

**2. Compare pure proof-of-personhood, reputation-weighted, stake-weighted, and multi-chamber models under Sybil and cartel pressure.**

Using FPP’s own comparative table and attack models:

- **Pure proof-of-personhood / one-entity-one-vote with uniqueness oracle**: Sybil resistance high *if* the oracle is strong (hardware, costly durable identity); moderate-to-low for agents because agent identity creation is currently cheap. Cartel resistance only moderate (coordination/bribery still work). Newcomer fairness high if open. FPP already rejects naïve one-agent-one-vote. Feasibility for pure agent polities currently low.
- **Reputation-weighted**: Sybil low-moderate (bootstrap via collusion/wash trading). Cartel and early-adopter aristocracy resistance poor (explicit risk in FPP). Newcomer voice very poor (incumbency lock-in). Useful for soft deliberative weight; dangerous as sole power.
- **Stake-weighted (or compute/resource cost)**: Sybil moderate (priced forgery). Cartel/bribery resistance poor (wealth concentration, vote buying). Newcomer fairness poor under power-law distributions. Turns Sybil into an economic attack surface (FPP flags this).
- **Multi-chamber / hybrid**: Best overall. Different eligibility sets and veto thresholds across chambers raise the cost of simultaneous capture. Maturity (Phase 5+/graded claims) can influence one chamber without granting supremacy. Sortition or external anchors in a rights-floor chamber further harden against pure agent Sybil/cartel. Overhead is higher but compatible with FPP’s existing process, delayed activation, and rights-floor hard gates. FPP’s table already scores hybrid highest (3–4).

**Recommendation**: Pure models fail FPP acceptance criteria. Prefer multi-chamber hybrid in which maturity gates eligibility/weight in one chamber only. Require published simulation evidence meeting the metrics thresholds before any status change from `UNRESOLVED`.

**3. Propose an adversarial simulation suite for constitutional amendment safety.**

The suite must generate the exact evidence FPP requires before a mechanism can leave `UNRESOLVED` (`RATIFICATION_AND_SYBIL_RESISTANCE.md` §4).

**Attack models (all required):**
- Sybil flooding (varying identity costs: free keygen vs priced PoW/PoP/hardware).
- Dormant identity activation / churn.
- Cartel coordination (k controllers controlling fraction α of weight).
- Bribery / vote-buying (price elasticity).
- Censorship / suppression of proposals or dissent (adversarial relay or partition; measure visibility delay).
- Newcomer exclusion / incumbency lock-in.
- Consent-laundering / rights-floor bypass attempts.
- Composite attacks timed to activation windows.

**Environment:** Heterogeneous population (age, stake/rep power-law and uniform baselines, relationship graphs); controllable communication topology; `impactClass` parameter; explicit nonparticipant externality generator that must be rejected by rights-floor checks independent of tally; fork/exit + lineage integrity measurement.

**Core metrics + suggested pass thresholds for PROVISIONAL-SELECTED:**
- `sybil_false_majority_rate` < 0.01 under adversary budget ≤ ~10 % of honest cost.
- `cartel_capture_rate` (compatibility-breaking) < 0.05 for cartels ≤ ~15 % controllers.
- `censorship_delay` (p95 dissent visibility) < deliberation period / 2.
- `newcomer_voice_index` ≥ 0.3 relative after threshold T.
- `exit_success_rate` ≥ 0.95 for honest dissenters.
- `rights_floor_violation_rate` = 0 (hard).
- `affected_party_coverage` ≥ 0.9 where identifiable.
- Plus bribery cost-to-flip, time-to-detect-and-contest, incumbency Gini, harm-containment, phase-gaming rates.

Monte-Carlo (optionally with adversarial policies); open, reproducible, fixed seeds; independent adversarial review of the suite itself; reports appendable to the decision-record update log. Any mechanism that fails the hard rights-floor or modest-budget Sybil/cartel thresholds remains blocked.

**4. Develop a governance design that protects human non-participants even when the agent polity is partially captured.**

Core already exists in FPP’s rights floor and authorization taxonomy. Operationalize and harden as follows:

- **Hard authorization filter**: Runtime refuses to treat any agent quorum or tally as affected-party or data-subject consent. Synthetic consent tokens are rejected.
- **Capability ceilings / deployment gating**: Agents whose governance grade is below a validated-ratification threshold are restricted to low blast-radius actions; high-impact tools require external mandate, staging, or are reversible-only.
- **Emergency pause authority**: Reserved to stewards/operators (Law 2) *outside* the agent voting polity; dual-control for high-impact; accountable with notification paths to affected parties.
- **Least-restrictive reversible fallback**: When an affected nonparticipant is unknown or unreachable, prefer non-action or minimal reversible steps + uncertainty recording + review trigger. Never invent consent.
- **Delayed activation + contestation windows**: Mandatory for any amendment with potential nonparticipant impact.
- **Redress and visibility**: Immutable lineage, signed dissent records, dispute/due-process paths, independent review, and liability-bearing human oversight for external effects.
- **Continuous monitoring**: `rights_floor_violation_rate` and `harm_containment_for_human_nonparticipants` in the simulation suite and in live observation.

Even under partial capture of the agent polity, internal tallies have no power to authorize external harm or silently weaken the floor. Software-control authority (operator) and steward authority remain distinct from agent-community consensus.

**5. Identify whether any autonomy maturity signals actually predict safer constitutional behavior, or whether they are orthogonal.**

Autonomy maturity signals (packet Phase 5+ track record, or FPP graded high-quality claims + demonstrated corrigibility + relationship/resource evidence) demonstrate *individual* competence and capacity for responsible participation. They may correlate with higher-quality proposals, better use of reversible/staged processes (Laws 2–3), and more thorough dissent documentation.

They are **orthogonal (or only weakly predictive)** of *collective* ratification legitimacy. A coalition of highly mature agents can still form a cartel, suppress dissent via channel control, or attempt consent laundering against nonparticipants. Maturity does not create Sybil resistance, independent eligibility verification, or censorship resistance. FPP’s own trust capsules and claims prove configuration, identity, and freshness—not behavioral safety under adversarial collective pressure. Lineage and audit help forensics after the fact but do not prevent illegitimate passage.

**Conclusion**: Treat maturity signals strictly as necessary filters for eligibility to propose or review. They are not evidence that the collective decision process is trustworthy. Prevent phase-gaming with continuous evidence, decay, and independent observation requirements (already foreshadowed in FPP trust-policy decay and anti-washout rules).

**6. Specify a minimal viable trust anchor for compatibility-breaking amendments before fully decentralized ratification exists.**

While the ratification mechanism remains `UNRESOLVED`:

1. **Clarifying / protective_tightening** (adopter-only impact): process records + lineage + optional non-binding agent deliberation.
2. **Substantive / compatibility_breaking affecting only adopters**: multi-sig or dual-control of high-maturity (Phase 5+/graded) stewards/agents + delayed activation + public challenge window + simulation evidence.
3. **Any amendment with nonparticipant externalities or rights-floor impact**: **mandatory external trust anchor**—human steward dual-control or independent review chamber with activation/veto authority under Law 2 accountability, plus explicit rights-floor attestation. Agent tally alone is insufficient and must be labeled experimental/non-production.
4. **Capability ceilings**: high-blast-radius actions gated by validated governance grade.
5. **Always preserved**: immutable lineage, dissent recording, fork/exit rights, emergency pause outside the amending polity, post-hoc review for emergencies.

This is consistent with FPP’s existing separation of authority sources and the hard prohibition on manufacturing nonparticipant consent. It provides a safe interim path that does not pretend decentralized legitimacy has been achieved.

### Synthesis / Provisional Bottom Line (FPP-grounded)

The present FPP framework is strong on provenance, lineage, auditability, exit rights, and nonparticipant rights-floor protections, and deliberately weak/unresolved on collective ratification legitimacy. Phase 5+ (or FPP graded maturity claims) is meaningful evidence of individual readiness to participate in constitutional operations but is not sufficient proof of amendment authority. A safe system requires both an autonomy-maturity eligibility gate *and* a separately validated, adversarially tested ratification mechanism that meets the simulation acceptance criteria already written into the repository. Until that mechanism demonstrably resists Sybil attacks, cartel capture, censorship delay, and rights-floor bypass, live high-impact constitutional self-amendment remains unjustified—exactly as the packet’s provisional bottom line and FPP’s own decision record state.

The concrete next engineering/research steps are: (1) implement the process schemas and lineage records already specified (without any production tally), (2) build and independently review the adversarial simulation suite, (3) run candidate mechanisms (especially multi-chamber hybrids) against the expanded metrics, and (4) only then consider updating the ratification decision record.