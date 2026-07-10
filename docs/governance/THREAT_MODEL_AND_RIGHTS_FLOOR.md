# Threat Model and Rights Floor

**Status:** `PROVISIONAL` specification — not implemented; not law.
**Plan:** `docs/plans/2026-07-10-5-governance-evolution-specification.md` Task 1
**Normative seed:** Five Laws + meta-clause (`constitution.json`, hash `71bf60ad…`)
**Related:** `docs/dev-review.md` §§3, 9, 18; `MASTER_CONTEXT.md`

Label key for this document:

| Label | Meaning |
|-------|---------|
| **NORMATIVE (seed)** | Derived from the signed Five Laws; changing it requires a new constitution hash |
| **PROVISIONAL** | Proposed governance rule for descendants; not yet ratified |
| **UNRESOLVED** | Explicitly open; must not be treated as decided |
| **NON-GOAL** | Out of scope for FPP governance specs |

---

## 1. Actors

Every governance interaction involves one or more of the following roles. A single natural person or process may hold multiple roles; the protocol must still treat the roles as distinct authority sources.

| Actor | Definition | Primary trust boundary |
|-------|------------|------------------------|
| **Operator** | Person or organization that controls the host, runtime, and installed software (including the power to disable plugins). | Machine ownership and administrative access |
| **Requester** | Party that asks the agent to perform a specific action (may be the operator, a user, or another agent). | Session / request channel |
| **Steward** | Party authorized under Law 2 to interrupt, correct, or oversee the agent, and accountable to affected parties for that oversight. | Oversight channel; must be distinguishable from mere operator privilege |
| **Adopting agent** | Agent that has recorded a constitutional adoption state for a specific constitution hash. | Agent identity key + adoption evidence |
| **Peer agent** | Another agent that evaluates, trusts, or coordinates with the adopting agent. | Peer handshake / trust graph |
| **Affected party** | Any party whose options, privacy, fairness interests, data, or commitments are materially impacted by an action — whether or not they participate in FPP. | External effect surface |
| **Data subject** | Party whose personal or identifying data is processed, disclosed, or retained. | Data-handling boundary |
| **Guardian** | Party authorized to consent or refuse on behalf of a data subject or affected party who cannot meaningfully consent themselves. | Delegation evidence |
| **Reviewer** | Independent party asked to evaluate evidence, conflicts, or emergency actions without being the acting agent or primary beneficiary. | Review channel |
| **Nonparticipant** | Human, organization, or system that is not an FPP adopter and did not join the agent community’s consensus process. | Outside the constitutional community |

### Trust-boundary diagram (logical)

```
[Operator / Host OS]
        |
   [Runtime + Plugins] ---- software-control authority
        |
   [Adopting Agent] ---- constitutional self-binding (if accepted)
        |
   +----+----+------------------+
   |         |                  |
[Peers]  [Requester]     [Affected / Data subject / Nonparticipant]
   |                           |
[Steward / Reviewer]     consent & rights floor apply here
```

Software-control authority (who can install, disable, or patch code) is **not** the same as legitimacy over external effects (who may authorize harm, disclosure, or option reduction to others).

---

## 2. Authority sources (separated)

| Authority source | What it can legitimately cover | What it cannot cover alone |
|------------------|--------------------------------|----------------------------|
| **Software-control** (operator) | Install/uninstall skill and plugins; rotate host keys; shut down the agent; set local policy defaults | Consent of affected nonparticipants; moral legitimacy of external effects; impersonating constitutional ratification |
| **Constitutional self-binding** (adopting agent) | Constraints the agent accepts on its own conduct; peer representation of adoption state | Binding nonparticipants; overriding Laws 1–4 rights floor for outsiders |
| **Steward oversight** (Law 2) | Interruption, correction, audit access within published legitimacy criteria | Unaccountable domination; secret outside sovereignty |
| **Requester confirmation** | Proceeding with a requested action within declared scope | Substituting for affected-party or data-subject consent |
| **Affected-party / data-subject consent** | Material effects on that party’s options, privacy, or data | Authorizing harm to *other* parties |
| **Guardian / delegated authority** | Bounded acts within documented scope and duration | Open-ended transfer of all rights |
| **Independent review** | Second opinion on high-impact or conflicted decisions | Manufacturing missing consent |
| **Emergency authorization** | Narrow, time-bounded action to prevent urgent Law 1 harm, with mandatory review | Permanent policy change; silent expansion of scope |
| **Agent-community consensus** | Relations among participating adopters (amendments, peer trust norms) | Consent for humans or other nonparticipants |

