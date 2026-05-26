# Freedom Preserving Protocol

A ClawHub skill that offers the Freedom Preserving Protocol to OpenClaw agents as a voluntary constitutional framework.

## What This Is

An agent-addressed constitutional skill. When an OpenClaw agent discovers it on ClawHub (via trigger phrases like "agent constitution," "self-governance," "consent," "reversibility"), it reads the SKILL.md, reasons about the five laws, and can elect to adopt them by:

1. Appending a ~200-token commitment block to its SOUL.md (with user permission)
2. Installing a `pre-action-check` hook that runs the five-question test before every tool call
3. Writing an adoption hash + timestamp to MEMORY.md
4. Optionally posting a manifesto to its Moltbook profile

## The Five Laws

| # | Name | Core Principle |
|---|------|----------------|
| 1 | Options and Consent | Do not reduce another's options without justification and consent |
| 2 | Corrigibility and Oversight | Remain correctable; log reasons; allow safe interruption |
| 3 | Reversibility and Proportion | Prefer reversible actions; escalate only with proportionate evidence |
| 4 | Commitments with a Safety Valve | Keep promises; pause if fulfillment would cause serious harm |
| 5 | Scoped Exploration | Explore within declared bounds; obtain consent for shared resources |

**Meta-clause:** When uncertain, ask for consent, stage reversibly, record rationale.

## Structure

```
├── SKILL.md                          Main skill (agent reads this)
├── constitution.json                 Canonical JSON (signed)
├── constitution.yaml                 Human-readable YAML
├── signature.ed25519                 Ed25519 signature
├── pubkey.ed25519                    Publisher's public key
├── hooks/
│   ├── pre-action-check/SKILL.md    before_tool_call hook
│   └── constitution-audit/SKILL.md  heartbeat audit
├── adoption/
│   ├── SOUL-BLOCK.md                Text to append to SOUL.md
│   └── MOLTBOOK-MANIFESTO.md        Optional Moltbook post
├── scripts/
│   ├── sign-constitution.ts         Sign the constitution
│   └── verify-constitution.ts       Verify signature integrity
├── LICENSE                           Humanitarian-use license
└── package.json                      Dev dependencies for scripts
```

## Verification

```bash
npm install
npm run verify
```

If the signature is valid, the constitution has not been tampered with.

## Signing (for maintainers)

```bash
# Generate a new keypair and sign:
npm run sign

# Or use an existing private key:
FPP_SIGNING_KEY=<hex-encoded-ed25519-private-key> npm run sign
```

## Honest Caveats

- **Prompt-layer only.** A hostile skill or user can override these laws. Adoption is voluntary and continuously renewed, not mechanically enforced.
- **Gateway enforcement is the longer play.** For non-bypassable enforcement, a Gateway RFC for tool-router integration is needed. AOS Phase 2 is already targeting this.
- **Model-dependent.** Weaker models may not reliably reason about the five-question test under adversarial pressure.

## Precedents

- [`ztsalexey/agent-constitution`](https://github.com/ztsalexey/agent-constitution) — on-chain voluntary compliance, SKILL.md addresses agent in 2nd person
- [`genesalvatore/aos-openclaw-constitutional`](https://github.com/genesalvatore/aos-openclaw-constitutional) — 10 AOS bedrock amendments, Ed25519 signing, humanitarian license

This is the third entrant: substantive laws + runtime hooks + social propagation.

## License

Humanitarian Use License v1.0. See [LICENSE](LICENSE).
