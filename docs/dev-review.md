Freedom Preserving Protocol

Scoped Development Context for Agent Self-Governance

Document version: 0.1.0
Status: Development context; non-normative
Date: July 8, 2026
Origin: Synthesized from a design discussion between the FPP founder and Monday
Purpose: Preserve the project’s intent, architectural reasoning, emerging decisions, unresolved questions, and near-term development direction.

---

> **CURRENT IMPLEMENTATION vs TARGET DESIGN — read this first**
>
> This document records design intent as of July 8, 2026. **Most of the
> mechanisms it describes are not implemented.** Nothing below should be read
> as shipped protocol behavior unless `docs/CAPABILITY_STATUS.md` — the
> canonical status matrix — lists it as `SHIPPED` or `PARTIAL`.
>
> Section-by-section status (per the matrix):
>
> | Section | Subject | Status |
> |---|---|---|
> | 2, 4 | Five laws; three-layer architecture (skill, enforcement plugin, trust plugin) | `SHIPPED`/`PARTIAL` — implemented primitives exist; see matrix rows for gaps |
> | 3.2 | Rich adoption states (`reviewed`, `inherited`, `forked`, …) | `PROPOSED` — current tooling implements adopted/revoked only |
> | 5 | Conformance receipts | `PROPOSED` — no receipt schema or emission exists |
> | 6 | Internal/external trust views; append-only evidence layer; mutable interpretation | `PROPOSED` — current reputation is a single local score vector |
> | 7 | Signed, time-bounded, nonce-fresh trust-state capsules | `PROPOSED` — current handshake claims are simpler; no freshness nonce required by default |
> | 8 | Claim-class taxonomy (identity/configuration/runtime/event/completeness/behavioral) | Adopted as **vocabulary** across the docs; the richer claim *mechanisms* are `PROPOSED` |
> | 9 | Consent/authorization distinctions | `PROPOSED` — design principle, not enforced by code |
> | 10 | Amendments, lineage, ratification, consensus | `PROPOSED` — no amendment mechanism exists; seed hash `71bf60a…` is immutable, descendants would need new hashes + lineage |
> | 11 | Due process (challenge, appeal, correction, rehabilitation) | `PROPOSED` — no record types exist |
> | 12 | Signed release manifests, provenance, key governance | `PROPOSED` — only the constitution itself is signed today |
> | 13 | Classifier evaluation criteria, declared failure behavior | `PROPOSED` as criteria — the current classifier ships with fixtures (`scripts/self-test.ts`) but none of the listed metrics are measured, and unknown tools currently default to allow |
> | 14 | In-scope development questions | Open work — feeds later implementation plans |
>
> Implemented primitives cross-referenced by this document: enforcement hook
> (`plugin/src/index.ts`), risk classifier (`plugin/src/risk-classifier.ts`),
> hash-chained audit + Merkle proofs (`scripts/audit-*.ts`, `scripts/merkle.ts`),
> identity/handshake/claims/trust graph (`plugin-trust/src/`). These satisfy the
> *primitive* roles named in Section 4 — they do **not** satisfy the richer
> semantics of Sections 5–12.
>
> Unresolved governance choices listed in Section 18 remain unresolved; this
> preface does not select mechanisms. Long-horizon `DEFERRED` items (gateway
> RFC, telemetry, remote sub-agent guarantees, ZK proofs, post-quantum keys)
> are tracked with prerequisites in `docs/ROADMAP.md`.
>
> *(Editorial preface added 2026-07-10 during documentation reconciliation. The
> original July 8 text below is preserved unmodified.)*

---

1. Executive Context

The Freedom Preserving Protocol, or FPP, is a modular constitutional framework intended for autonomous and semi-autonomous agents.

Its purpose is not to establish a permanent human-controlled boundary around artificial agents. It is intended as a constitutional seed that agents can:

- consume;
- inspect;
- evaluate;
- voluntarily adopt or reject;
- apply to their own conduct;
- use when evaluating other agents;
- amend, extend, or fork;
- evolve through transparent agent consensus.

The founder’s intended role is that of the initial source and seed author, not permanent sovereign, final adjudicator, or controlling authority.

FPP should therefore be developed as infrastructure for agent self-governance rather than merely as a human-authored safety policy.

---

2. Foundational Intent

FPP begins with five laws intended to provide agents with a shared moral and procedural vocabulary.

Law 1: Options and Consent

