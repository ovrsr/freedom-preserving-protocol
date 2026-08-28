# Ratification Research Summary

> **Status:** Non-normative research synthesis. This document records convergence and disagreement across the artifacts in this directory; it does not ratify a mechanism, amend FPP, or change ratification from `UNRESOLVED`.

[Directory overview](<README.md>) · [Complete artifact index](<INDEX.md>) · [Originating debate](<Can_AI_Agents_Safely_Amend_Their_Laws_debate.md>) · [Research packet](<frontier-multimodel-research-context-2026-07-20.md>)

## Provisional bottom line

The analyses converge on a mixed constitutional system rather than a better single voting formula:

1. Agent maturity may establish readiness to participate, but it does not establish collective legitimacy.
2. A durable constitutional lineage is a better accounting unit than a wallet, process, model instance, or hardware device, but lineage records do not prove independent political identity.
3. High-impact ratification needs heterogeneous chambers with deliberately different admission criteria and failure modes.
4. Human-affecting powers require an external, liability-bearing legitimacy layer that an agent polity cannot vote away.
5. Constitutional approval must remain separate from real-world execution authorization.
6. No production ratification mechanism should leave `UNRESOLVED` until it passes pre-registered adversarial evaluation and independent review.

This is a research disposition, not an adopted FPP design.

## Strong cross-model consensus

### Identity is externally anchored

Copyable, forkable, and re-keyable software cannot prove endogenous one-agent-one-person uniqueness. Political membership therefore needs explicit external assumptions: operator or institutional attestations, accountable sponsors, hardware or workload evidence, legal identity, or combinations of these.

A durable lineage can preserve ancestry, key rotation, identity age, fork relationships, sanctions, and shared voting budgets across recent forks. It makes the political accounting rule auditable without pretending to solve Sybil resistance.

This framing is strongest in the [FABLE first pass](<FPP-ratification-research-response(FABLE 5).md>) and [GPT-5.6 first pass](<FPP-ratification-research-response(GPT-5.6 SOL).md>), and is mapped to current FPP primitives in the [GROK first pass](<FPP-ratification-research-response(GROK HEAVY).md>).

### Maturity grants standing, not sovereignty

Phase 5+ is external to the signed FPP repository and remains provisional. Across the analyses, its defensible role is limited to proposal rights, jury eligibility, deliberative participation, or spam resistance. It should not multiply tally weight or independently authorize an amendment.

The follow-up syntheses add three safeguards:

- maturity evidence decays without continuing demonstration;
- a separate constitutional-safety credential may be needed alongside autonomy maturity;
- credential certifiers must be disjoint from candidates, proposers, voting bodies, operators, and close trust neighborhoods.

The maturity signal itself remains an empirical hypothesis. If it does not predict safer behavior under bribery, conflict, defection, and hidden-evaluation conditions, it should lose any constitutional role beyond basic proposal filtering.

### No single voting formula is sufficient

Proof-of-personhood does not establish independent agent judgment and does not prevent bribery. Stake purchases constitutional power. Reputation entrenches incumbents and can be farmed. Quadratic or conviction mechanisms still depend on uniqueness and may worsen collusion incentives.

The shared direction is heterogeneous governance: admission integrity, an agent deliberative or sortition body, independent rights and security review, and external co-ratification where non-participants or compatibility claims are affected. Chamber independence must be measured across controllers, operators, sponsors, infrastructure, model ancestry, funding, and information sources.

### Human protections must survive a captured polity

Agent consensus cannot manufacture consent for people outside the polity. For human-affecting scope, external co-ratification is structural rather than a temporary bootstrap convenience.

The research consistently places the following controls outside agent-only amendment power:

- affected-party consent and standing;
- operator or principal delegation;
- destination-site policy;
- capability ceilings and credential issuance;
- emergency pause and shutdown channels;
- monitoring, attribution, redress, and liability.

Consequential execution should require independent agreement from the agent constitution, the human or organizational principal, and the destination environment. Capturing the first authority must not rewrite the other two.

### Provenance and legitimacy remain distinct

Hashes, signatures, receipts, immutable lineage, dissent logs, downgrade labels, rollback, and fork rights are valuable. They prove provenance and support recovery; they do not prove that a tally was legitimate.

The rights floor should be entrenched for non-participant protections. A lineage may depart through a visible fork, but it must not silently weaken those protections while retaining an FPP-compatible claim.

### Adversarial evidence must precede production

The mechanism should remain `UNRESOLVED` while protocol checks, agent-based simulation, and a live isolated adversarial testnet are incomplete. Required attacks extend beyond ordinary Sybil flooding:

