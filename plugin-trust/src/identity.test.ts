import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadOrCreateIdentity } from "./identity.js";
import { createTempWorkspace } from "./test-helpers.js";

describe("identity", () => {
  const ws = createTempWorkspace("fpp-id-");
  after(() => ws.cleanup());

  it("reloads the same agentId from an existing key file", () => {
    const keyPath = join(ws.path, "agent.key");
    const a = loadOrCreateIdentity(keyPath, "/");
    const b = loadOrCreateIdentity(keyPath, "/");
    assert.equal(a.agentId, b.agentId);
    assert.equal(a.publicKeyHex, b.publicKeyHex);
    assert.match(a.agentId, /^fpp:ed25519:[0-9a-f]{64}$/);
    assert.match(a.legacyAlias, /^fpp-[0-9a-f]{16}$/);
    assert.equal(a.keyAlgorithm, "ed25519");
  });
});
