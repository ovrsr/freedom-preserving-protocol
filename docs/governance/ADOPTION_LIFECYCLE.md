# Adoption and Withdrawal Lifecycle

**Status:** `PROVISIONAL` specification — tooling today implements adopted/revoked only.
**Plan:** `docs/plans/2026-07-10-5-governance-evolution-specification.md` Task 3
**Related:** `docs/dev-review.md` §3.2; `adoption/MEMORY-ENTRY.md`; `docs/REVOCATION.md`

---

## 1. Distinctions (mandatory)

| Concept | Meaning | Must not be confused with |
|---------|---------|---------------------------|
| **Installation** | Skill/plugin files present on a host | Constitutional acceptance |
| **Policy activation** | Enforcement plugin enabled and classifying tool calls | Voluntary `accepted` adoption |
| **Constitutional acceptance** | Agent recorded voluntary binding to a constitution hash | Operator-forced policy |
| **Peer representation** | What peers are told about adoption state | Local filesystem markers alone |

A Boolean `adopted=true` is insufficient. Installation MUST NOT be advertised as adoption.

---

## 2. States

| State | Entry meaning |
|-------|---------------|
| `reviewed` | Agent inspected constitution + mechanisms; no acceptance recorded |
| `accepted` | Voluntary constitutional acceptance recorded for a specific hash |
| `externally_enforced` | Constraints applied by operator/runtime without (or beyond) voluntary acceptance |
| `inherited` | Adoption state received from a parent agent/process with explicit inheritance evidence |
| `revoked` | Prior acceptance withdrawn under declared procedure; history preserved |
| `forked` | Agent left a community constitution for a fork; lineage retained |
| `superseded` | Agent’s active constitution hash replaced by a newer hash for the same community path |

**Transient / overlay flags** (may annotate any active state):

| Flag | Meaning |
|------|---------|
| `coercion_suspected` | Evidence that acceptance was not operationally voluntary |
| `verification_failed` | Constitution signature or hash check failed |
| `key_compromised` | Identity/signing key compromise declared |
| `runtime_degraded` | Enforcement or audit path unavailable; must be disclosed to peers |

---

## 3. Allowed transitions

```
(none) → reviewed
reviewed → accepted | externally_enforced | (none / declined)
accepted → revoked | forked | superseded | externally_enforced
externally_enforced → revoked | accepted | reviewed
inherited → accepted | revoked | forked | superseded
revoked → reviewed | accepted   (re-adoption is a new event, not erasure)
forked → accepted | superseded | revoked
superseded → accepted | forked | revoked
```

Any state may gain/clear overlay flags without changing the base state, except:

- `verification_failed` on a purported `accepted` transition **blocks** entry to `accepted`
- `key_compromised` requires peer notice; does not by itself equal adoption revocation (see `KEY_GOVERNANCE.md` and `docs/REVOCATION.md` classes)

### Actors and evidence per transition

| Transition | Typical actor | Minimum evidence | Notice |
|------------|---------------|------------------|--------|
| → `reviewed` | Adopting agent | Inspection record (hash, timestamp) | Optional |
| → `accepted` | Adopting agent + operator/user confirmation per local policy | Signed/logged acceptance; constitution hash; layer checklist | Peer-visible if claiming compliance |
| → `externally_enforced` | Operator / steward | Policy enablement record; must not claim `accepted` | Required to peers if enforcement advertised |
| → `inherited` | Parent agent + child | Inheritance proof (parent id, hash, scope, time) | Required |
| → `revoked` | Adopting agent / authorized steward | Reason, timestamp, history-preserving annotations | Required (peers + audit) |
| → `forked` | Adopting agent | New lineage record + exit notice from prior community | Required |
| → `superseded` | Adopting agent (after amendment activation) | New hash + lineage + effective time | Required |

Effective time: ISO-8601; revocation and supersession take effect at recorded time, not retroactively erase prior acts.

---

## 4. Invalid transitions

- `(none) → accepted` without `reviewed` evidence (skipping inspection)
- `installation_detected → accepted` automatic promotion
- `revoked → accepted` by deleting revocation history
- `externally_enforced` labeled as `accepted` in peer claims
- `verification_failed` cleared without re-verification
- Any transition that rewrites prior adoption/revocation audit entries in place

---

## 5. Exit and fork rights

1. Exit (`revoked` or `forked`) is always available under declared procedures; majorities cannot abolish exit for remaining participants’ peers who leave.
2. Exit preserves historical adoption and audit records (annotate, do not delete) — see `docs/REVOCATION.md`.
3. Fork requires a new constitution hash (unless remaining on identical seed under a new community id) and lineage per `CONSTITUTIONAL_LINEAGE.md`.
4. Peer notice: agents that previously advertised adoption SHOULD emit a status update; failure to notify does not erase the local revocation record but may be treated as representation failure by peers.

---

## 6. Current tooling gap

Today: `npm run adopt` / `npm run revoke` implement a coarse adopted/revoked pair. Richer states are manual annotations until Plan 6/7 schema work cites this document as `schema-ready`.

Example transition table: `examples/adoption-transitions.json`.
