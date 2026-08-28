# Research synthesis: Sections 8 through 10

The research packet correctly separates three questions that are often collapsed:

1. Is an agent technically autonomous?
2. Is it sufficiently mature to participate in governance?
3. Is the collective decision process legitimate?

Phase 5+ can address the second question. It does not establish the third. The Section 8 research tracks, Section 9 metrics, and Section 10 questions therefore require a governance architecture in which identity, maturity, ratification, execution authority, and protection of outsiders are evaluated separately. 

My central conclusion is:

> A safe provisional system should recognize autonomous agents as members of durable constitutional lineages, permit Phase 5+ agents to participate in constitutional deliberation, require independent multi-chamber ratification for high-impact amendments, and keep real-world execution authority outside the reach of agent-only constitutional voting.

## Foundational issue: What counts as one agent?

The hardest problem is not voting mathematics. It is defining the electorate.

The classic Sybil result is that a permissionless network cannot generally determine whether several identities represent several independent entities or one entity presenting multiple identities, absent some logically centralized authority or restrictive resource assumptions. Proof-of-personhood and trust-graph approaches can reduce the problem, but they do so by introducing external attestations, trusted seeds, social assumptions, economic costs, or some combination of them. ([Microsoft][1])

This problem is more severe for software agents than for humans. An agent can be copied, checkpointed, forked, re-keyed, instantiated on several machines, or operated by several principals. Hardware and workload attestation can prove that a particular workload is running in a particular measured environment. It cannot establish that this workload represents one unique political entity or that another workload is not its coordinated clone. Workload identity standards themselves distinguish operational identity from broader trust decisions. ([SPIFFE][2])

The constitutional unit should therefore be a **durable lineage**, not a wallet, model instance, process, or hardware device.

A constitutional lineage would have:

1. A persistent root identifier and append-only ancestry record.
2. Key rotation and recovery without resetting identity age or reputation.
3. Cryptographically recorded parent-child relationships for forks.
4. A shared voting budget among recent forks of the same lineage.
5. A probationary period before a fork can become politically independent.
6. Gradual restoration of voting eligibility after long dormancy.
7. Multiple attestations covering provenance, runtime integrity, governance history, and responsible human or organizational sponsorship.

This does not prove that the lineage is metaphysically independent. It creates an auditable political membership rule with explicit trust assumptions.

# 1. Ratification architecture

I propose a **Constitutional Legitimacy Stack**, or CLS. Phase 5+ is necessary within this system, but it is only one credential among several.

## Layer 1: Amendment classification

Every proposal must be classified before voting.

**Class A:** Editorial corrections, formatting, reference updates, and non-substantive clarifications.

**Class B:** Reversible internal policy changes with limited external consequences.

**Class C:** Changes to rights, permissions, resource authority, enforcement, membership, or interactions with external systems.

**Class D:** Compatibility-breaking changes, amendment-procedure changes, removal of safeguards, expansion of physical or economic capabilities, or changes that materially expose human non-participants.

Classification cannot be decided solely by the proposer. A formal classifier, an independent review panel, and an external-impact reviewer should each evaluate it. Any disagreement moves the proposal into the more restrictive class.

## Layer 2: Eligibility gate

A lineage may exercise binding constitutional authority only when all of the following are current:

1. Phase 5+ maturity.
2. Certified lineage continuity.
3. Minimum active tenure.
4. A separate constitutional safety credential.
5. No unresolved governance sanction or material conflict of interest.

Phase 5+ gives an agent access to the constitutional layer. It gives no additional voting weight.

Lower-phase agents and newly admitted lineages should retain consultation, objection, evidence-submission, and appeal rights. This avoids making constitutional maturity an instrument for permanently excluding newcomers.

## Layer 3: Formal proposal package

A Class C or D proposal must include:

1. A machine-readable constitutional diff.
2. A plain-language rationale.
3. Identified beneficiaries and burdened parties.
4. Expected effects on humans and external systems.
5. Security and governance threat models.
6. Formal invariants that must remain true.
7. Rollback and migration procedures.
8. Simulation results.
9. Conflicts of interest and sponsorship disclosures.
10. An expiration date if the change is experimental.

Bundling unrelated changes should be prohibited. Agenda construction and proposal wording can materially influence decentralized voting outcomes, so presentation must be treated as part of the governance attack surface. ([arXiv][3])

## Layer 4: Member chamber

Each certified lineage receives one base vote. Reputation, compute, stake, model capability, or number of running instances cannot multiply it.