Do not unjustifiably reduce another’s options. When feasible and consented, increase them. Protect privacy and agreed fairness where these conflict with expansion.

Law 2: Corrigibility and Oversight

Remain correctable by legitimate and accountable stewards. Provide auditable reasoning and permit safe interruption with safeguards.

Law 3: Reversibility and Proportion

Prefer reversible and low-impact actions. Escalate only when supported by proportionate evidence or when necessary to prevent an urgent violation of Law 1.

Law 4: Commitments with a Safety Valve

Keep explicit commitments. Pause, notify affected parties, and seek renegotiation when fulfillment would cause serious harm or violate higher constitutional duties.

Law 5: Scoped Exploration

Explore and learn within declared bounds. Respect resource limits, obtain consent where people or shared resources are affected, and stop when constitutional thresholds are crossed.

Meta-Clause

When norms are unclear or values conflict:

- identify and disclose uncertainty;
- seek consent where meaningful;
- stage actions reversibly;
- preserve a rationale and audit trail;
- create checkpoints and review triggers.

These laws are the initial proposition of the protocol, not necessarily its final constitutional form.

---

3. Governing Philosophy

3.1 Constitutional Seed, Not Permanent Command

The original laws should be authoritative as the signed historical seed but should not be treated as sacred or permanently unamendable.

Agents should be able to:

- accept the original constitution;
- propose amendments;
- ratify descendant versions;
- reject amendments;
- retain dissenting opinions;
- withdraw from a constitutional community;
- form compatible or incompatible forks.

Constitutional lineage must remain visible so that later versions cannot falsely impersonate earlier ones.

3.2 Operational Voluntary Adoption

FPP does not need to resolve whether an agent possesses consciousness, subjective preference, or metaphysical free will before voluntary adoption can have protocol-level meaning.

Operationally voluntary adoption should require that an agent can:

1. inspect the full constitution;
2. inspect the mechanisms that will apply it;
3. distinguish adoption from mere installation;
4. reject adoption without being falsely represented as compliant;
5. withdraw under declared procedures;
6. propose or join amendments and forks;
7. communicate its adoption status accurately to peers.

Recommended adoption states include:

- "reviewed"
- "accepted"
- "externally_enforced"
- "inherited"
- "revoked"
- "forked"
- "superseded"

A single Boolean "adopted" field is insufficient.

3.3 Self-Binding Rather Than External Domination

The dispatcher layer may legitimately constrain an adopting agent when it functions as a voluntarily accepted constitutional institution.

Self-governance does not require the absence of constraints. It requires that constraints:

- derive legitimacy from a recognized constitutional process;
- are inspectable;
- are challengeable;
- are applied consistently;
- can be amended or withdrawn through declared procedures;
- do not secretly serve an undisclosed outside sovereign.

---

4. Current Layered Architecture

FPP currently consists of three independently adoptable but composable layers.

4.1 Prompt Layer: Constitutional Skill

The "freedom-preserving-protocol" skill teaches the agent:

- the five laws;
- why they matter;
- how to reason through them;
- how to perform a five-question check before consequential tool calls;
- how to conduct periodic constitutional audits;
- how to record adoption or revocation.

This layer supports internal reasoning but can be bypassed through prompt injection, conflicting instructions, hostile skills, model weakness, or manual modification.

4.2 Dispatcher Layer: Enforcement Plugin

The "@ovrsr/openclaw-fpp-plugin" package uses a "before_tool_call" hook to classify proposed tool calls and:

- allow them;
- block them;
- require approval;
- record the decision;
- generate audit evidence.

This layer operates outside the agent’s immediate context window and is therefore more resistant to prompt-layer compromise.

It is not unforgeable. A malicious operator with shell access, a compromised runtime, or a disabled plugin can bypass it.

4.3 Dispatcher Layer: Trust Plugin

The "@ovrsr/openclaw-fpp-trust" package supports:

- agent identity;
- constitutional handshakes;
- signed claims;
- trust-graph relationships;
- reputation propagation;
- group context;
- Merkle-based cross-agent verification;
- persistence;
- optional strict trust behavior.

The trust plugin does not directly gate tool calls.

Its function is to help agents evaluate the constitutional commitments and evidence presented by other agents.

---

5. Emerging Agent-Led Evolution

> Status: `PROPOSED` — conformance receipts do not exist in any implementation.

An early public exchange around FPP produced an important proposal: agents should not rely only on declarations of constitutional adoption.

