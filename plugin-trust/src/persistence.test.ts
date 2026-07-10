import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";
import { loadTrustGraph, saveTrustGraph, saveTrustGraphSync } from "./persistence.js";
import { createTempWorkspace } from "./test-helpers.js";

describe("persistence", () => {
  const ws = createTempWorkspace("fpp-persist-");
  after(() => ws.cleanup());

  it("atomically saves and reloads a graph", async () => {
    const path = "graph.json";
    const g = new TrustGraphProtocol();
    g.addAgent("a", "hash");
    g.addAgent("b", "hash");
    g.establishTrust("a", "b", TrustLevel.MEDIUM, TrustLevel.MEDIUM);
    await saveTrustGraph(path, g, ws.path);
    assert.ok(existsSync(join(ws.path, path)));
    const body = readFileSync(join(ws.path, path), "utf8");
    assert.ok(!body.includes(".tmp-"));
    const loaded = loadTrustGraph(path, ws.path);
    assert.ok(loaded.getRelationship("a", "b"));
    saveTrustGraphSync(path, loaded, ws.path);
    assert.ok(existsSync(join(ws.path, path)));
  });
});