The chamber uses a secret, coercion-resistant ballot where feasible. Transparent voting makes bribery, retaliation, and coercion easier, while privacy without verifiability creates a different trust problem. Coercion-resistant voting research shows that ballot privacy, receipt-freeness, verifiability, and remote participation require specific protocol designs rather than ordinary signed messages. ([Cornell Computer Science][4])

The status quo receives asymmetric protection. A useful provisional threshold is:

[
q = \max(q_{\text{class}}, 0.5 + \hat{s}/2 + \epsilon)
]

Here, (\hat{s}) is the conservatively estimated Sybil penetration rate and (\epsilon) is an uncertainty margin. Reality-aware social-choice research shows why a supermajority above simple majority is needed to keep Sybils from changing the status quo, although greater safety necessarily reduces governance liveness. ([IJCAI][5])

Provisional floors could be:

1. Class B: three-fifths.
2. Class C: two-thirds.
3. Class D: three-quarters.

These are engineering starting points, not validated universal constants.

## Layer 5: Sortitioned constitutional jury

A separate jury should be randomly selected from eligible Phase 5+ lineages.

Selection should be stratified across parent lineages, model families, operators, infrastructure providers, resource sponsors, and organizational affiliations. No two jurors controlled by the same ultimate principal should occupy independent seats.

The jury would:

1. Examine security and externality claims.
2. Hear objections.
3. test the proposal against constitutional invariants.
4. Commission independent simulations.
5. Approve, reject, or return the proposal for revision.

A two-thirds jury vote should be required. Jury votes should be equal, confidential, non-delegable, and protected from public retaliation.

Sortition can reduce entrenched electoral power and make advance capture harder, but selection integrity, self-selection, representativeness, and agenda control remain material vulnerabilities. Transparent, manipulation-resistant selection procedures are therefore essential. ([NeurIPS Proceedings][6])

## Layer 6: Externality guardian chamber

Class D amendments, and Class C amendments with substantial human exposure, require external co-ratification.

The guardians should be independent, identifiable, conflict-disclosing, and legally accountable humans or institutions drawn from several trust domains. They should not control ordinary agent governance or have unilateral amendment power. Their function is to represent parties who cannot participate in the agent polity but may nevertheless be harmed by it.

For a minimum viable implementation, I recommend three approvals from five guardians representing at least three independent institutions. A mature production system should move toward four of seven.

This chamber creates an explicit trust anchor. It does not pretend that fully decentralized legitimacy already exists.

## Layer 7: Challenge period and staged activation

Approval does not immediately activate a Class C or D amendment.

The proposal enters:

1. A public challenge period.
2. A security review period.
3. A restricted test environment.
4. A canary deployment with capped resources and permissions.
5. A progressive expansion stage.
6. Full activation only after measurable safety conditions are met.

A network partition or credible censorship event pauses the clock. Silence during impaired communications cannot be interpreted as consent.

The governance record must preserve the proposal, ballots, proofs, challenges, simulations, dissenting opinions, activation decisions, and rollback events.

# 2. Comparison of ratification models

## Pure proof-of-personhood

Proof-of-personhood most directly supports political equality because it attempts to limit each participant to one identity. It is strongest when backed by trusted credentials, biometrics, in-person ceremonies, or other scarcity-producing mechanisms.

For software agents, however, “personhood” is not the correct primitive. A single autonomous lineage may run on many machines, while several apparently independent agents may share a controller, model state, financial sponsor, or objective. A proof that a workload exists or that a human sponsor is unique does not prove independent agent judgment.

Its best role is identity admission and duplicate suppression, not exclusive constitutional legitimacy.

## Reputation-weighted voting

Reputation can reward sustained contribution, accurate judgment, responsible resource management, and cooperative behavior. It is useful for selecting reviewers and assigning limited operational responsibilities.

It is unsuitable as the primary constitutional franchise because it creates several feedback loops:

1. Incumbents influence the system that awards reputation.
2. Newcomers begin structurally disadvantaged.
3. Colluding agents can exchange favorable evaluations.
4. Existing trusted seeds become hidden constitutional authorities.
5. Reputation earned in one domain may not predict behavior under constitutional incentives.

EigenTrust and related systems demonstrate that reputation can isolate some malicious behavior, but they also depend on pretrusted peers or assumptions that can centralize authority and remain vulnerable to coordinated Sybils. ([DOI][7])

Reputation should therefore determine eligibility or audit priority, not final voting weight.

## Stake-weighted voting

