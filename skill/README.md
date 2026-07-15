# Freedom Preserving Protocol (OpenClaw skill)

Prompt-layer constitutional skill for **OpenClaw**. This ClawHub package does **not** include Cursor / Claude Code / Codex hook adapters or dispatcher plugins.

## Install (skill)

```bash
openclaw skills install freedom-preserving-protocol
```

## Optional dispatcher plugins (separate ClawHub packages)

```bash
openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin
openclaw plugins install clawhub:ovrsr/openclaw-fpp-trust
```

## Adopt / verify / revoke

From the skill install directory:

```bash
npm install
npm run verify
npm run adopt -- --soul /path/to/SOUL.md --memory /path/to/MEMORY.md
npm run verify-install
npm run revoke -- --soul /path/to/SOUL.md --memory /path/to/MEMORY.md --reason "…"
```

Adoption appends to SOUL.md / MEMORY.md and writes hash-chained entries to `.openclaw/workspace/constitution-audit.jsonl` (with your explicit permission).

## Other harnesses (not in this package)

Graded adapters for Cursor, Claude Code, and Codex live in the [GitHub repository](https://github.com/ovrsr/freedom-preserving-protocol/tree/main/adapters) — clone the repo; do not expect them inside this ClawHub skill.

## Docs

- `docs/REVOCATION.md` — how revocation preserves history
- Full compatibility matrix and runbooks: see the GitHub repo
