# Capability Status

This is the canonical matrix separating what the Freedom Preserving Protocol
**currently does** from what is **designed but not built**. Every other document
in this repository defers to this file when describing implementation status.
If a claim elsewhere conflicts with this matrix, this matrix wins and the other
document has a bug.

Last reconciled against: skill `v1.3.2`, `@ovrsr/fpp-protocol-core` `v1.0.0`,
`@ovrsr/fpp-enforcement-core` `v1.0.0`, `@ovrsr/fpp-trust-core` `v1.0.0`,
`@ovrsr/openclaw-fpp-plugin` `v1.1.4`, `@ovrsr/openclaw-fpp-trust` `v1.2.2`
(versions sourced from root / `packages/*/package.json` / plugin package.json files).

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
| Protocol contract library (`@ovrsr/fpp-protocol-core`) | `SHIPPED` | `packages/protocol-core/` — schemas, canonicalize, Merkle, claims, workspace profiles (`FPP_WORKSPACE`). Exact-pin dependency for plugins and cores. |
| Enforcement library core (`@ovrsr/fpp-enforcement-core`) | `SHIPPED` | `packages/enforcement-core/` — `classifyToolCall`, `resolveDisposition`, mandate/receipt/audit helpers, `FppRuntimeAdapter`. No `openclaw` dependency. OpenClaw plugin is a thin adapter. |
| Trust library core (`@ovrsr/fpp-trust-core`) | `SHIPPED` | `packages/trust-core/` — `createTrustStack`, trust graph, handshake, quorum, disputes, capsules. No `openclaw` dependency. OpenClaw trust plugin is a thin adapter. |
| Harness-agnostic workspace profiles | `SHIPPED` | `packages/protocol-core/src/workspace-profile.ts`; profiles `openclaw`, `generic`, `cursor`, `claude-code`, `codex`; `verify-install --profile …`. |
| Pluggable verify-install runtime probes | `SHIPPED` | `scripts/verify-install.ts` `RuntimeProbe` + `defaultProbesForProfile`; OpenClaw plugin probe and Cursor/Claude/Codex adapter-package probes. Unknown profiles warn (no false dispatcher PASS). |
| Cross-harness adapters (Cursor / Claude Code / Codex) | `PARTIAL` | `adapters/cursor`, `adapters/claude-code`, `adapters/codex` implement `FppRuntimeAdapter` via native PreToolUse-style hooks; shared `@ovrsr/fpp-tool-proxy`. Gap: graded coverage (Codex apply_patch/MCP; operator can disable hooks); not gateway-non-bypassable (Plan 12). |
| Prompt-layer skill (five-question test, adoption ritual) | `SHIPPED` | `SKILL.md`, `hooks/pre-action-check/SKILL.md`, `hooks/constitution-audit/SKILL.md`. Reasoning aid only; cannot mechanically veto a tool call. |
| Safe adoption / revocation tooling | `SHIPPED` | `scripts/safe-append.ts`, `scripts/revoke.ts`, `scripts/verify-install.ts`; `npm run adopt`, `npm run revoke`, `npm run verify-install`. |
| Constitution signature verification | `SHIPPED` | `scripts/verify-constitution.ts`; `npm run verify`. |
| Local audit chain + Merkle inclusion proofs | `SHIPPED` | `scripts/audit-append.ts`, `scripts/audit-verify.ts`, `scripts/audit-proof.ts`, `scripts/merkle.ts`. Local audit integrity only — no completeness guarantee, and heartbeat entries depend on the agent's continued cooperation. |
| Dispatcher enforcement (`before_tool_call` block / requireApproval) | `PARTIAL` | `plugin/src/index.ts`, `plugin/src/risk-classifier.ts`, `plugin/src/disposition-engine.ts`. Works for the classified taxonomy. Gap: the classifier is heuristic; unmatched parameter shapes can still evade patterns. **Operator-present mode:** unknown tools require approval (`unknown.unclassified` in `approvalOn`). **Unattended mode:** unknown/ungated tools **abstain** (block with `abstain:` reason) instead of hanging on `requireApproval`. |
| Unattended disposition + standing mandates | `PARTIAL` | `packages/enforcement-core` + OpenClaw/`adapters/*`. Flow: hard-floor → mandate/standing-allow → staged → quorum-mandate → emergency → abstain. Gap: harness hook coverage is graded outside OpenClaw; seed constitution hash unchanged (`71bf60ad…`). |
| Peer / steward quorum mandate issuance | `SHIPPED` | `plugin-trust/src/quorum-session.ts`, `quorum-policy.ts`, tools `fpp_mandate_propose` / `fpp_mandate_second` / `fpp_mandate_finalize`, CLI `quorum-status` / `quorum-revoke-mandate`. Quorum **issues** `StandingMandateV1` (authorization `quorum-mandate`) — it does **not** call allow directly and is **not** constitutional ratification. Forbidden consent scopes rejected at finalize. Sybil floor is local eligible-ID + key-lifecycle policy only (no full ratification tallies). |
| Enforcement audit log (hash-chained, per-decision) | `PARTIAL` | `plugin/src/audit-log.ts`. Malformed tails throw `AuditCorruptionError` (no silent chain reset). Default `auditFailureBehavior=fail-closed` blocks high-risk calls when the log cannot be written (proven by security regressions). Gap: log integrity still depends on filesystem permissions; post-approval outcome gaps emit `AUDIT-GAP` diagnostics rather than rolling back the approved action. |
| Dispatcher self-test | `PARTIAL` | `scripts/self-test.ts`; `npm run self-test`. Runs the classifier against fixtures **in-process**. Gap: it does not execute the installed plugin, does not test prompt-layer behavior, and does not write audit entries. |
| Agent identity keys (Ed25519) | `SHIPPED` | `plugin-trust/src/identity.ts`; key seed persisted per `identityKeyPath`. |
| Constitutional handshake + signed claims | `PARTIAL` | `plugin-trust/src/handshake.ts`, `claims.ts`, `merkle-bridge.ts`, `replay-cache.ts`. Default `verificationPolicy=hardened-v2` requires signed fresh v2 claims; spoofed IDs, stale/replayed claims, and unsigned claims are rejected (proven by `plugin-trust/src/security-regressions.test.ts`). Self-asserted `chainIntact` cannot reach HIGH trust. Gap: a handshake proves what a peer *claims* about its configuration, not how it behaves; Merkle proofs are inclusion-under-claimed-root until externally anchored. |
| Trust graph with propagation + persistence | `SHIPPED` | `plugin-trust/src/trust-graph.ts`, `persistence.ts`. Local, per-host state; scores are heuristic, not attestations. |
| Strict-mode escalation (trust → enforcement coupling) | `SHIPPED` | `plugin-trust/src/strict-mode.ts` writes; `plugin/src/index.ts` reads `strictModeStatePath`. Malformed state applies conservative approval fallback (does not silently disable protection). Loose file-based coupling by design. |
| Trust-plugin LLM tools | `SHIPPED` | Tools registered in `plugin-trust/src/index.ts` and `plugin-trust/openclaw.plugin.json` `contracts.tools`: `fpp_handshake_challenge`, `fpp_handshake_offer`, `fpp_handshake_verify`, `fpp_trust_status`, `fpp_attestation_export`, `fpp_cluster_status`, `fpp_receipt_verify`, `fpp_receipt_proof`, `fpp_capsule_offer`, `fpp_mandate_propose`, `fpp_mandate_second`, `fpp_mandate_finalize`. |
| Adoption states beyond adopted/revoked (`reviewed`, `inherited`, `forked`, `superseded`, …) | `PARTIAL` | `scripts/adoption-state.ts` append-only ledger; `npm run adopt` / `npm run revoke` update machine-readable states. Gap: verify-install UX still emphasizes human MEMORY/SOUL markers; overlay flags not automated. |
| Conformance receipts | `PARTIAL` | `plugin/src/receipt-store.ts`, `receipt-signer.ts`, `receipt-log.ts`, `after_tool_call` correlation. Signed, chained, selectively provable. Gap: receipts prove instrumented-boundary observations only — not completeness or behavioral compliance (`test/conformance-receipt-e2e.test.ts`). |
| Trust-state capsules (signed, time-bounded, nonce-fresh) | `PARTIAL` | `plugin-trust/src/capsule.ts`, `fpp_capsule_offer`. Fresh challenge-bound capsules with evidence/receipt roots and coverage. Gap: legacy claim path still available for migration; capsules do not prove completeness. |
| Internal vs external trust views | `SHIPPED` | `plugin-trust/src/trust-views.ts` — self / direct-peer / propagated views with explicit divergence; no global intrinsic score. |
| Contextual scoped trust | `SHIPPED` | `trust-scope.ts`, `trust-policy.ts`, `evidence-quality.ts` — Trust(A→B, capability, context, time); local policy only. |
| Signed trust persistence v2 | `SHIPPED` | `trust-events.ts` + `persistence.ts` — signed event ledger; v1 import as low-confidence legacy observations (`.v1.bak` preserved). |
| Due process (challenge, appeal, correction, rehabilitation) | `SHIPPED` | `plugin-trust/src/disputes.ts` — append-only records; originals never rewritten. |
| Key rotation / revocation | `SHIPPED` | `plugin-trust/src/key-lifecycle.ts` — signed rotation/revocation/recovery; forks cannot impersonate ancestors. |
| Steward overrides | `SHIPPED` | CLI `steward-override` (scoped, expiring, audited); unaudited `seed` deprecated. |
| Constitutional amendments, lineage, ratification | `PROPOSED` | `docs/dev-review.md` §10. The seed constitution keeps its immutable hash `71bf60a…`; descendants would require new hashes and explicit lineage metadata. No amendment mechanism is implemented. |
| Signed release manifests / build provenance | `PARTIAL` | `scripts/release-manifest.ts`, `scripts/release-manifest-verify.ts`, `npm run release:verify`. Release signing domain separated from constitution/agent keys. Gap: publish automation still optional until offline custody prerequisites in `KEY_GOVERNANCE.md` are met. |
| Gateway-level (tool-router) enforcement RFC | `PROPOSED` (draft) / `DEFERRED` (upstream) | In-repo draft: `docs/rfc/0001-voluntary-constitutional-layer.md` + `docs/rfc/SUBMISSION.md`. Draft informed by Plans 8–11. Upstream merge / Foundation intake still `DEFERRED` per `docs/ROADMAP.md` §1 — not `SHIPPED`. |
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