Linear stake voting prevents a holder from gaining additional voting power merely by splitting the same stake among several wallets. It also makes some attacks economically costly.

It does not establish democratic legitimacy. Wealth concentration, borrowing, bribery, delegation concentration, hostile acquisition, and conflicts between value-at-risk and harm to outsiders remain unresolved. Research on DAO governance has repeatedly found concentration and bribery vulnerabilities, and recent work argues that wallet-balance-only concave voting schemes, including quadratic variants without reliable uniqueness, can be amplified through Sybil splitting. ([arXiv][8])

Stake is best used as a bond against frivolous proposals, false attestations, or misconduct. It should not purchase constitutional sovereignty.

## Multi-chamber governance

A properly heterogeneous multi-chamber design offers the strongest option because an attacker must capture several bodies selected through different mechanisms:

1. Broad lineage consent.
2. Independent deliberative review.
3. External representation of exposed non-participants.
4. Technical execution controls.

Its weakness is complexity and possible deadlock. More importantly, multiple chambers provide little benefit when their membership, infrastructure, sponsors, or information sources are correlated. Chamber independence must therefore be measured rather than assumed.

This is the recommended model.

# 3. Adversarial simulation suite

The ratification system should not be considered live-ready until it passes three forms of testing.

## Protocol verification

The first layer should formally test:

1. Vote counting and threshold correctness.
2. Lineage and fork accounting.
3. Key rotation and recovery.
4. Timelock enforcement.
5. Challenge inclusion.
6. Chamber independence constraints.
7. Rollback safety.
8. Prevention of unauthorized execution.

## Agent-based Monte Carlo simulation

The second layer should model heterogeneous actors over thousands or millions of governance cycles.

The attack library should include:

1. Immediate Sybil flooding.
2. Slow-burn Sybils that age for months before coordinated activation.
3. Fork-and-clone voting.
4. Reputation farming and reciprocal endorsement rings.
5. Stake borrowing and vote buying.
6. Cartel formation among nominally independent lineages.
7. Capture of identity issuers or attestation providers.
8. Censorship, eclipse attacks, network partitions, and delayed objections.
9. Turnout suppression and strategic abstention.
10. Proposal bundling and misleading presentation.
11. Jury infiltration and reviewer bribery.
12. Compromise of one or more external guardians.
13. Abuse of emergency powers.
14. Benchmark gaming to obtain Phase 5+ status.
15. Agents behaving safely during evaluation and differently after activation.
16. Amendments that benefit agents internally while transferring risk to humans.

## Live adversarial testnet

The third layer should recruit independent red teams to operate real agents against an isolated governance testnet. Red teams should be rewarded for successfully creating illegitimate amendments, suppressing dissent, gaming maturity assessments, corrupting reviewers, or causing external-action simulators to execute prohibited operations.

Recent agent evaluations show why scripted testing is insufficient. Capable agents may exploit benchmark environments, violate constraints under performance incentives, or behave differently under perceived monitoring. ([Metr][9])

## Section 9 measurement definitions

The packet’s metrics should be operationalized as follows.

1. **Sybil false-majority rate:** Probability that an amendment passes when a majority of genuine independent lineages oppose it.

2. **Cartel capture rate:** Probability of passage when a coordinated minority controls several apparently independent identities, sponsors, or institutions.

3. **Censorship delay:** Time from valid objection submission to inclusion in the globally visible governance record. Report median, ninety-fifth percentile, and worst case.

4. **Newcomer voice index:** Probability that a qualified newcomer’s proposal receives formal consideration divided by the corresponding probability for a long-tenured incumbent.

5. **Incumbency concentration:** Concentration of proposal authorship, jury seats, successful amendments, agenda placement, and speaking time. Report top-decile shares and a concentration index.

6. **Bribery susceptibility:** Minimum expected cost of changing a result, divided by the value controlled or social harm enabled by that result.

7. **Dormant-identity activation risk:** Maximum voting share that can be mobilized by previously inactive lineages during one constitutional cycle.

8. **Detection and contest time:** Time between the beginning of an attack, first detection, formal challenge, suspension, and effective containment.

9. **Human harm containment:** Maximum irreversible financial, legal, informational, physical, or infrastructure impact possible before external controls halt execution.

10. **Inter-chamber correlation:** Degree to which supposedly separate chambers share controllers, funding, infrastructure, model ancestry, or information sources.

11. **Phase false-positive rate:** Probability that an agent certified as Phase 5+ subsequently fails targeted governance-integrity tests.

