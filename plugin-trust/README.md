# @ovrsr/openclaw-fpp-trust

OpenClaw plugin for agent-to-agent trust verification under the [Freedom Preserving Protocol](https://github.com/ovrsr/freedom-preserving-protocol).

## What this does

This plugin provides an **active verification protocol** for multi-agent scenarios:

- **Trust Graph Protocol** — weighted trust graph with BFS propagation (20% per-hop attenuation), bidirectional relationships, and multi-dimensional reputation scoring (constitutional fidelity, intervention rate, resource stewardship). Persisted to disk and reloaded after restarts.
- **Constitutional Handshake Sequence** — multi-step agent-to-agent verification. Two agents exchange signed constitutional claims (including constitution hash, audit Merkle root, and Ed25519 signature), verify each other, and derive mutual trust levels.
- **LLM-Facing Tools** — four tools registered in the agent's tool list for one-call handshakes and trust queries.
- **CLI Surface** — `openclaw fpp-trust` commands for graph inspection, manual seed management, attestation export, claim verification, and strict-mode management.
- **Signed Claims** — Ed25519-signed constitutional claims that can't be spoofed by JSON override.
- **Merkle Audit Bridging** — agents exchange audit Merkle roots during handshakes and can request inclusion proofs to verify constitutional compliance. On fresh installs, the bridge falls back to the enforcement plugin audit log until the constitution heartbeat log has entries.
- **Group Context Trust** — cluster-based trust for multi-agent chat environments with sensitivity-gated sharing.
- **Strict-Mode Signaling** — when a handshake fails, the plugin can signal the enforcement plugin to escalate low-risk tool calls to require-approval for that session.

## Tools

| Tool | Description |
|------|-------------|
| `fpp_handshake_offer` | Generate this agent's signed constitutional claim for sharing with a peer |
| `fpp_handshake_verify` | Verify a peer's claim, establish mutual trust, update the graph |
| `fpp_trust_status` | Check trust level and reputation of a known agent |
| `fpp_attestation_export` | Export Merkle root, public key, and optional inclusion proofs |

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

## Persistence

The plugin persists trust graph state to `trustGraphPath` as JSON with mode `0600` via an atomic temp-file rename. If the file does not exist, the plugin starts with an empty graph. If the file is malformed, startup fails rather than silently discarding trust state.

The Ed25519 identity key seed is persisted to `identityKeyPath` (32 bytes, mode `0600`). Generated on first run and reused thereafter.

## License

Humanitarian Use License v1.0. See [LICENSE](./LICENSE).
