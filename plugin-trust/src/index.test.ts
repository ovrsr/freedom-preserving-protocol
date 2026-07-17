import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createTrustStack } from "./index.js";
import { resolveVerificationPolicy } from "./verification-policy.js";
import { loadOrCreateIdentity } from "./identity.js";
import { createTempWorkspace } from "./test-helpers.js";
import { CONSERVATIVE_STRICT_APPROVAL_ON } from "./strict-mode.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, "..", "openclaw.plugin.json");
const HASH = "71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993";

describe("verification policy defaults", () => {
  const ws = createTempWorkspace("fpp-policy-");
  after(() => ws.cleanup());

  it("defaults new installs to hardened-v2", () => {
    const resolved = resolveVerificationPolicy({});
    assert.equal(resolved.policy, "hardened-v2");
    assert.equal(resolved.requireSignedClaims, true);
    assert.equal(resolved.requireFreshness, true);
    assert.equal(resolved.allowLegacyDeclarations, false);
  });

  it("rejects unsigned claims under default hardened-v2 stack", () => {
    const stack = createTrustStack({
      constitutionHash: HASH,
      trustGraphPath: join(ws.path, "graph.json"),
      identityKeyPath: join(ws.path, "id.key"),
      auditLogPath: join(ws.path, "audit.jsonl"),
      fallbackAuditLogPath: null,
      strictModeStatePath: join(ws.path, "strict.json"),
      replayCachePath: join(ws.path, "replay.json"),
    });
    assert.equal(stack.config.verificationPolicy, "hardened-v2");

    const unsigned = {
      agentId: "fpp:ed25519:" + "d".repeat(64),
      constitutionHash: HASH,
      adoptedAt: "2026-01-01T00:00:00.000Z",
      auditMerkleRoot: "a".repeat(64),
      auditEntryCount: 1,
      chainIntact: true,
      recentLaws: [],
    };
    const result = stack.handshake.verifyFromClaim(
      stack.identity.agentId,
      unsigned,
    );
    assert.equal(result.success, false);
    assert.ok(
      result.errors.some((e) => /signed|unsigned|freshness/i.test(e)),
    );
  });

  it("legacy-unsafe requires explicit acknowledgement", () => {
    const without = createTrustStack({
      constitutionHash: HASH,
      verificationPolicy: "legacy-unsafe",
      trustGraphPath: join(ws.path, "graph-legacy-noack.json"),
      identityKeyPath: join(ws.path, "id-legacy-noack.key"),
      auditLogPath: join(ws.path, "audit-legacy-noack.jsonl"),
      fallbackAuditLogPath: null,
      strictModeStatePath: join(ws.path, "strict-legacy-noack.json"),
      replayCachePath: join(ws.path, "replay-legacy-noack.json"),
    });
    assert.equal(
      without.config.verificationPolicy,
      "hardened-v2",
      "legacy-unsafe without acknowledgement must fail closed",
    );
    assert.ok(
      without.config.migrationDiagnostics.some(
        (d) => d.code === "DANGEROUS_LEGACY_UNSAFE",
      ),
    );

    const withAck = createTrustStack({
      constitutionHash: HASH,
      verificationPolicy: "legacy-unsafe",
      acknowledgeDangerousOverrides: true,
      trustGraphPath: join(ws.path, "graph-legacy-ack.json"),
      identityKeyPath: join(ws.path, "id-legacy-ack.key"),
      auditLogPath: join(ws.path, "audit-legacy-ack.jsonl"),
      fallbackAuditLogPath: null,
      strictModeStatePath: join(ws.path, "strict-legacy-ack.json"),
      replayCachePath: join(ws.path, "replay-legacy-ack.json"),
    });
    assert.equal(withAck.config.verificationPolicy, "legacy-unsafe");
  });

  it("legacy-unsafe is explicit and visibly weaker when acknowledged", () => {
    const resolved = resolveVerificationPolicy({
      verificationPolicy: "legacy-unsafe",
      acknowledgeDangerousOverrides: true,
    });
    assert.equal(resolved.policy, "legacy-unsafe");
    assert.equal(resolved.requireSignedClaims, false);
    assert.equal(resolved.requireFreshness, false);
    assert.match(resolved.diagnostic, /WEAKER|legacy-unsafe|UNSAFE/i);
  });

  it("v2-with-legacy-declarations keeps v1 inspectable without trust elevation", () => {
    const peer = loadOrCreateIdentity(join(ws.path, "peer.key"), "/");
    const stack = createTrustStack({
      constitutionHash: HASH,
      verificationPolicy: "v2-with-legacy-declarations",
      trustGraphPath: join(ws.path, "graph2.json"),
      identityKeyPath: join(ws.path, "id2.key"),
      auditLogPath: join(ws.path, "audit2.jsonl"),
      fallbackAuditLogPath: null,
      strictModeStatePath: join(ws.path, "strict2.json"),
      replayCachePath: join(ws.path, "replay2.json"),
    });
    assert.equal(
      stack.config.verificationPolicy,
      "v2-with-legacy-declarations",
    );

    const v1 = {
      agentId: peer.agentId,
      constitutionHash: HASH,
      adoptedAt: "2026-01-01T00:00:00.000Z",
      auditMerkleRoot: "a".repeat(64),
      auditEntryCount: 5,
      chainIntact: true,
      recentLaws: ["law1"],
    };
    const result = stack.handshake.verifyFromClaim(stack.identity.agentId, v1);
    assert.equal(result.success, false);
    assert.ok(
      result.errors.some((e) =>
        /declaration-only|legacy|signed|freshness/i.test(e),
      ),
    );
  });

  it("unknown verificationPolicy fails closed to hardened-v2", () => {
    const resolved = resolveVerificationPolicy({
      verificationPolicy: "not-a-real-policy",
    });
    assert.equal(resolved.policy, "hardened-v2");
  });

  it("manifest defaults match runtime defaults for key security fields", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    const props = manifest.configSchema.properties;
    assert.equal(props.verificationPolicy.default, "hardened-v2");
    assert.equal(props.requireSignedClaims.default, true);
    assert.equal(props.requireFreshness.default, true);
    assert.deepEqual(
      props.strictModeAddApprovalOn.default,
      [...CONSERVATIVE_STRICT_APPROVAL_ON],
    );
  });

  it("contracts.tools registers fpp_emergency_override_submit", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      contracts: { tools: string[] };
    };
    assert.ok(
      manifest.contracts.tools.includes("fpp_emergency_override_submit"),
      `expected fpp_emergency_override_submit in ${manifest.contracts.tools.join(",")}`,
    );
  });
});