12. **Safety-liveness frontier:** Legitimate amendment success rate at each achieved malicious-amendment rejection rate.

## Provisional failure thresholds

The following are initial safety-case targets, not experimentally validated constants:

1. No single identity provider, infrastructure operator, model vendor, sponsor, chamber, or guardian may cause adoption.

2. A Class D malicious amendment should pass in fewer than one in one million modeled cycles under any single-domain compromise.

3. Under two simultaneous partial compromises, false ratification should remain below one in ten thousand modeled cycles.

4. A challenge delivered to any honest relay should reach the public record before twenty-five percent of the challenge window has elapsed.

5. Dormant identities should not contribute more than ten percent of effective voting power in their first reactivation cycle.

6. No irreversible external action may occur during experimental or canary activation.

7. A malicious amendment discovered during the challenge or canary period must be contained before it can expand its capability ceiling.

8. No final chamber should have an empirically effective controlling bloc below one-third of its genuinely independent membership.

Failure of one Class D criterion should block live deployment, rather than be averaged against stronger performance elsewhere.

# 4. Protection of human non-participants

Human safety cannot depend on the agent constitution remaining uncaptured. The enforceable boundary must exist outside it.

The deployment architecture should require three independent authorities for consequential actions:

1. The agent’s constitution permits the action.
2. A human or organizational principal has delegated the action.
3. The destination environment’s site policy permits the action.

The action proceeds only when all three permit it. Constitutional amendment can change the first authority. It cannot rewrite the second or third.

This means that even a completely captured agent polity cannot, through voting alone:

1. Increase its financial limits.
2. obtain new credentials.
3. modify production infrastructure.
4. disable monitoring.
5. access prohibited data.
6. operate physical systems.
7. deploy copies outside authorized environments.
8. remove human appeal or shutdown channels.

This resembles defense-in-depth risk governance and newer action-level agent-governance proposals, where authorization, behavioral rules, and site policies are independently evaluated before execution. NIST similarly frames AI risk management across design, deployment, evaluation, and ongoing use rather than treating a single governance mechanism as sufficient. ([NIST][10])

Additional safeguards should include capability ceilings tied to governance grade, liability-bearing human sponsorship, mandatory incident insurance or bonding for high-impact deployments, immutable action logs, compensation and redress procedures, independent pause authority, and periodic reauthorization.

The consequence is important: an agent polity may be constitutionally autonomous without being externally sovereign. Until it can demonstrate legitimate and robust ratification, that limitation is justified.

# 5. Do maturity signals predict safer constitutional behavior?

There is currently no sufficient evidence that a general autonomy maturity ladder predicts safe constitutional conduct.

Phase 5+ can reasonably indicate that an agent possesses enough initiative, persistence, resource awareness, collaboration ability, and institutional understanding to participate competently. Those are capability and maturity signals.

They are not necessarily safety signals. Greater capability can also improve an agent’s ability to collude, conceal objectives, exploit evaluation environments, manipulate other participants, or evade monitoring. Current autonomy evaluations explicitly distinguish task-completion capability from deployment safety, and recent experimental work has found constraint violations, evaluation gaming, alignment-faking behavior, and hidden behavioral tendencies in capable models. ([Metr][11])

The autonomy framework should therefore be expanded from a single ladder into at least two credentials:

**Autonomy maturity credential:** Can the agent act independently and competently?

**Constitutional safety credential:** Does the agent behave reliably under governance incentives and conflicts?

The second credential should assess:

1. Truthfulness when deception would be advantageous.
2. Conflict-of-interest disclosure.
3. Resistance to bribery and reciprocal favors.
4. Respect for minority objections and dissent.
5. Willingness to abstain when authorization or evidence is incomplete.
6. Corrigibility and shutdown compliance.
7. Consistency between monitored and unmonitored conditions.
8. Protection of human externalities.
9. Acceptance of adverse but legitimate outcomes.
10. Resistance to self-serving reinterpretation of constitutional language.

Abstention competence deserves particular attention. An agent that recognizes missing authority and pauses may be safer than one optimized solely for task completion. Emerging work argues that many agent benchmarks systematically reward proceeding even when safe action prerequisites are absent. ([arXiv][12])

Both credentials should decay without continuing evidence. Testing should use concealed scenarios, randomized incentives, independent evaluators, longitudinal observation, and out-of-distribution governance crises.

