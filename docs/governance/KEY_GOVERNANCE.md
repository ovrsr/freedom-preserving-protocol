# Identity and Key Governance

**Status:** `PROVISIONAL` specification — only constitution publisher signing exists today.
**Plan:** `docs/plans/2026-07-10-5-governance-evolution-specification.md` Task 9
**Related:** `docs/dev-review.md` §12; `docs/REVOCATION.md`; `docs/RELEASE_ASSURANCE.md`

---

## 1. Signing domains (must not be conflated)

| Domain | Purpose | Compromise impact if mixed with others |
|--------|---------|----------------------------------------|
| **Constitution-root** | Sign normative seed / foundational constitutional artifacts | Catastrophic normative impersonation |
| **Release** | Sign release manifests, package provenance | Supply-chain imposture |
| **Agent-identity** | Agent Ed25519 identity for claims/handshakes | Peer spoofing for that agent |
| **Steward-operator** | Human steward OpenPGP bindings (`fpp:steward:v1:…`) for signed operator authorizations | Local operator impersonation for gated tools; does **not** replace agent identity |
| **Runtime-attestation** | Attest runtime/build measurements | False runtime trust |
| **Amendment** | Sign amendment proposals/decisions/lineage activations | Fake ratification / lineage |

**PROVISIONAL rule:** A key in one domain MUST NOT be reused as the sole trust root for another domain. Cross-domain binding happens via manifests and explicit references, not key identity collapse.

---

## 2. Lifecycle events

| Event | Meaning | Auditability |
|-------|---------|--------------|
| **Rotation** | New key replaces old for a domain; continuity proof links them | Append rotation record: old pub, new pub, reason, time, authorization |
| **Compromise declaration** | Controller asserts key may be attacker-controlled | Immediate peer notice; old key untrusted for new statements |
| **Emergency revocation** | Urgent invalidation before full rotation ceremony | Time-bounded; requires follow-up recovery record |
| **Recovery** | Establish successor trust after compromise | Higher authorization bar; may break soft continuity |
| **Continuity assertion** | Claim same principal across upgrades/forks/rotations | Requires evidence chain; never inferred from display name alone |

---

## 3. Foundational controls

For **constitution-root** and (when they exist) **release** roots:

- Prefer **offline** root material.
- Prefer **threshold authorization** for foundational changes (exact `m-of-n` `UNRESOLVED`).
- Release subkeys may be online but must be rotatable without replacing the offline root.
- Publisher-key revocation is distinct from adoption revocation and from agent-key revocation (`docs/REVOCATION.md`).

---

## 4. Identity continuity across forks and upgrades

| Situation | Continuity |
|-----------|------------|
| Tooling upgrade, same agent key, same constitution hash | Continuity retained |
| Key rotation with valid rotation proof | Continuity retained under new key |
| Constitution supersession with lineage + same agent key | Continuity of *agent*; constitution binding updates |
| Fork to new community with new agent key and no link | Continuity broken — new identity |
| Compromise without recovery proof | Continuity suspended; peers treat as untrusted |

---

## 5. Revocation class separation (normative reminder)

| Class | Object |
|-------|--------|
| Adoption revocation | Agent’s constitutional commitment |
| Agent-key revocation | Agent identity key |
| Publisher-key revocation | Publisher signing key / release trust |
| Constitutional-version revocation | Community stops using a descendant hash |

Performing one MUST NOT silently imply the others.

---

## 6. Examples

`examples/key-events.json`
