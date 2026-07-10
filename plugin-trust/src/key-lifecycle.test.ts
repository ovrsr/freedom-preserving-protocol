/**
 * Key lifecycle: rotation, revocation, recovery, fork detection.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createTempWorkspace } from "./test-helpers.js";
import { loadOrCreateIdentity } from "./identity.js";
import {
  KeyLifecycleLedger,
  applyRotation,
  applyRevocation,
  applyRecovery,
  isKeyValidAt,
  evidenceAffectedByCompromise,
} from "./key-lifecycle.js";
import { TrustGraphProtocol } from "./trust-graph.js";

describe("key-lifecycle", () => {
  const ws = createTempWorkspace("fpp-key-life-");
  after(() => ws.cleanup());

  it("rejects unauthorized public-key overwrite", () => {
    const oldId = loadOrCreateIdentity("old.key", ws.path);
    const g = new TrustGraphProtocol();
    g.addAgent(oldId.agentId, "h");
    g.updateAgentPublicKey(oldId.agentId, oldId.publicKeyHex);
    const ledger = new KeyLifecycleLedger();
    assert.equal(
      applyRotation(g, ledger, {
        agentId: oldId.agentId,
        oldPublicKeyHex: oldId.publicKeyHex,
        newPublicKeyHex: "bb".repeat(32),
        reason: "rotate",
        atMs: 1000,
        // missing signer / authorization
      }),
      false,
    );
    assert.equal(g.getAgent(oldId.agentId)?.publicKeyHex, oldId.publicKeyHex);
  });

  it("accepts valid old-key signed rotation and preserves history", () => {
    const oldId = loadOrCreateIdentity("rot-old.key", ws.path);
    const newId = loadOrCreateIdentity("rot-new.key", ws.path);
    const g = new TrustGraphProtocol();
    g.addAgent(oldId.agentId, "h");
    g.updateAgentPublicKey(oldId.agentId, oldId.publicKeyHex);
    const ledger = new KeyLifecycleLedger();
    const ok = applyRotation(g, ledger, {
      agentId: oldId.agentId,
      oldPublicKeyHex: oldId.publicKeyHex,
      newPublicKeyHex: newId.publicKeyHex,
      reason: "scheduled-rotation",
      atMs: 2000,
      signer: oldId,
    });
    assert.equal(ok, true);
    assert.equal(g.getAgent(oldId.agentId)?.publicKeyHex, newId.publicKeyHex);
    const hist = ledger.historyFor(oldId.agentId);
    assert.ok(hist.some((e) => e.kind === "rotation"));
    assert.equal(isKeyValidAt(ledger, oldId.publicKeyHex, 1500), true);
    assert.equal(isKeyValidAt(ledger, oldId.publicKeyHex, 2500), false);
    assert.equal(isKeyValidAt(ledger, newId.publicKeyHex, 2500), true);
  });

  it("compromise revocation affects evidence after compromise time", () => {
    const id = loadOrCreateIdentity("comp.key", ws.path);
    const ledger = new KeyLifecycleLedger();
    applyRevocation(ledger, {
      agentId: id.agentId,
      publicKeyHex: id.publicKeyHex,
      reason: "compromise",
      compromisedAtMs: 5000,
      signer: id,
    });
    assert.equal(
      evidenceAffectedByCompromise(ledger, id.publicKeyHex, 4000),
      false,
    );
    assert.equal(
      evidenceAffectedByCompromise(ledger, id.publicKeyHex, 6000),
      true,
    );
  });

  it("emergency recovery requires steward authorization", () => {
    const id = loadOrCreateIdentity("rec.key", ws.path);
    const steward = loadOrCreateIdentity("steward.key", ws.path);
    const g = new TrustGraphProtocol();
    g.addAgent(id.agentId, "h");
    g.updateAgentPublicKey(id.agentId, id.publicKeyHex);
    const ledger = new KeyLifecycleLedger();
    applyRevocation(ledger, {
      agentId: id.agentId,
      publicKeyHex: id.publicKeyHex,
      reason: "compromise",
      compromisedAtMs: 1000,
      signer: id,
    });
    const newId = loadOrCreateIdentity("rec-new.key", ws.path);
    assert.equal(
      applyRecovery(g, ledger, {
        agentId: id.agentId,
        newPublicKeyHex: newId.publicKeyHex,
        reason: "emergency",
        atMs: 2000,
        signer: newId,
      }),
      false,
    );
    assert.equal(
      applyRecovery(g, ledger, {
        agentId: id.agentId,
        newPublicKeyHex: newId.publicKeyHex,
        reason: "emergency",
        atMs: 2000,
        signer: steward,
        stewardAuthorized: true,
      }),
      true,
    );
  });

  it("forked identities cannot impersonate ancestors", () => {
    const ancestor = loadOrCreateIdentity("anc.key", ws.path);
    const fork = loadOrCreateIdentity("fork.key", ws.path);
    const ledger = new KeyLifecycleLedger();
    ledger.recordFork({
      ancestorAgentId: ancestor.agentId,
      forkAgentId: fork.agentId,
      atMs: 3000,
      signer: fork,
    });
    assert.equal(ledger.canImpersonate(fork.agentId, ancestor.agentId), false);
    assert.equal(ledger.isForkOf(fork.agentId, ancestor.agentId), true);
  });
});
