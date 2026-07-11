# @ovrsr/openclaw-fpp-trust

OpenClaw plugin for agent-to-agent trust verification under the [Freedom Preserving Protocol](https://github.com/ovrsr/freedom-preserving-protocol).

## What this does

This plugin provides claim exchange and trust tracking for multi-agent scenarios. Be precise about the verification semantics: it performs **signature verification** (a claim was signed by a given key) and **configuration attestation checking** (what a peer claims about its constitution hash, audit Merkle root, and setup). It does **not** verify behavioral compliance — no handshake proves a peer actually behaves constitutionally. See `docs/CAPABILITY_STATUS.md` in the parent repository for the claim-class vocabulary.

Components:

- **Trust Graph Protocol** — directed, capability/context/time scoped assessments with policy-constrained BFS propagation, separate self/peer/propagated views, and local revisable policy (decay, severity floors, anti-washout). Signed v2 event ledger + snapshot cache; v1 graphs import as low-confidence legacy observations.
- **Due process** — append-only challenge/appeal/correction/remediation/rehabilitation records; evidence history is never deleted.
- **Key lifecycle** — signed rotation, revocation, recovery; forked identities cannot impersonate ancestors.
- **Constitutional Handshake Sequence** — multi-step agent-to-agent verification. Two agents exchange signed constitutional claims (including constitution hash, audit Merkle root, and Ed25519 signature), verify each other, and derive mutual trust levels.
- **LLM-Facing Tools** — handshake, scoped trust status, cluster status, advisory sensitivity share check, receipt/capsule tools, and quorum mandate propose/second/finalize.
- **CLI Surface** — `openclaw fpp-trust` for graph inspection, `steward-override` (scoped/expiring/audited), override review/revoke, quorum status/revoke, attestation export, claim verification, and strict-mode management. Unaudited `seed` is removed.
- **Peer / steward quorum mandates** — local-policy quorum that **issues** signed `StandingMandateV1` records for the enforcement plugin to consume (`authorization=quorum-mandate`). Quorum is **not** constitutional ratification and cannot mint affected-party/data-subject consent.- **Signed Claims** — Ed25519-signed constitutional claims that can't be spoofed by JSON override.
- **Merkle Audit Bridging** — agents exchange audit Merkle roots during handshakes and can request inclusion proofs to check that a claimed audit entry exists in the peer's log. An inclusion proof establishes that an entry was recorded — not that the log is complete, and not that the recorded conduct was compliant. On fresh installs, the bridge falls back to the enforcement plugin audit log until the constitution heartbeat log has entries.
- **Group Context Trust** — cluster-based trust for multi-agent chat environments with sensitivity-gated sharing.
- **Strict-Mode Signaling** — when a handshake fails, the plugin can signal the enforcement plugin to escalate low-risk tool calls to require-approval for that session.

## Tools

Tools registered in `src/index.ts` and declared in `openclaw.plugin.json` (`contracts.tools`):

| Tool | Description |
|------|-------------|
| `fpp_handshake_offer` | Generate this agent's signed constitutional claim for sharing with a peer |
| `fpp_handshake_verify` | Check a peer's claim (signature + configuration + freshness), report precise standing — **not** behavioral compliance |
| `fpp_trust_status` | Check scoped directed standing + self/peer view divergence for a known agent |
| `fpp_sensitivity_share_check` | **Advisory** check whether content at a sensitivity may be shared with a cluster |
| `fpp_attestation_export` | Export Merkle root, public key, and optional inclusion proofs |
| `fpp_cluster_status` | Report group-context (cluster) trust state for multi-agent chat environments |
| `fpp_mandate_propose` | Open a peer/steward quorum proposal for a scoped StandingMandateV1 (local policy — not ratification) |
| `fpp_mandate_second` | Cast or accept a signed quorum ballot |
| `fpp_mandate_finalize` | Finalize at threshold into a signed mandate written to the shared mandate store |

## CLI

```bash
openclaw fpp-trust list                              # print trust graph + scoped assessments
openclaw fpp-trust steward-override <agentId> <pubkey> <LOW|MEDIUM|HIGH> \
  --reason "..." --capability handshake --expires 2026-08-01T00:00:00.000Z
openclaw fpp-trust override-review
openclaw fpp-trust override-revoke <agentId> --capability handshake --reason "..."
# seed is deprecated and exits non-zero — use steward-override
openclaw fpp-trust quorum-status                     # list open/finalized quorum sessions
openclaw fpp-trust quorum-revoke-mandate <mandateId> --reason "..."
openclaw fpp-trust export                            # print signed attestation
openclaw fpp-trust verify <claim.json>               # verify a peer claim file
openclaw fpp-trust strict list                       # list strict-mode sessions
openclaw fpp-trust strict clear <key|all>            # clear strict sessions
```

## Strict-Mode Contract

When `strictModeOnHandshakeFailure` is enabled and a handshake fails or returns `TrustLevel.UNKNOWN`, the plugin writes a strict-mode entry to `strictModeStatePath` (default `.openclaw/workspace/fpp-strict-sessions.json`). The enforcement plugin (`@ovrsr/openclaw-fpp-plugin`) reads this file and escalates classifications listed in `strictModeAddApprovalOn` to `requireApproval` for that session.

The coupling is intentionally loose: the trust plugin only writes; the enforcement plugin only reads. Either can be installed alone.

## Install

```bash
openclaw plugins install clawhub:ovrsr/openclaw-fpp-trust
```

## Configuration

All options are in `openclaw.plugin.json`. Key settings:

| Option | Default | Description |
|--------|---------|-------------|
| `constitutionHash` | `71bf60a...` | SHA-256 of the constitution being verified |
| `trustAttenuationFactor` | `0.8` | Per-hop trust reduction for BFS propagation |
| `handshakeTimeoutMs` | `300000` | Max time for a handshake session |
| `maxPropagationDepth` | `3` | Max BFS depth for trust lookups |
| `trustGraphPath` | `.openclaw/.../fpp-trust-graph.json` | Persisted trust graph JSON |
| `identityKeyPath` | `.openclaw/.../fpp-agent-identity.key` | Ed25519 identity key seed (mode 0600) |
| `auditLogPath` | `.openclaw/.../constitution-audit.jsonl` | Constitution audit JSONL for Merkle bridging |
| `fallbackAuditLogPath` | `.openclaw/.../fpp-plugin-audit.jsonl` | Used when `auditLogPath` has no entries yet (enforcement plugin log). Set to `null` to disable. |
| `strictModeStatePath` | `.openclaw/.../fpp-strict-sessions.json` | Shared strict-mode state file |
| `replayCachePath` | `.openclaw/.../fpp-replay-cache.json` | Bounded challenge replay-key cache |
| `verificationPolicy` | `hardened-v2` | `hardened-v2` \| `v2-with-legacy-declarations` \| `legacy-unsafe` |
| `requireSignedClaims` | derived | Derived from `verificationPolicy` (deprecated as a standalone toggle) |
| `requireFreshness` | derived | Derived from `verificationPolicy` (deprecated as a standalone toggle) |
| `requireMerkleProof` | `false` | Require Merkle proof during handshake |
| `strictModeOnHandshakeFailure` | `false` | Enter strict mode on failed handshake |
| `strictModeTtlMs` | `3600000` | How long strict mode lasts |
| `strictModeAddApprovalOn` | `[fs.write.workspace, ...]` | Classifications escalated during strict mode |

## What this does NOT do

This plugin does **not** gate tool calls. That is the job of the separate enforcement plugin (`@ovrsr/openclaw-fpp-plugin`). You can install one without the other.

It also does **not** prove behavioral compliance. A successful handshake means: the peer produced a signed claim, the claimed constitution hash matched, freshness/replay checks passed (under hardened policy), and (optionally) a Merkle inclusion proof checked out. That is identity/configuration attestation — the peer's actual conduct is out of scope.

Tool and CLI outputs name exactly what was verified (`identityVerified`, `configurationClaimVerified`, `freshnessVerified`, `evidenceLevel`, `standing`). The legacy `fppVerified` boolean remains for one compatibility window as a **deprecated** field derived from `standing === "identity-configuration"` — never as proof of behavioral compliance. Prefer the precise fields.

## Limitations (read this)

1. **Default policy is hardened-v2.** New installs require signed, fresh, non-replayed claims. Explicitly set `verificationPolicy: "legacy-unsafe"` only for controlled migration; the plugin emits a prominent warning. `v2-with-legacy-declarations` keeps v1 inspectable as declaration-only without trust elevation.
2. **Trust state is local and per-host.** Assessments are scoped (capability/context/time) and policy-local. There is no global immutable score, no cross-host synchronization, and no automatic transitive guarantee.
3. **Challenge-response freshness is required under hardened-v2.** Use `fpp_handshake_challenge` → answer via `fpp_handshake_offer` (`peerChallenge`) → `fpp_handshake_verify` once. Replay keys are persisted in `replayCachePath`.
4. **Key lifecycle is signed.** Rotation requires the old key; compromise/revocation and steward-authorized recovery are explicit events. See `docs/governance/KEY_GOVERNANCE.md` and `docs/REVOCATION.md`.
5. **Sensitivity sharing checks are advisory** unless the OpenClaw host provides an authoritative interception hook.
6. **Partial Sybil resistance only.** Source-independence scoring reduces correlated inflation but does not detect coordinated identity clusters.

## Persistence

The plugin persists a **signed v2 snapshot** plus an append-only `.events.jsonl` ledger. Legacy v1 unsigned JSON remains loadable and migrates explicitly via `migrateV1ToV2` (source preserved as `.v1.bak`). Tampered v2 snapshots are rejected.

The Ed25519 identity key seed is persisted to `identityKeyPath` (32 bytes, mode `0600`). Generated on first run and reused thereafter.

## License

Humanitarian Use License v1.0. See [LICENSE](./LICENSE).
