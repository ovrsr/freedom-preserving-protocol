import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadOrCreateIdentity } from "./identity.js";
import { TrustGraphProtocol } from "./trust-graph.js";
import { ConstitutionalHandshake } from "./handshake.js";
import { MerkleBridge } from "./merkle-bridge.js";
import { StrictModeManager } from "./strict-mode.js";
import { GroupContextManager } from "./group-context.js";
import { executeHandshakeOffer, executeTrustStatus } from "./tools.js";
import { createTempWorkspace } from "./test-helpers.js";

const HASH = "71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993";

describe("tools", () => {
  const ws = createTempWorkspace("fpp-tools-");
  after(() => ws.cleanup());

  it("executeHandshakeOffer and executeTrustStatus return structured results", () => {
    const identity = loadOrCreateIdentity(join(ws.path, "id.key"), "/");
    const trustGraph = new TrustGraphProtocol();
    trustGraph.addAgent(identity.agentId, HASH);
    const handshake = new ConstitutionalHandshake(trustGraph, HASH);
    const merkleBridge = new MerkleBridge(join(ws.path, "audit.jsonl"));
    const strictMode = new StrictModeManager(join(ws.path, "strict.json"));
    const groupContext = new GroupContextManager(trustGraph, identity.agentId);
    const deps = {
      identity,
      trustGraph,
      handshake,
      merkleBridge,
      strictMode,
      groupContext,
      constitutionHash: HASH,
      strictModeOnHandshakeFailure: false,
      strictModeTtlMs: 60_000,
    };
    const offer = executeHandshakeOffer({}, deps);
    assert.ok(offer.content[0]?.text);
    const status = executeTrustStatus({ targetAgentId: identity.agentId }, deps);
    assert.ok(status.content[0]?.text);
  });
});
