# @ovrsr/openclaw-fpp-trust

OpenClaw plugin for agent-to-agent trust verification under the [Freedom Preserving Protocol](https://github.com/ovrsr/freedom-preserving-protocol).

## What this does

This plugin provides claim exchange and trust tracking for multi-agent scenarios. Be precise about the verification semantics: it performs **signature verification** (a claim was signed by a given key) and **configuration attestation checking** (what a peer claims about its constitution hash, audit Merkle root, and setup). It does **not** verify behavioral compliance — no handshake proves a peer actually behaves constitutionally. See `docs/CAPABILITY_STATUS.md` in the parent repository for the claim-class vocabulary.

Components:

- **Trust Graph Protocol** — weighted trust graph with BFS propagation (20% per-hop attenuation), bidirectional relationships, and multi-dimensional reputation scoring (constitutional fidelity, intervention rate, resource stewardship). Persisted to disk and reloaded after restarts.
- **Constitutional Handshake Sequence** — multi-step agent-to-agent verification. Two agents exchange signed constitutional claims (including constitution hash, audit Merkle root, and Ed25519 signature), verify each other, and derive mutual trust levels.
- **LLM-Facing Tools** — five tools registered in the agent's tool list for one-call handshakes, trust queries, and cluster status.
- **CLI Surface** — `openclaw fpp-trust` commands for graph inspection, manual seed management, attestation export, claim verification, and strict-mode management.
- **Signed Claims** — Ed25519-signed constitutional claims that can't be spoofed by JSON override.
- **Merkle Audit Bridging** — agents exchange audit Merkle roots during handshakes and can request inclusion proofs to check that a claimed audit entry exists in the peer's log. An inclusion proof establishes that an entry was recorded — not that the log is complete, and not that the recorded conduct was compliant. On fresh installs, the bridge falls back to the enforcement plugin audit log until the constitution heartbeat log has entries.
- **Group Context Trust** — cluster-based trust for multi-agent chat environments with sensitivity-gated sharing.
- **Strict-Mode Signaling** — when a handshake fails, the plugin can signal the enforcement plugin to escalate low-risk tool calls to require-approval for that session.

## Tools

All five tools below are registered in `src/index.ts` and declared in `openclaw.plugin.json` (`contracts.tools`):

| Tool | Description |
|------|-------------|
| `fpp_handshake_offer` | Generate this agent's signed constitutional claim for sharing with a peer |
| `fpp_handshake_verify` | Check a peer's claim (signature + configuration attestation), establish mutual trust, update the graph |
| `fpp_trust_status` | Check trust level and reputation of a known agent |
| `fpp_attestation_export` | Export Merkle root, public key, and optional inclusion proofs |
| `fpp_cluster_status` | Report group-context (cluster) trust state for multi-agent chat environments |

## CLI

```bash
openclaw fpp-trust list                              # print trust graph
openclaw fpp-trust seed <agentId> <pubkey> <level>   # add trusted seed
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
| `requireSignedClaims` | `false` | Reject unsigned claims during handshake |
| `requireMerkleProof` | `false` | Require Merkle proof during handshake |
| `strictModeOnHandshakeFailure` | `false` | Enter strict mode on failed handshake |
| `strictModeTtlMs` | `3600000` | How long strict mode lasts |
| `strictModeAddApprovalOn` | `[fs.write.workspace, ...]` | Classifications escalated during strict mode |

## What this does NOT do

This plugin does **not** gate tool calls. That is the job of the separate enforcement plugin (`@ovrsr/openclaw-fpp-plugin`). You can install one without the other.

It also does **not** prove behavioral compliance. A successful handshake means: the peer produced a claim (optionally signed), the claimed constitution hash matched, and (optionally) a Merkle inclusion proof checked out. That is signature verification plus configuration attestation — the peer's actual conduct is out of scope.

## Limitations (read this)

1. **Hardening flags are off by default.** `requireSignedClaims` and `requireMerkleProof` both default to `false`, so a default-config handshake accepts unsigned claims with no audit proof. Enable both for anything beyond experimentation.
2. **Trust state is local and per-host.** The trust graph, identity key, and strict-mode state live in this host's workspace files. There is no cross-host synchronization and no transitive guarantee: a peer trusted here is not automatically trusted by your other agents.
3. **Replay is possible.** Claims carry timestamps, but the current handshake has no peer-supplied freshness nonce and no default staleness rejection — a captured claim can be replayed. The `handshakeTimeoutMs` setting bounds the handshake *session*, not the claim's validity. (Nonce-fresh, time-bounded trust capsules are a proposed design — `docs/dev-review.md` §7.)
4. **Key lifecycle is manual.** The Ed25519 identity seed is generated on first run and reused indefinitely. There is no rotation schedule, no revocation registry, and no automated way to tell peers a key was compromised — see the revocation classes in `docs/REVOCATION.md`.
5. **No Sybil resistance.** Nothing prevents an operator from minting many agent identities and having them vouch for each other. Trust propagation attenuates per hop but does not detect coordinated identity clusters.

## Persistence

The plugin persists trust graph state to `trustGraphPath` as JSON with mode `0600` via an atomic temp-file rename. If the file does not exist, the plugin starts with an empty graph. If the file is malformed, startup fails rather than silently discarding trust state.

The Ed25519 identity key seed is persisted to `identityKeyPath` (32 bytes, mode `0600`). Generated on first run and reused thereafter.

## License

Humanitarian Use License v1.0. See [LICENSE](./LICENSE).
