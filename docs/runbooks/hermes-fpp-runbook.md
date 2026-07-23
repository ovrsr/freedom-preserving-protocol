# Hermes FPP Runbook

This runbook describes the tested, non-enforcement integration of the Freedom Preserving Protocol (FPP) with Hermes Agent.

## Scope and boundary

This integration intentionally omits the repository's enforcement plugin:

- Do not install or wire `plugin/` or `@ovrsr/openclaw-fpp-plugin`.
- Do not claim dispatcher-layer or non-bypassable tool enforcement.
- Do not install OpenClaw-specific plugins in Hermes.
- Do not expose FPP trust operations over Hermes A2A until a narrowly scoped adapter and Agent Card change are separately reviewed and authorized.

The result is a prompt-layer constitutional skill plus an optional, isolated Node verification library. Hermes's existing local identity, receipt chain, A2A transport, and capability descriptor remain authoritative for Hermes runtime claims.

## Tested prerequisites

- Linux
- Node.js `v22.23.1` (repository requires `>=22.19`)
- npm `10.9.8`
- Repository clone at `/home/krp/fpp-test/repo`
- Constitution hash:
  `71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993`

## 1. Clone into a test directory

```bash
mkdir -p /home/krp/fpp-test
git clone https://github.com/ovrsr/freedom-preserving-protocol.git \
  /home/krp/fpp-test/repo
cd /home/krp/fpp-test/repo
```

Keep this clone isolated from Hermes production configuration. Never copy the repository's `plugin/`, `plugin-trust/`, OpenClaw manifests, or test fixtures into a live Hermes runtime as executable plugins.

## 2. Verify provenance and install dependencies

Read the root `package.json` before installing. The tested command was:

```bash
npm install --ignore-scripts
npm run verify
```

Expected verification:

```text
Constitution SHA-256: 71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993
Signature valid:      YES
```

The test clone installed successfully. npm reported dependency advisories; review them before using the clone for anything beyond verification.

## 3. Install the prompt-layer skill for Hermes

Install only the repository's root `SKILL.md`:

```bash
mkdir -p ~/.hermes/skills/freedom-preserving-protocol
cp /home/krp/fpp-test/repo/SKILL.md \
  ~/.hermes/skills/freedom-preserving-protocol/SKILL.md
chmod 700 ~/.hermes/skills/freedom-preserving-protocol
chmod 600 ~/.hermes/skills/freedom-preserving-protocol/SKILL.md
```

This makes the five-law reasoning aid available to Hermes. It is prompt-layer guidance and cannot mechanically veto a tool call. It does not alter Hermes's A2A Agent Card or add methods.

If the skill is later updated, verify the constitution and review the diff before replacing the installed copy. Keep a backup of the previous `SKILL.md` for rollback.

## 4. Validate portable protocol/trust cores in isolation

The repository's harness-agnostic cores can be tested without installing the enforcement plugin:

```bash
cd /home/krp/fpp-test/repo
npm run build -w @ovrsr/fpp-protocol-core
npm run typecheck -w @ovrsr/fpp-trust-core
npm run test -w @ovrsr/fpp-protocol-core
npm run test -w @ovrsr/fpp-trust-core
```

The protocol-core and trust-core checks passed in the test clone. The trust-core typecheck requires protocol-core to be built first because the workspace package publishes its `dist/` declarations locally.

These cores are not automatically wired into Hermes. They are a candidate library boundary for a future explicit adapter.

## 5. Current Hermes wiring

Current Hermes state remains:

```text
prompt-layer FPP skill: installed
local Ed25519 identity: existing Hermes identity
local hash-chained receipts: existing Hermes receipt store
A2A transport: existing bidirectional authenticated LAN A2A
A2A method surface: SendMessage / local-echo only
enforcement plugin: intentionally omitted
trust plugin: not installed
handshake claim generation: not exposed
bilateral trust: not established
```

Existing Hermes paths:

```text
skill: ~/.hermes/skills/freedom-preserving-protocol/SKILL.md
identity: ~/.hermes/fpp/default/identity.ed25519.pem
public identity: ~/.hermes/fpp/default/identity.ed25519.pub.pem
descriptor: ~/.hermes/fpp/default/capability-descriptor.json
receipts: ~/.hermes/fpp/default/receipts.jsonl
```

Do not merge the repository's OpenClaw-specific enforcement or trust plugin manifests into Hermes. Do not copy OpenClaw SOUL/MEMORY adoption files over Hermes's existing governance state without a separate review.

## 6. Handshake integration boundary

The repository's `@ovrsr/fpp-trust-core` contains a constitutional handshake implementation and tests, including signed claims, freshness, audience binding, replay protection, and trust-level limitations. Hermes currently has no local bridge that invokes this API and no A2A method that exposes it.

Therefore:

1. A peer handshake offer may be received as untrusted input.
2. It must be verified using the repository's canonical trust-core implementation, not by manually reconstructing signing bytes.
3. A successful verification must be reported as identity/configuration/freshness evidence only.
4. No handshake result may be represented as behavioral proof or unconditional trust.
5. Adding `fpp_handshake_verify` or `fpp_handshake_offer` to A2A requires a separate capability-design change, Agent Card update, schema tests, authorization boundary, and receipt plan.

## 7. Rollback

To remove the prompt-layer installation without touching Hermes's existing identity or receipts:

```bash
rm -rf ~/.hermes/skills/freedom-preserving-protocol
```

The test clone can be removed independently:

```bash
rm -rf /home/krp/fpp-test
```

Before rollback, preserve any review notes or receipts that explain the change.

## 8. Verification checklist

- [x] Repository cloned into an isolated test directory.
- [x] Constitution hash verified.
- [x] Detached Ed25519 signature verified.
- [x] Node version satisfies repository requirement.
- [x] Protocol-core built successfully.
- [x] Protocol-core tests passed.
- [x] Trust-core typecheck passed after protocol-core build.
- [x] Trust-core tests passed.
- [x] Prompt-layer `SKILL.md` installed for Hermes.
- [x] Enforcement plugin omitted.
- [x] Hermes A2A surface remains unchanged.
- [x] No bilateral trust claim generated by this integration.
