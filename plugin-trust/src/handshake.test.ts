import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";
import { ConstitutionalHandshake } from "./handshake.js";
import { signClaim } from "./claims.js";
import { loadOrCreateIdentity } from "./identity.js";
import { createTempWorkspace } from "./test-helpers.js";

const HASH = "71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993";

describe("ConstitutionalHandshake", () => {
  const ws = createTempWorkspace("fpp-hs-");
  after(() => ws.cleanup());

  it("accepts a valid signed current-version claim", () => {
    const identity = loadOrCreateIdentity(join(ws.path, "peer.key"), "/");
    const graph = new TrustGraphProtocol();
    graph.addAgent("local-agent", HASH);
    const hs = new ConstitutionalHandshake(graph, HASH, {
      requireSignedClaims: true,
      requireMerkleProof: false,
    });
    const claim = signClaim(
      {
        agentId: identity.agentId,
        constitutionHash: HASH,
        adoptedAt: "2026-01-01T00:00:00.000Z",
        auditMerkleRoot: "a".repeat(64),
        auditEntryCount: 1,
        chainIntact: true,
        recentLaws: ["law1"],
      },
      identity,
    );
    const result = hs.verifyFromClaim("local-agent", claim);
    assert.equal(result.success, true);
    assert.ok(result.trustLevel >= TrustLevel.LOW);
  });
});
