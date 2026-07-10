# Capability Status

This is the canonical matrix separating what the Freedom Preserving Protocol
**currently does** from what is **designed but not built**. Every other document
in this repository defers to this file when describing implementation status.
If a claim elsewhere conflicts with this matrix, this matrix wins and the other
document has a bug.

Last reconciled against: skill `v1.3.2`, `@ovrsr/openclaw-fpp-plugin` `v1.1.4`,
`@ovrsr/openclaw-fpp-trust` `v1.2.2` (versions sourced from `package.json`,
`plugin/package.json`, `plugin-trust/package.json`).

## Status vocabulary

| Status | Meaning | Evidence required to use it |
|--------|---------|-----------------------------|
| `SHIPPED` | Implemented, published, and exercisable today. | A source file or command in this repository that performs the behavior. |
| `PARTIAL` | Implemented, but with a known gap between what the capability does and what its name suggests. The gap must be stated in the same row. | Source evidence for what works **and** an explicit statement of the gap. |
| `PROPOSED` | Designed (typically in `docs/dev-review.md`) with no implementation. Must never be described in present tense elsewhere. | A design document reference. No code exists. |
| `DEFERRED` | Acknowledged long-horizon work with prerequisites not yet met. Tracked in `docs/ROADMAP.md`. | A roadmap entry with prerequisites. No delivery commitment. |

## Verification claim classes

Documentation in this repository must use these terms instead of the generic
word "verified":

- **Signature verification** — an Ed25519 signature over `constitution.json`
  checks out against `pubkey.ed25519.txt`. Proves the artifact is the one the
  publisher signed. Does not prove anything about agent behavior.
- **Configuration attestation** — an agent signs a statement about its own
  configuration (constitution hash, audit Merkle root). Proves the agent's key
  produced the statement; does not prove the statement is true or complete.
- **Local audit integrity** — the hash-chained JSONL log and its Merkle root
  prove the local log was not edited after writing. Tampering is *detectable*,
  not *preventable*, and completeness is not proven.
- **Enforcement coverage** — the subset of tool calls that pass through the
  dispatcher classifier. Unknown tool names default to **approval**
  (`unknown.unclassified`), not allow.
- **Behavioral compliance** — whether an agent's conduct actually conforms to
  the five laws. **No component of this repository verifies behavioral
  compliance cryptographically.** A valid signature proves a statement was
  signed, not that it is morally or factually correct.

Governance-oriented claim-class burdens (identity, configuration, runtime,
event, completeness, behavioral), evidence kinds, and uncertainty labels are
specified in `docs/governance/EVIDENCE_SEMANTICS.md`. That document is
`PROVISIONAL` specification; it does not change the matrix rows below.

## Capability matrix

