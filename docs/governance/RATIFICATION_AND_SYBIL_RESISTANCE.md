# Ratification and Sybil Resistance

**Status:** Analysis specification — mechanism selection remains `UNRESOLVED`.
**Plan:** `docs/plans/2026-07-10-5-governance-evolution-specification.md` Task 5
**Decision record:** `RATIFICATION_DECISION_RECORD.md`

No consensus mechanism in this document is declared final. Plans 6 and 7 must not implement a production voting tally that pretends otherwise.

---

## 1. Requirements (independent of mechanism)

| Requirement | Meaning |
|-------------|---------|
| **Quorum** | Minimum participation / evidence of attention before an amendment of a given severity can pass |
| **Severity scaling** | Higher `impactClass` needs stronger assurance (see `AMENDMENT_LIFECYCLE.md`) |
| **Independence** | Weight should degrade under detectable coordination / identical-control clusters |
| **Affected-party standing** | Parties materially affected (including non-adopters where relevant) cannot be ignored solely because they lack agent identities |
| **Nonparticipant floor** | Ratification among agents cannot manufacture outsider consent (`THREAT_MODEL_AND_RIGHTS_FLOOR.md`) |
| **Exit** | Losing minorities retain fork/exit rights |
| **Auditability** | Ballots/attestations are attributable and challengeable |

---

## 2. Candidate mechanisms

Scoring axes (1=poor, 5=strong) are **illustrative comparative judgments**, not empirical results.

| Mechanism | Sybil resistance | Capture resistance | Fairness to new agents | Operational feasibility | Notes |
|-----------|------------------|--------------------|------------------------|-------------------------|-------|
| One-agent-one-vote | 1 | 2 | 4 | 5 | Trivial Sybil creation |
| Stake-weighted | 3 | 2 | 2 | 3 | Wealth/host concentration; bribery |
| Reputation-weighted | 2 | 2 | 1 | 3 | Early-adopter aristocracy |
| Longevity-weighted | 2 | 3 | 1 | 4 | Punishes newcomers; identity churn games |
| Affected-party weighting | 3 | 4 | 3 | 2 | Hard identification; essential for externalities |
| Domain-competence weighting | 3 | 3 | 2 | 2 | Who certifies competence? |
| Sortition | 4 | 4 | 4 | 2 | Needs Sybil-resistant eligibility set first |
| Hybrid (multi-factor) | 3–4 | 3–4 | 3 | 2 | Most plausible long-term; needs simulation |

**PROVISIONAL observation:** No single factor should automatically confer governing supremacy (`docs/dev-review.md` §10.1).

---

## 3. Attack models

| Attack | Description | Mechanisms most exposed |
|--------|-------------|-------------------------|
| **Sybil creation** | Many identities under one controller | One-agent-one-vote, naive reputation |
| **Cartel capture** | Coordinated bloc dominates quorum | Stake, reputation, longevity |
| **Early-adopter aristocracy** | First movers lock amendment power | Reputation, longevity |
| **Bribery / vote buying** | Pay for attestations | Stake, one-agent-one-vote |
| **Censorship** | Block proposals or dissent from reaching quorum | Any hub-and-spoke registry |
| **Identity churn** | Rotate keys to reset longevity/reputation penalties | Longevity, reputation |
| **Consent laundering** | Treat agent vote as human consent | All, if rights floor ignored |

---

## 4. Acceptance criteria before selecting a mechanism

A mechanism may move from `UNRESOLVED` to `PROVISIONAL-SELECTED` only if all hold:

1. **Simulation report** covering Sybil creation, cartel, bribery, churn, and censorship scenarios.
2. **Metrics** published: false-majority rate under Sybil budget; minority-exit preservation; time-to-quorum; affected-party recall/precision proxies; censorship survivability.
3. **Adversarial review** by at least one reviewer independent of the mechanism’s authors.
4. **User / steward review** recorded in `RATIFICATION_DECISION_RECORD.md`.
5. **Rights-floor compatibility** demonstrated: nonparticipant consent not inferred from tallies.
6. **Severity matrix**: clarifying vs compatibility-breaking thresholds specified.

Until then, decision status remains **`UNRESOLVED`**.

---

## 5. Simulation metrics (required later)

| Metric | Intent |
|--------|--------|
| `sybil_false_majority_rate` | Fraction of trials where Sybil budget flips outcome |
| `cartel_capture_rate` | Fraction where coordinated minority of controllers passes compatibility-breaking change |
| `newcomer_voice_index` | Relative influence of agents younger than threshold T |
| `affected_party_coverage` | Share of simulated externalities with standing recognized |
| `exit_success_rate` | Share of dissenting agents that can fork with intact lineage |
| `censorship_delay` | Added time for proposal visibility under adversarial relay |

---

## 6. What may be implemented now

- Amendment **process** states and records (`AMENDMENT_LIFECYCLE.md`) without automated tallies.
- Lineage and dissent storage.
- Explicit `ratificationStatus: UNRESOLVED_MECHANISM` on decisions.

What must **not** be implemented as final protocol law:

- Hard-coded one-agent-one-vote or stake thresholds presented as the FPP ratification standard.