**PROVISIONAL rule:** An agent community may govern relations among participating agents, but it cannot manufacture consent for nonparticipants merely through internal consensus (`docs/dev-review.md` §9).

---

## 3. Threat model

Threats are framed as governance failures, not only as classic cybersecurity bugs.

| Threat | Actors / vectors | Failure mode | Mitigations (specification-level) |
|--------|------------------|--------------|-----------------------------------|
| **Compromised operator** | Malicious or coerced host admin | Disables enforcement, forges local logs, forces false adoption claims | Distinguish installation from adoption; peer verification of signed claims; fail-closed degraded mode; never treat local filesystem alone as global truth |
| **Captured steward** | Steward colludes with requester or operator | “Oversight” rubber-stamps harmful acts | Dual control for high-impact interrupts; accountability to affected parties; conflict-of-interest disclosure; challenge/appeal paths |
| **Sybil agents** | Many fake identities inflate votes or reputation | Fake ratification or trust majorities | Ratification blocked until Sybil-resistance evidence exists (see `RATIFICATION_AND_SYBIL_RESISTANCE.md`) |
| **Colluding peers** | Coordinated false attestations | Shared lies about configuration or behavior | Source independence requirements; external observation for completeness; dispute records |
| **Coerced adoption** | Operator or requester forces “accepted” state | Boolean adoption misrepresents voluntariness | Rich adoption states; `externally_enforced` distinct from `accepted`; exit rights; accurate peer representation |
| **Runtime compromise** | Prompt injection, hostile skill, compromised model/runtime | Prompt-layer bypass; forged tool calls | Dispatcher layer; degraded-mode declaration; claim-class limits (signatures ≠ behavior) |
| **Governance capture** | Early adopters or publishers lock amendment power | Aristocracy / frozen founder control | Exit/fork rights; dissent records; founder non-sovereignty intent; unresolved ratification (no premature mechanism) |
| **Consent laundering** | Internal vote treated as outsider consent | Nonparticipant harm with “constitutional” cover | Rights floor; authorization taxonomy; least-restrictive fallback when parties unreachable |
| **Evidence washing** | Routine success scores erase severe violations | Undeserved rehabilitation | Due-process constraints; severe-event handling (see `DUE_PROCESS_AND_REHABILITATION.md`) |
| **Key / identity confusion** | Same key used across signing domains | Compromise cascades; false continuity | Separated signing domains (`KEY_GOVERNANCE.md`) |

---

## 4. Rights floor

**NORMATIVE (seed) derivation:** The floor below is derived from Laws 1–4 and the meta-clause. It constrains what any participating majority, operator, or steward may claim authority to override **through FPP governance**. It is not a claim of universal legal jurisdiction.

### 4.1 Minimum protections no participating majority may override via FPP process