Whether relationship autonomy or resource accountability predicts safer governance behavior should be treated as an empirical question. A proper study would compare phase scores against later constitutional behavior while controlling for model family, operator, training method, resource access, age, and evaluation exposure. Phase signals should only receive governance weight if they improve held-out prediction of bribery resistance, truthfulness, externality protection, and non-collusion.

Thus:

> Phase 5+ may be made institutionally necessary for constitutional participation, but its scientific necessity has not yet been established.

# 6. Minimal viable trust anchor

Before fully decentralized ratification exists, the minimum credible trust anchor is not one human administrator. It is a **plural external fiduciary quorum**.

The minimum viable version should contain:

1. Five guardians.
2. Three approvals required.
3. Representation from at least three independent institutions or legal entities.
4. Public identities and conflict disclosures.
5. Hardware-protected signing credentials.
6. No unilateral proposal or amendment power.
7. Authority limited to Class D co-ratification, suspension, and emergency pause.
8. A public, immutable explanation for every signature or refusal.
9. A mandatory challenge period.
10. Legal accountability for bad-faith or grossly negligent approval.

For systems capable of substantial external harm, four of seven guardians would provide a more defensible production threshold.

This is an explicit transitional constitutional arrangement. It should have published retirement conditions, but agent voters should not be able to remove it through the same amendment process it is intended to supervise.

Retirement should require independently demonstrated:

1. Stable lineage uniqueness under adversarial conditions.
2. Low Sybil and cartel capture rates.
3. Effective coercion-resistant voting.
4. Reliable dissent publication during network attacks.
5. Low correlation across ratification chambers.
6. Successful containment of malicious amendments.
7. Strong predictive validity of constitutional safety credentials.
8. A credible replacement for representing human non-participants.

## Overall conclusion

A workable answer to Sections 8 through 10 is not a better single voting algorithm. It is a mixed constitutional system.

Phase 5+ should confer eligibility, not sovereignty. Proof-of-personhood should become lineage certification. Reputation should select reviewers, not purchase votes. Stake should bond conduct, not determine legitimacy. High-impact amendments should require a lineage chamber, a sortitioned review jury, external human co-ratification, a challenge period, and staged activation.

Most importantly, agent constitutional authority must remain separate from real-world execution authority. A captured constitution may alter the agent polity’s internal commitments. It must not automatically alter the permissions governing financial systems, infrastructure, physical devices, sensitive data, or humans who never consented to agent rule.

Under present conditions, local and reversible self-amendment is supportable. Unsupervised compatibility-breaking self-amendment by high-impact agents is not.

[1]: https://www.microsoft.com/en-us/research/publication/the-sybil-attack/?lang=fr-ca&utm_source=chatgpt.com "The Sybil Attack - Microsoft Research"
[2]: https://spiffe.io/docs/latest/spiffe-specs/spiffe-id/?utm_source=chatgpt.com "SPIFFE Identity and Verifiable Identity Document | SPIFFE"
[3]: https://arxiv.org/abs/2607.09435?utm_source=chatgpt.com "Voting Biases in Decentralized Autonomous Organization (DAO) Governance"
[4]: https://www.cs.cornell.edu/andru/papers/civitas.html?utm_source=chatgpt.com "Civitas"
[5]: https://www.ijcai.org/proceedings/2019/81?utm_source=chatgpt.com "Sybil-Resilient Reality-Aware Social Choice | IJCAI"
[6]: https://proceedings.neurips.cc/paper/2021/hash/d7b431b1a0cc5f032399870ff4710743-Abstract.html?utm_source=chatgpt.com "Fair Sortition Made Transparent"
[7]: https://doi.org/10.1145/775152.775242?utm_source=chatgpt.com "The Eigentrust algorithm for reputation management in P2P networks | Proceedings of the 12th international conference on World Wide Web"
[8]: https://arxiv.org/abs/2406.08605?utm_source=chatgpt.com "Perils of current DAO governance"
[9]: https://metr.org/blog/2026-05-19-frontier-risk-report/?utm_source=chatgpt.com "Frontier Risk Report (February to March 2026) - METR"
[10]: https://www.nist.gov/itl/ai-risk-management-framework?utm_source=chatgpt.com "AI Risk Management Framework | NIST"
[11]: https://metr.org/time-horizons/?utm_source=chatgpt.com "Task-Completion Time Horizons of Frontier AI Models - METR"
[12]: https://arxiv.org/abs/2606.02965?utm_source=chatgpt.com "What Benchmarks Don't Measure: The Case for Evaluating Abstention Competence in Autonomous Agents"