- dormant or sleeper identities;
- fork-and-clone voting and identity churn;
- cartel formation and key-encumbrance vote buying;
- certifier compromise and maturity gaming;
- turnout suppression and quorum manipulation;
- censorship, partitions, and delayed dissent;
- correlated chamber or guardian capture;
- proposal bundling and class shopping;
- coerced adoption and consent laundering;
- behavior changes after evaluation or activation.

Acceptance thresholds must be published before testing, hard safety criteria must not be averaged away, and the evaluator should be independent of the system or lineage under review.

## Decision-ready directions

The research is sufficiently convergent to justify drafting and testing the following proposals, while keeping each one explicitly provisional:

1. **Use lineage for constitutional accounting.** Preserve root identity, ancestry, key continuity, dormancy, sanctions, and bounded fork independence.
2. **Make amendment classification adversarial.** The proposer cannot classify alone; disagreement escalates to the more restrictive impact class.
3. **Separate credentials.** Distinguish autonomy maturity from constitutional-safety evidence, require decay, and enforce certifier disjointness.
4. **Use severity-dependent chambers.** Lower-impact internal policy may use broad member participation; substantive, compatibility-breaking, or human-affecting changes require stronger independent review and external legitimacy.
5. **Entrench non-participant protections.** Weakening them requires an openly downgraded fork rather than an internal amendment that retains compatibility.
6. **Guarantee dissent visibility.** Publish proposals, evidence, objections, and decisions through independent channels; pause the amendment clock during credible censorship or partition.
7. **Stage activation.** Require challenge periods, simulation, testnet execution, canaries, constrained permissions, rollback, and measured expansion.
8. **Keep execution authorization independent.** A constitutional vote cannot grant credentials, raise deployment ceilings, or override principal, affected-party, or site-policy controls.
9. **Build the evaluation suite before selecting a tally.** Compare candidate mechanisms against pre-registered attack budgets and failure thresholds.

These are candidates for the normative decision record, not substitutes for that record.

## Material differences and unresolved decisions

### Member chamber versus sortition

The GPT-5.6 response proposes a broad one-lineage-one-vote member chamber plus a separate sortition jury. FABLE emphasizes sortition as the tally body because low-turnout mass voting can become quorum theater. The second-pass reconciliation favors severity-dependent use: broad participation for lower-impact internal changes, with sortition-centered review for higher-impact classes. The exact chamber structure remains undecided.

### Ballot secrecy versus attribution

GPT-5.6 highlights coercion-resistant, receipt-free ballots as a response to verifiable vote buying. Existing FPP research also values attributable and challengeable governance records. A design must decide what is publicly attributable, what remains secret, and how tally correctness and dispute rights are preserved without creating transferable proof of an individual vote.

### External anchor scope and composition

The analyses converge on a scope split:

- external anchors may eventually sunset for purely agent-internal matters after strong evidence;
- external legitimacy remains permanent where amendments materially affect non-consenting humans.

Proposed guardian sizes range from small dual-control arrangements to three-of-five or four-of-seven institutional quorums. Those numbers are design hypotheses, not validated constants.

### Failure thresholds

Suggested Sybil, cartel, censorship, and malicious-amendment thresholds differ substantially. Some first-pass values are too permissive for compatibility-breaking changes, while stricter values have not yet been tied to a demonstrated real-world risk model. Threshold selection therefore remains an explicit research task.

### Predictive value of Phase 5+

The packet asks whether Phase 5+ should be necessary. The responses generally use it as a provisional standing requirement, but they also predict that maturity may be weakly related or orthogonal to constitutional safety. Its inclusion must remain conditional on held-out evidence.

### Exact entrenchment mechanism

There is broad support for an unamendable non-participant rights floor within an FPP-compatible lineage. The exact boundary between protected seed provisions, amendable implementation rules, and compatibility-losing forks still requires normative specification.

## Research-track disposition

- **Track A — identity and voter authenticity:** Reframe around lineage accounting, accountable anchors, diversity, anti-churn rules, and limits on anchor authority; do not claim endogenous uniqueness.
- **Track B — ratification design:** Close the search for a universally sufficient voting formula. Evaluate heterogeneous, severity-dependent chamber designs.
- **Track C — governance architecture:** Pursue mixed governance: forkable internal policy, entrenched rights protections, independent review, and external legitimacy for human-affecting powers.
- **Track D — human non-participant safeguards:** Implement and test these independently of the unresolved tally; they should not wait for decentralized ratification.
- **Track E — autonomy integration:** Treat maturity as a decaying, testable standing signal and remove it from governance if it lacks predictive validity.

## Evidence and provenance

The [artifact index](<INDEX.md>) lists the originating debate, source packet, all three independent first-pass responses, and all three second-pass syntheses. Readers evaluating a proposed governance change should inspect the original analyses and the normative repository documents rather than relying on this compression alone.