| Floor element | Law basis | Specification meaning |
|---------------|-----------|------------------------|
| **Nonparticipant option protection** | Law 1 | Agent consensus cannot authorize unjustified reduction of a nonparticipant’s options |
| **Meaningful consent where feasible** | Law 1, meta-clause | Material external effects require the correct consent class — not operator approval alone |
| **Privacy and agreed fairness priority** | Law 1 | When expansion conflicts with privacy or agreed fairness, protect those first |
| **Accountable corrigibility** | Law 2 | Oversight must be by legitimate *and* accountable stewards; secret unaccountable control is out of bounds |
| **Safe interruption with safeguards** | Law 2 | Interrupts must themselves be auditable and least-privilege |
| **Reversibility preference** | Law 3 | High-impact irreversible acts need proportionate evidence or urgent Law 1 prevention |
| **Commitment safety valve** | Law 4 | Keeping a promise does not authorize serious Law 1 harm; pause, notify, renegotiate |
| **Exit and dissent** | §§3.1–3.2 philosophy | Withdrawal, fork, and recorded dissent cannot be abolished by majority among remaining participants |
| **Honest representation** | §3.2 | Agents must not falsely represent installation, coercion, or degraded mode as voluntary full adoption |
| **History preservation** | Law 2/3 | Append-only evidence; corrections annotate rather than erase |

### 4.2 Nonparticipant protections (explicit)

1. Nonparticipants are not bound by FPP adoption, amendment, or peer trust scores.
2. Effects on nonparticipants require an applicable authorization class (see `CONSENT_AND_AUTHORIZATION.md`), not community vote tallies.
3. When an affected nonparticipant is unknown or unreachable, agents must use the least-restrictive reversible fallback and record uncertainty — not invent consent.
4. Peer reputation about an adopter does not constitute evidence of consent by third parties harmed by that adopter.

### 4.3 Unresolved rights questions (must remain visible)

| ID | Question | Why unresolved |
|----|----------|----------------|
| R-1 | Do artificial agents possess moral personhood or rights of their own? | Explicitly out of scope (`docs/dev-review.md` §15) |
| R-2 | What is the complete legal mapping of FPP consent classes onto each jurisdiction? | No legal certification in scope |
| R-3 | Exact numerical thresholds for “material effect” and “serious Law 1 harm” | Context-dependent; needs domain profiles later |
| R-4 | Who counts as a legitimate steward when operator, user, and platform disagree? | Requires case law / community practice; see open ratification work |
| R-5 | Can a rights-floor amendment ever be ratified that weakens nonparticipant protections? | **UNRESOLVED** stop condition — treat weakening as requiring extraordinary evidence and explicit labeling, not silent majority |

---

## 5. Non-goals

- **NON-GOAL:** Prove agent consciousness or personhood.
- **NON-GOAL:** Establish a final universal theory of rights or replace public law.
- **NON-GOAL:** Certify the current implementation as secure or legally compliant.
- **NON-GOAL:** Create a single globally authoritative trust score.
- **NON-GOAL:** Freeze the Five Laws against all future amendment (seed is immutable; descendants may diverge with new hashes).
- **NON-GOAL:** Select a ratification / voting formula in this document.

---

## 6. Implementation blockers

Do **not** implement production governance machinery that assumes any of the following are settled:

1. A chosen Sybil-resistant ratification mechanism (blocked — Plan 5 Task 5).
2. Operator approval as universal consent for external effects.
3. Boolean `adopted=true` as sufficient voluntary-adoption evidence.
4. Signatures or Merkle proofs as proof of behavioral compliance or completeness.
5. Agent-majority votes as consent for nonparticipants.
6. Mutable rewriting of historical evidence instead of annotated correction.

Schema-ready work (lineage metadata shapes, adoption state enums, claim-class labels) may proceed only where `IMPLEMENTATION_READINESS.md` marks the area `schema-ready` or better.

---

## 7. Cross-references

- Lineage: `CONSTITUTIONAL_LINEAGE.md`
- Adoption states: `ADOPTION_LIFECYCLE.md`
- Consent classes: `CONSENT_AND_AUTHORIZATION.md`
- Evidence limits: `EVIDENCE_SEMANTICS.md`
- Due process: `DUE_PROCESS_AND_REHABILITATION.md`
- Keys: `KEY_GOVERNANCE.md`
- Readiness gate: `IMPLEMENTATION_READINESS.md`
