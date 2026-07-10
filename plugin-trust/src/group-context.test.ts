import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";
import { GroupContextManager } from "./group-context.js";

describe("GroupContextManager", () => {
  it("tracks membership and verified sharing", () => {
    const graph = new TrustGraphProtocol();
    graph.addAgent("local", "h");
    graph.addAgent("peer", "h");
    graph.establishTrust("local", "peer", TrustLevel.HIGH, TrustLevel.HIGH);
    const required: string[] = [];
    const mgr = new GroupContextManager(graph, "local", (c, a) => {
      required.push(`${c}:${a}`);
    });
    mgr.noteAgentJoined("cluster-1", "stranger");
    assert.ok(required.some((x) => x.includes("stranger")));
    mgr.noteAgentJoined("cluster-1", "peer");
    mgr.markVerified("cluster-1", "peer", TrustLevel.HIGH);
    const state = mgr.getClusterTrustState("cluster-1");
    assert.ok(state);
    assert.equal(state!.verifiedMembers >= 1, true);
    assert.equal(mgr.shouldShareWithCluster("cluster-1", 0), true);
  });
});
