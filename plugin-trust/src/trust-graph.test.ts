import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";

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
});
