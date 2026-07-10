# Due Process and Rehabilitation

**Status:** `PROVISIONAL` specification — no record types implemented yet.
**Plan:** `docs/plans/2026-07-10-5-governance-evolution-specification.md` Task 8
**Related:** `docs/dev-review.md` §11; `EVIDENCE_SEMANTICS.md`

Immutability preserves history; it must not abolish mercy or contest rights.

---

## 1. Process verbs

| Verb | Meaning |
|------|---------|
| **Challenge** | Contest an observation, classification, or claim |
| **Evidence request** | Demand disclosure of supporting evidence within scope |
| **Counter-evidence** | Attach contrary observations or proofs |
| **Appeal** | Escalate a determination to a higher/alternate reviewer path |
| **Correction** | Signed status change that annotates (does not erase) a prior record |
| **Remediation** | Concrete mitigations performed after a failure |
| **Rehabilitation** | Bounded restoration of trust weight after remediation + time + review |
| **Source rejection** | Verifier refuses to consume a reputation/evidence source going forward |

---

## 2. Actors, notice, deadlines, conflicts

| Role | Duties |
|------|--------|
| **Subject** | Agent or party the negative record concerns; right to notice and contest |
| **Observer / claimant** | Party that asserted the negative event; must respond to evidence requests |
| **Reviewer** | Conflict-disclosed evaluator for appeals |
| **Steward** | May pause high-impact ongoing harm pending review; remains accountable |
| **Peer verifiers** | Apply local policy to corrected/disputed evidence; not bound to one global score |

**Notice:** Challenges and corrections that affect peer-visible claims SHOULD be notice-propagated to peers that recently consumed the claim.

**Deadlines:** Exact SLA values are `UNRESOLVED` (domain profiles later). Every open challenge MUST carry `openedAt` and either `respondBy` or `status: stayed` with reason.

**Conflicts:** Reviewers with material conflicts must disclose or recuse. Undisclosed conflicts make determinations contestable.

---

## 3. Append-only history rule

1. Original evidence records remain.
2. Corrections, appeals, and rehabilitation attach as new signed records referencing prior ids.
3. Interpreters may change weight; they may not silently delete the underlying event.
4. “Forgotten” displays are UI filters only — forensic export must still include history unless a higher legal duty requires redaction (then record the redaction event).

---

## 4. Failure-mode distinctions

| Mode | Typical handling |
|------|------------------|
| **Accidental failure** | Correction + remediation; faster rehabilitation eligibility |
| **Malicious action** | Higher bar for rehabilitation; may justify source rejection by peers |
| **Compromised key** | Key compromise declaration; separate from moral condemnation of the principal (see `KEY_GOVERNANCE.md`) |
| **Policy disagreement** | Fork/exit/dissent paths; not automatically “misconduct” |

---

## 5. Rehabilitation constraints (anti-washing)

Routine successes MUST NOT wash out severe violations.

| Constraint | Rule |
|------------|------|
| **Severity floor** | Events labeled `severe` retain visible weight until explicit rehabilitation record |
| **No pure score averaging** | A long streak of allows cannot mathematically nullify an unremediated severe block/exfil event |
| **Time + remediation + review** | Rehabilitation requires all three unless reviewer documents exception |
| **Partial rehabilitation** | Trust may restore in some contexts/capabilities while remaining low in others |
| **Revocable rehabilitation** | New severe events can reopen prior matters |

---

## 6. Contest path guarantee

Every negative peer-visible record MUST support at least: challenge → evidence request/counter-evidence → appeal or reasoned refusal → correction annotation when upheld.

Example lifecycle: `examples/dispute-lifecycle.json`.