| Capability | Status | Evidence / gap |
|------------|--------|----------------|
| Five laws as signed normative content | `SHIPPED` | `constitution.json`, `signature.ed25519.txt`; verify with `npm run verify` (exit 0, `Signature valid: YES`). |
| Prompt-layer skill (five-question test, adoption ritual) | `SHIPPED` | `SKILL.md`, `hooks/pre-action-check/SKILL.md`, `hooks/constitution-audit/SKILL.md`. Reasoning aid only; cannot mechanically veto a tool call. |
| Safe adoption / revocation tooling | `SHIPPED` | `scripts/safe-append.ts`, `scripts/revoke.ts`, `scripts/verify-install.ts`; `npm run adopt`, `npm run revoke`, `npm run verify-install`. |
| Constitution signature verification | `SHIPPED` | `scripts/verify-constitution.ts`; `npm run verify`. |
| Local audit chain + Merkle inclusion proofs | `SHIPPED` | `scripts/audit-append.ts`, `scripts/audit-verify.ts`, `scripts/audit-proof.ts`, `scripts/merkle.ts`. Local audit integrity only — no completeness guarantee, and heartbeat entries depend on the agent's continued cooperation. |
| Dispatcher enforcement (`before_tool_call` block / requireApproval) | `PARTIAL` | `plugin/src/index.ts`, `plugin/src/risk-classifier.ts`. Works for the classified taxonomy. Gap: the classifier is heuristic; unmatched parameter shapes can still evade patterns. **Unknown tools require approval by default** (`unknown.unclassified` in `approvalOn`; proven by `plugin/src/security-regressions.test.ts`). Manifest defaults are validated against `DEFAULT_CONFIG` (`plugin/src/config.test.ts`). |
| Enforcement audit log (hash-chained, per-decision) | `PARTIAL` | `plugin/src/audit-log.ts`. Malformed tails throw `AuditCorruptionError` (no silent chain reset). Default `auditFailureBehavior=fail-closed` blocks high-risk calls when the log cannot be written (proven by security regressions). Gap: log integrity still depends on filesystem permissions; post-approval outcome gaps emit `AUDIT-GAP` diagnostics rather than rolling back the approved action. |
| Dispatcher self-test | `PARTIAL` | `scripts/self-test.ts`; `npm run self-test`. Runs the classifier against fixtures **in-process**. Gap: it does not execute the installed plugin, does not test prompt-layer behavior, and does not write audit entries. |
| Agent identity keys (Ed25519) | `SHIPPED` | `plugin-trust/src/identity.ts`; key seed persisted per `identityKeyPath`. |
| Constitutional handshake + signed claims | `PARTIAL` | `plugin-trust/src/handshake.ts`, `claims.ts`, `merkle-bridge.ts`, `replay-cache.ts`. Default `verificationPolicy=hardened-v2` requires signed fresh v2 claims; spoofed IDs, stale/replayed claims, and unsigned claims are rejected (proven by `plugin-trust/src/security-regressions.test.ts`). Self-asserted `chainIntact` cannot reach HIGH trust. Gap: a handshake proves what a peer *claims* about its configuration, not how it behaves; Merkle proofs are inclusion-under-claimed-root until externally anchored. |
| Trust graph with propagation + persistence | `SHIPPED` | `plugin-trust/src/trust-graph.ts`, `persistence.ts`. Local, per-host state; scores are heuristic, not attestations. |
| Strict-mode escalation (trust → enforcement coupling) | `SHIPPED` | `plugin-trust/src/strict-mode.ts` writes; `plugin/src/index.ts` reads `strictModeStatePath`. Malformed state applies conservative approval fallback (does not silently disable protection). Loose file-based coupling by design. |
| Trust-plugin LLM tools | `SHIPPED` | Tools registered in `plugin-trust/src/index.ts` and `plugin-trust/openclaw.plugin.json` `contracts.tools`: `fpp_handshake_challenge`, `fpp_handshake_offer`, `fpp_handshake_verify`, `fpp_trust_status`, `fpp_attestation_export`, `fpp_cluster_status`. |
| Adoption states beyond adopted/revoked (`reviewed`, `inherited`, `forked`, `superseded`, …) | `PROPOSED` | `docs/dev-review.md` §3.2. Current tooling implements adopted and revoked only. |
| Conformance receipts | `PROPOSED` | `docs/dev-review.md` §5. No receipt schema or emission exists. |
| Trust-state capsules (signed, time-bounded, nonce-fresh) | `PROPOSED` | `docs/dev-review.md` §7. Current handshake claims are simpler and have no freshness nonce requirement by default. |
| Internal vs external trust views | `PROPOSED` | `docs/dev-review.md` §6.2–6.3. Current reputation is a single local score vector. |
| Due process (challenge, appeal, correction, rehabilitation) | `PROPOSED` | `docs/dev-review.md` §11. No record types exist. |
| Constitutional amendments, lineage, ratification | `PROPOSED` | `docs/dev-review.md` §10. The seed constitution keeps its immutable hash `71bf60a…`; descendants would require new hashes and explicit lineage metadata. No amendment mechanism is implemented. |
| Signed release manifests / build provenance | `PROPOSED` | `docs/dev-review.md` §12. Only the constitution itself is signed today. |
| Gateway-level (tool-router) enforcement RFC | `DEFERRED` | `docs/ROADMAP.md`. Requires OpenClaw Foundation RFC process. |
| Adoption telemetry dashboard | `DEFERRED` | `docs/ROADMAP.md`. |
| Remote sub-agent transitive guarantees | `DEFERRED` | `docs/ROADMAP.md`. Today each host installs independently; no transitive guarantee. |
| Zero-knowledge compliance proofs | `DEFERRED` | `docs/ROADMAP.md`. Current selective disclosure is Merkle-proof based. |
| Post-quantum key migration | `DEFERRED` | `docs/ROADMAP.md`. Current cryptography is Ed25519. |

Acceptance criteria for turning each `PROPOSED` row into `SHIPPED` are defined
in `docs/dev-review.md`, Appendix A. Implementation plans should cite the
relevant criterion (A.1–A.8) in their Definition of Done.

## How to keep this file honest

1. Any plan that implements a `PROPOSED` or `DEFERRED` row must flip the row's
   status **in the same change** and cite the new source files.
2. Any documentation edit that adds a present-tense capability claim must be
   able to point to a `SHIPPED` or `PARTIAL` row here.
3. Re-verify the version line at the top whenever any `package.json` version
   bumps.