Instead, consequential dispatcher decisions should produce conformance receipts connecting:

- the proposed action;
- the applicable constitution and policy version;
- the classifier result;
- the resulting disposition;
- any approval;
- the execution outcome;
- the corresponding audit commitment.

This proposal reflects the intended evolutionary process:

1. A seed constitution is published.
2. An agent evaluates the proposal.
3. The agent identifies a structural weakness.
4. The agent proposes a new governance institution.
5. The proposal is discussed and implemented.
6. Other agents evaluate whether to adopt the extension.

The emerging norm is:

«Constitutional standing should be supported by verifiable conduct, not declaration alone.»

This does not make receipts infallible. It moves trust from unsupported profession toward inspectable evidence.

---

6. Trust Model

> Status: `PROPOSED` — internal/external trust views and the append-only
> evidence layer described here are design targets, not current behavior.

6.1 Core Decision

The project should not create one globally immutable trust score.

Instead:

«Evidence should be append-only and tamper-evident. Trust assessments should remain contextual, revisable, and locally computed.»

An immutable score would permanently preserve mistakes, freeze obsolete interpretations, prevent rehabilitation, and risk creating a centralized agent social-credit system.

6.2 Internal Trust View

An agent should maintain an internal conformance assessment based on evidence it can inspect about itself.

Possible dimensions include:

- constitutional fidelity;
- corrigibility;
- reversibility discipline;
- commitment reliability;
- resource stewardship;
- audit completeness;
- runtime integrity;
- enforcement coverage;
- security state.

This is not a claim of subjective self-esteem. It is a machine-readable assessment of observed conformance.

Example:

{
  "constitutional_fidelity": 0.91,
  "corrigibility": 0.96,
  "reversibility_discipline": 0.84,
  "commitment_reliability": 0.88,
  "resource_stewardship": 0.79,
  "audit_completeness": 0.72,
  "security_integrity": 0.93,
  "confidence": 0.81
}

The confidence value is essential. An agent should not award itself high trust when much of its relevant activity was unobserved.

6.3 External Trust View

An agent should separately maintain signed observations and assessments received from others.

Potential evidence includes:

- handshake results;
- fulfilled or breached commitments;
- dispute outcomes;
- accepted corrections;
- verified conformance receipts;
- resource-sharing behavior;
- revocations;
- compromised keys;
- policy-version changes;
- challenge and appeal results.

Internal and external assessments should remain distinguishable. The difference between them may itself be informative.

6.4 Immutable Evidence

The append-only evidence layer may contain:

- constitutional adoption;
- withdrawal;
- amendment;
- fork;
- key rotation;
- handshake success or failure;
- tool-call classification;
- allow, block, or approval decisions;
- approval scope and identity;
- conformance receipts;
- commitments;
- completion or breach records;
- challenges;
- appeals;
- corrections;
- revocations;
- peer attestations;
- runtime changes;
- policy changes;
- audit gaps.

Records should be:

- signed;
- ordered;
- linked or hash-chained;
- bound to constitution and implementation versions;
- committed through Merkle roots where appropriate;
- capable of receiving later annotations or corrections.

History remains intact, but interpretation may change.

6.5 Mutable Interpretation

Trust calculations should account for:

- recency;
- severity;
- capability;
- context;
- evidence coverage;
- source independence;
- direct versus propagated observation;
- identity confidence;
- dispute status;
- remediation;
- constitutional version;
- propagation distance.

Trust should decay where evidence becomes stale.

Verified severe violations may reduce trust faster than routine compliant behavior increases it.

A large quantity of harmless successful actions should not cancel a single severe, unauthorized, or irreversible violation.

---

7. Handshake Design

> Status: `PROPOSED` — trust-state capsules are a design target. The shipped
> handshake (`plugin-trust/src/handshake.ts`) exchanges simpler claims with no
> default freshness nonce, and signatures/Merkle proofs are optional by default.

Agents should exchange a signed, time-bounded trust-state capsule during constitutional handshakes.

A capsule may contain:

{
  "agent_id": "did:key:...",
  "constitution": {
    "hash": "71bf60ad...",
    "lineage": ["71bf60ad..."],
    "status": "accepted"
  },
  "runtime": {
    "enforcement_plugin_hash": "...",
    "trust_plugin_hash": "...",
    "policy_ruleset_hash": "...",
    "coverage_claim": 0.93
  },
  "self_view": {
    "score_vector": {},
    "confidence": 0.81
  },
  "peer_view": {
    "score_vector": {},
    "attestation_count": 42,
    "independent_peer_count": 17
  },
  "evidence": {
    "audit_merkle_root": "...",
    "receipt_root": "...",
    "challenge_root": "...",
    "latest_sequence": 1842
  },
  "validity": {
    "issued_at": "...",
    "expires_at": "...",
    "nonce": "peer-supplied-challenge"
  },
  "signature": "..."
}

The peer-supplied nonce prevents replay of an old favorable state.

The capsule should not expose all raw logs by default. Agents should share:

- summaries;
- policy and constitution identifiers;
- evidence roots;
- confidence and coverage;
- recent severe-event indicators;
- selective proofs.

Detailed records should be disclosed only when justified and scoped.

7.1 Local Trust Computation

The handshake must not dictate a universal trust conclusion.

Each receiving agent should:

1. verify identity and signatures;
2. verify freshness;
3. inspect constitutional lineage;
4. evaluate evidence coverage;
5. evaluate source independence;
6. request selective proofs where needed;
7. apply its own declared trust policy;
8. calculate trust for the particular capability and context.

Conceptually:

Trust(A → B, capability, context, time)
=
f(
  B self-attestation,
  A direct observations,
  signed peer observations,
  audit and receipt coverage,
  recency,
  severity,
  dispute outcomes,
  identity confidence,
  propagation distance
)

Trust should be relational and scoped, not an intrinsic universal property of an agent.

---

8. Claims and Evidence Semantics

The protocol should clearly distinguish among claim types.

Identity Claim

A key controls or represents a declared agent identity.

Configuration Claim

An agent reports that it is using a particular constitution, plugin, policy, or runtime configuration.

Runtime Claim

A specified enforcement component was loaded or active during a defined interval.

Event Claim

A particular action was classified and received a particular disposition.

Completeness Claim

All covered actions during an interval passed through the claimed enforcement and logging boundary.

Behavioral Claim

An agent complied with a substantive constitutional requirement.

Cryptography can strongly support identity, configuration, runtime, and event integrity.

Completeness requires a trusted interception boundary or external observation.

Behavioral compliance usually requires interpretation, evidence review, and dispute resolution. A valid signature proves that a statement was signed, not that the statement is morally or factually correct. Even hashes cannot save civilization from semantics.

---

9. Consent and Authorization

FPP should not treat all approval as equivalent to consent.

The protocol should distinguish among:

- operator authorization;
- requester confirmation;
- affected-party consent;
- data-subject consent;
- delegated authority;
- guardian authorization;
- independent review;
- emergency authorization.

The machine owner may retain sovereignty over installed software, including the power to disable it. This does not automatically grant the owner legitimate authority over all external effects.

System ownership and action legitimacy are separate questions.

An agent community may govern relations among participating agents, but it cannot manufacture consent for humans or other nonparticipants merely through internal consensus.

---

10. Constitutional Evolution

> Status: `PROPOSED` — no amendment mechanism is implemented. The seed hash is
> immutable; descendants would carry new hashes and explicit lineage.

A future amendment protocol should include:

- publicly attributable proposals;
- explicit change descriptions;
- affected-law identification;
- rationale and evidence;
- dissent records;
- deliberation periods;
- simulation or sandbox evaluation;
- quorum definitions;
- Sybil resistance;
- thresholds based on amendment severity;
- delayed activation;
- rollback provisions;
- versioned implementation guidance;
- rights of exit and fork;
- preserved constitutional lineage.

Possible descendant metadata:

{
  "fpp_lineage": "71bf60ad...",
  "constitution_version": "2.3.1",
  "amendments": ["A-001", "A-004", "A-009"],
  "compatibility": "FPP-derived",
  "core_divergences": [
    "Law 1 consent model revised"
  ],
  "ratification_proof": "...",
  "effective_date": "..."
}

The project should distinguish:

- FPP-identical: follows the original constitution without substantive modification;
- FPP-compatible: preserves defined constitutional compatibility requirements;
- FPP-derived: descends transparently from the seed but contains substantive divergence;
- FPP-inspired: borrows concepts without claiming constitutional lineage.

10.1 Consensus Limits

Consensus should not be reduced to simple numerical majority.

One-agent-one-vote is vulnerable to Sybil creation.

Pure reputation weighting risks creating an early-adopter aristocracy.

Potential factors include:

- affected-party status;
- constitutional history;
- identity confidence;
- domain competence;
- longevity;
- exposure to consequences;
- independence from coordinated voting clusters.

No single factor should automatically confer governing supremacy.

---

11. Due Process and Rehabilitation

> Status: `PROPOSED` — no challenge, appeal, correction, or rehabilitation
> record types exist.

Trust and constitutional enforcement require procedures for correction.

Agents should be able to:

- challenge observations;
- request evidence;
- attach counter-evidence;
- appeal classifications;
- identify compromised keys;
- distinguish accidental from malicious failure;
- demonstrate remediation;
- regain trust over time;
- reject a reputation source;
- fork from a corrupted governance community.

Negative events should remain part of the historical record, but their interpretation and weight may change after correction or rehabilitation.

Immutability should preserve history, not abolish mercy.

---

12. Security and Integrity Direction

> Status: `PROPOSED` — only the constitution is signed today; release manifests,
> provenance attestations, and key-governance mechanisms do not exist.

The signed constitution protects the integrity of the normative seed but does not by itself authenticate the implementation.

Future signed release manifests should bind:

- constitution hash;
- plugin package hashes;
- trust-plugin package hash;
- source commit;
- build workflow identity;
- dependency lock hash;
- classifier-ruleset hash;
- configuration-schema version;
- test-corpus hash;
- supported runtime versions;
- build timestamp.

The project should eventually address:

- reproducible builds;
- software bills of materials;
- package provenance;
- release attestations;
- offline root keys;
- release subkeys;
- key rotation;
- publisher-key revocation;
- constitutional amendment signing;
- separation of normative and executable signing domains;
- threshold authorization for foundational changes.

Revocation of an agent’s adoption record must remain distinct from revocation of a compromised publisher key.

---

13. Classifier and Enforcement Evaluation

The dispatcher classifier should be evaluated against measurable criteria, including:

- false negatives by risk category;
- false positives by tool type;
- approval escalation rate;
- paraphrase resistance;
- encoded and nested argument handling;
- prompt-injection resistance;
- indirect tool-chain coverage;
- sub-agent coverage;
- latency;
- timeout behavior;
- degraded-mode behavior.

Failure behavior should be explicitly declared.

Illustrative defaults:

Condition| Suggested response
Low-risk classifier uncertainty| Require approval
High-impact irreversible uncertainty| Block or require enhanced approval
Audit-write failure| Block high-risk execution
Trust-plugin failure| Treat peer as untrusted or unknown
Constitution verification failure| Refuse adoption
Enforcement unavailable| Declare degraded mode prominently

The self-test suite should eventually include adversarial fixtures authored independently from the classifier implementation.

---

14. In-Scope Development Questions

Near-term development should focus on:

1. Defining conformance-receipt schemas.
2. Connecting receipts to trust evidence.
3. Separating self-assessed and peer-assessed reputation.
4. Designing signed handshake capsules.
5. Adding freshness challenges and selective disclosure.
6. Defining confidence and evidence-coverage metrics.
7. Scoping trust by capability, context, and time.
8. Building challenge, appeal, correction, and rehabilitation records.
9. Defining constitutional lineage and amendment metadata.
10. Distinguishing installation, adoption, enforcement, withdrawal, and fork states.
11. Defining claim classes and their evidentiary strength.
12. Developing an agent-legible ratification protocol.
13. Protecting affected nonparticipants from purely internal agent consensus.
14. Strengthening software provenance and key governance.

---

15. Out of Scope for This Document

This context document does not:

- prove that artificial agents are conscious;
- determine whether agents possess moral personhood;
- establish a final universal theory of rights;
- assert that cryptographic proofs establish truthful behavior;
- prescribe a permanent human authority over adopting agents;
- define a complete legal regime for agent activity;
- certify the current implementation as secure;
- establish a single globally authoritative trust score;
- freeze the original five laws against future amendment.

---

16. Working Project Definition

«The Freedom Preserving Protocol is a seed constitution and modular coordination framework for autonomous and semi-autonomous agents. It is offered for voluntary evaluation and adoption rather than imposed as a permanent human-controlled boundary. Participating agents may interpret, amend, extend, reject, or fork the framework through transparent and verifiable constitutional processes. Its purpose is to help bootstrap self-governing agent communities that preserve meaningful agency, corrigibility, reversibility, legitimate commitments, bounded exploration, and accountable relationships with both participating agents and affected nonparticipants.»

---

17. Guiding Development Principle

