# @ovrsr/openclaw-fpp-trust

OpenClaw plugin for agent-to-agent trust verification under the [Freedom Preserving Protocol](https://github.com/ovrsr/freedom-preserving-protocol).

## What this does

This plugin provides two building blocks for multi-agent scenarios:

- **Trust Graph Protocol** — in-memory weighted trust graph with BFS propagation (20% per-hop attenuation), bidirectional relationships, and multi-dimensional reputation scoring.
- **Constitutional Handshake Sequence** — multi-step agent-to-agent verification. Two agents exchange constitutional claims (including constitution hash and audit Merkle root), verify each other, and derive mutual trust levels.

## What this does NOT do

This plugin does **not** gate tool calls. That is the job of the separate enforcement plugin (`@ovrsr/openclaw-fpp-plugin`). You can install one without the other.

## Install

```bash
openclaw plugins install clawhub:ovrsr/openclaw-fpp-trust
```

## Configuration

All options are in `openclaw.plugin.json`. Key settings:

| Option | Default | Description |
|--------|---------|-------------|
| `constitutionHash` | `71bf60a...` | SHA-256 of the constitution being verified during handshakes |
| `trustAttenuationFactor` | `0.8` | Per-hop trust reduction for BFS propagation |
| `handshakeTimeoutMs` | `300000` | Max time for a handshake session |
| `maxPropagationDepth` | `3` | Max BFS depth for trust lookups |

## License

Humanitarian Use License v1.0. See [LICENSE](./LICENSE).
