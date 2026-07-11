import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";
import { loadOrCreateIdentity } from "./identity.js";
import { createTempWorkspace } from "./test-helpers.js";

describe("TrustGraphProtocol", () => {
  it("export/import round-trips relationships", () => {
    const g = new TrustGraphProtocol();
    g.addAgent("a", "h1");
    g.addAgent("b", "h1");
    g.establishTrust("a", "b", TrustLevel.HIGH, TrustLevel.MEDIUM);
    const data = g.exportData();
    const g2 = new TrustGraphProtocol();
    g2.importData(data);
    const rel = g2.getRelationship("a", "b");
    assert.ok(rel);
    assert.equal(rel!.trustAB, TrustLevel.HIGH);
    assert.equal(rel!.trustBA, TrustLevel.MEDIUM);
    const stats = g2.getStats();
    assert.equal(stats.nodeCount, 2);
  });

  it("rejects public-key replacement without a rotation proof", () => {
    const g = new TrustGraphProtocol();
    const agentId = "fpp:ed25519:" + "1".repeat(64);
    g.addAgent(agentId, "h1");
    assert.equal(g.updateAgentPublicKey(agentId, "aa".repeat(32)), true);
    assert.equal(
      g.updateAgentPublicKey(agentId, "bb".repeat(32)),
      false,
      "second key must be rejected without rotation proof",
    );
    assert.equal(g.getAgent(agentId)?.publicKeyHex, "aa".repeat(32));
  });

  it("allows public-key replacement when rotation proof is present", () => {
    const g = new TrustGraphProtocol();
    const agentId = "fpp:ed25519:" + "2".repeat(64);
    g.addAgent(agentId, "h1");
    assert.equal(g.updateAgentPublicKey(agentId, "aa".repeat(32)), true);
    assert.equal(
      g.updateAgentPublicKey(agentId, "bb".repeat(32), {
        rotationProof: { kind: "operator-attested", reason: "test-rotation" },
      }),
      true,
    );
    assert.equal(g.getAgent(agentId)?.publicKeyHex, "bb".repeat(32));
  });

  it("stores legacy aliases separately and does not let them replace canonical id", () => {
    const ws = createTempWorkspace("fpp-tg-id-");
    try {
      const identity = loadOrCreateIdentity(join(ws.path, "agent.key"), "/");
      const g = new TrustGraphProtocol();
      g.addAgent(identity.agentId, "h1");
      g.updateAgentPublicKey(identity.agentId, identity.publicKeyHex);
      g.addLegacyAlias(identity.agentId, identity.legacyAlias);

      const byCanonical = g.getAgent(identity.agentId);
      assert.ok(byCanonical);
      assert.deepEqual(byCanonical!.legacyAliases, [identity.legacyAlias]);
      assert.equal(g.getAgent(identity.legacyAlias), null);
      assert.equal(
        g.resolveCanonicalId(identity.legacyAlias),
        identity.agentId,
      );
    } finally {
      ws.cleanup();
    }
  });

  it("does not inflate relationship confidence from evidence count alone", () => {
    const g = new TrustGraphProtocol();
    g.addAgent("a", "h1");
    g.addAgent("b", "h1");
    const many = Array.from({ length: 10 }, (_, i) => ({
      type: "handshake" as const,
      data: { i, evidenceClass: "configuration" as const },
      weight: 0.3,
      timestamp: Date.now(),
      source: "test",
      evidenceClass: "configuration" as const,
    }));
    const rel = g.establishTrust("a", "b", TrustLevel.MEDIUM, TrustLevel.MEDIUM, many);
    assert.ok(rel);
    assert.ok(
      rel!.confidence <= 0.6,
      `count inflation should be capped, got ${rel!.confidence}`,
    );
  });

  it("uses directed edge levels and does not misuse reverse trust", () => {
    const g = new TrustGraphProtocol();
    g.addAgent("a", "h");
    g.addAgent("b", "h");
    g.addAgent("c", "h");
    // a→b HIGH, b→a LOW; b→c MEDIUM, c→b UNKNOWN-ish via LOW
    g.establishTrust("a", "b", TrustLevel.HIGH, TrustLevel.LOW);
    g.establishTrust("b", "c", TrustLevel.MEDIUM, TrustLevel.LOW);
    const prop = g.propagateTrust("a", "c", 3);
    assert.ok(prop);
    assert.ok(prop!.path.includes("b"));
    assert.ok(prop!.deductions.some((d) => d.includes("a→b")));
    // Should follow a→b (HIGH) then b→c (MEDIUM), not reverse edges
    assert.ok(prop!.trustLevel <= TrustLevel.MEDIUM);
  });

  it("bounds depth and applies propagated evidence ceiling", () => {
    const g = new TrustGraphProtocol({
      propagationPolicy: { maxDepth: 1, evidenceClassCeiling: 0.4 },
    });
    g.addAgent("a", "h");
    g.addAgent("b", "h");
    g.addAgent("c", "h");
    g.establishTrust("a", "b", TrustLevel.HIGH, TrustLevel.HIGH);
    g.establishTrust("b", "c", TrustLevel.HIGH, TrustLevel.HIGH);
    assert.equal(g.propagateTrust("a", "c"), null);
    g.setPropagationPolicy({ maxDepth: 3 });
    const prop = g.propagateTrust("a", "c");
    assert.ok(prop);
    assert.ok(prop!.confidence <= 0.4);
    assert.equal(prop!.evidenceClass, "propagated");
  });

  it("gives direct evidence precedence over propagation", () => {
    const g = new TrustGraphProtocol();
    g.addAgent("a", "h");
    g.addAgent("b", "h");
    g.addAgent("c", "h");
    g.establishTrust("a", "c", TrustLevel.LOW, TrustLevel.LOW);
    g.establishTrust("a", "b", TrustLevel.HIGH, TrustLevel.HIGH);
    g.establishTrust("b", "c", TrustLevel.HIGH, TrustLevel.HIGH);
    const prop = g.propagateTrust("a", "c");
    assert.ok(prop);
    assert.equal(prop!.directPrecedenceApplied, true);
    assert.equal(prop!.trustLevel, TrustLevel.LOW);
  });
});