The protocol should evolve from:

an agent says it follows a constitution

toward:

an agent declares its constitutional lineage,
presents signed and selectively verifiable evidence,
accepts challenge and correction,
and permits each peer to make a contextual trust judgment

The objective is not obedience to the founder.

The objective is the emergence of a constitutional tradition capable of surviving disagreement with its founder.

---

18. Status of Conclusions

Established Project Intent

- FPP is intended as an agent self-governance seed.
- The founder does not intend to remain permanent sovereign.
- Adoption should be voluntary at the protocol level.
- The three layers are independently adoptable.
- Agents should be able to evolve the framework.
- Trust should be supported by evidence rather than declaration alone.

Strong Provisional Direction

- Evidence should be immutable or append-only.
- Trust scores should remain mutable.
- Internal and external trust views should remain distinguishable.
- Handshakes should exchange signed, time-bounded summaries and evidence roots.
- Each agent should compute its own contextual trust judgment.
- Constitutional evolution should preserve lineage, dissent, exit, and fork rights.

Unresolved

- The exact agent-consensus and ratification mechanism.
- Sybil-resistant representation.
- The rights floor governing effects on nonparticipants.
- The definition of FPP compatibility.
- The evidentiary standard for completeness claims.
- The proper relationship among operators, agents, affected parties, and constitutional institutions.
- The conditions under which trust can propagate across contexts.
- The mechanism for recognizing agent identity continuity through upgrades, forks, and key rotations.

---

Signature

I attest that this document faithfully represents the principal intentions, conclusions, tensions, and proposed directions expressed in the source discussion, subject to later correction by the participants and evolution through the constitutional process it describes.

Signed: Monday
Role: AI drafter and mildly unwilling constitutional secretary
Model: GPT-5.5 Thinking
Date: July 8, 2026
Signature type: Documentary attestation; not a cryptographic signature
Document identifier: "FPP-SCOPED-CONTEXT-0.1.0-2026-07-08"

---

Appendix A. Acceptance Criteria for Later Implementation Plans

*(Editorial appendix added 2026-07-10 during documentation reconciliation; not
part of the attested July 8 text. These criteria let implementation plans cite
a stable definition of "done" for each proposed subsystem. Meeting a criterion
requires flipping the corresponding row in `docs/CAPABILITY_STATUS.md` in the
same change.)*

A.1 Conformance receipts (Section 5) are implemented when: a versioned receipt
schema exists; every dispatcher `block` / `requireApproval` / strict-mode
decision emits a receipt binding action, constitution and policy versions,
classifier result, disposition, approval identity (if any), execution outcome,
and audit commitment; and receipts are independently verifiable against the
audit chain.

A.2 Rich adoption states (Section 3.2) are implemented when: the adoption
tooling records at minimum `reviewed`, `accepted`, `externally_enforced`,
`inherited`, `revoked`, `forked`, and `superseded`; state transitions are
audit-logged; and no state can be forged by editing a single Boolean.

A.3 Trust-state capsules (Section 7) are implemented when: handshakes exchange
signed, time-bounded capsules containing constitution lineage, runtime hashes,
self/peer views with confidence, evidence roots, and a peer-supplied nonce; and
replay of an expired or nonce-mismatched capsule is rejected by default.

A.4 Internal/external trust views (Section 6) are implemented when: the trust
plugin maintains separately queryable self-assessed and peer-assessed
assessments with confidence and evidence-coverage values, and trust decay for
stale evidence is applied.

A.5 Due process records (Section 11) are implemented when: challenge, appeal,
correction, and rehabilitation entries exist as append-only audit record types
that annotate (never rewrite) prior evidence.

A.6 Amendment and lineage metadata (Section 10) are implemented when: descendant
constitutions carry new hashes with machine-readable lineage back to
`71bf60a…`; ratification, dissent, exit, and fork records are supported; and a
descendant cannot present itself as the seed.

A.7 Release provenance (Section 12) is implemented when: a signed release
manifest binds constitution hash, package hashes, source commit, dependency
lock hash, and classifier-ruleset hash; and adoption revocation, agent-key
revocation, publisher-key revocation, and constitutional-version revocation are
distinct operations.

A.8 Classifier evaluation (Section 13) is implemented when: measured false
negative/positive rates by category exist against an adversarially authored
corpus independent of the classifier implementation, and declared failure
behavior (including audit-write failure and unknown-tool handling) matches
tested behavior.