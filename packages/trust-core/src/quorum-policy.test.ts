/**
 * Quorum policy: thresholds, roles, eligibility, revoked-key rejection.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createTempWorkspace } from "./test-helpers.js";
import { loadOrCreateIdentity } from "./identity.js";
import {
  KeyLifecycleLedger,
  applyRevocation,
} from "./key-lifecycle.js";
import { TrustLevel } from "./trust-graph.js";
import {
  DEFAULT_QUORUM_POLICY,
  evaluateBallotEligibility,
  evaluateThreshold,
  parseQuorumPolicyConfig,
  thresholdFor,
} from "./quorum-policy.js";

describe("quorum-policy", () => {
  const ws = createTempWorkspace("fpp-quorum-policy-");
  after(() => ws.cleanup());

  it("parses config with peer and steward thresholds", () => {
    const policy = parseQuorumPolicyConfig({
      peerThreshold: 3,
      stewardThreshold: 2,
      peerEligibleIds: ["agent:a", "agent:b"],
      stewardEligibleIds: ["agent:s"],
      minStandingLevel: TrustLevel.MEDIUM,
    });
    assert.equal(policy.peerThreshold, 3);
    assert.equal(policy.stewardThreshold, 2);
    assert.equal(thresholdFor(policy, "peer-quorum"), 3);
    assert.equal(thresholdFor(policy, "steward-quorum"), 2);
    assert.equal(policy.minStandingLevel, TrustLevel.MEDIUM);
  });

  it("falls back to defaults for empty config", () => {
    const policy = parseQuorumPolicyConfig(undefined);
    assert.equal(policy.peerThreshold, DEFAULT_QUORUM_POLICY.peerThreshold);
    assert.equal(policy.stewardThreshold, DEFAULT_QUORUM_POLICY.stewardThreshold);
  });

  it("evaluateThreshold fails below threshold and passes at threshold", () => {
    const policy = parseQuorumPolicyConfig({
      peerThreshold: 2,
      stewardThreshold: 2,
      peerEligibleIds: [],
      stewardEligibleIds: [],
    });
    const below = evaluateThreshold(policy, {
      quorumClass: "peer-quorum",
      ayeCount: 1,
    });
    assert.equal(below.ok, false);
    const at = evaluateThreshold(policy, {
      quorumClass: "peer-quorum",
      ayeCount: 2,
    });
    assert.equal(at.ok, true);
  });

  it("rejects ballots from voters not in eligible sets", () => {
    const id = loadOrCreateIdentity("peer.key", ws.path);
    const ledger = new KeyLifecycleLedger();
    const policy = parseQuorumPolicyConfig({
      peerThreshold: 2,
      stewardThreshold: 2,
      peerEligibleIds: ["agent:other"],
      stewardEligibleIds: ["agent:steward"],
    });
    const result = evaluateBallotEligibility(policy, ledger, {
      voterId: id.agentId,
      publicKeyHex: id.publicKeyHex,
      quorumClass: "peer-quorum",
      nowMs: Date.now(),
    });
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /not in peerEligible/i);
  });

  it("accepts eligible peer voters", () => {
    const id = loadOrCreateIdentity("eligible-peer.key", ws.path);
    const ledger = new KeyLifecycleLedger();
    const policy = parseQuorumPolicyConfig({
      peerThreshold: 2,
      stewardThreshold: 2,
      peerEligibleIds: [id.agentId],
      stewardEligibleIds: [],
    });
    const result = evaluateBallotEligibility(policy, ledger, {
      voterId: id.agentId,
      publicKeyHex: id.publicKeyHex,
      quorumClass: "peer-quorum",
      nowMs: Date.now(),
      standingLevel: TrustLevel.HIGH,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.role, "peer");
  });

  it("requires stewardEligibleIds for steward-quorum", () => {
    const peer = loadOrCreateIdentity("only-peer.key", ws.path);
    const ledger = new KeyLifecycleLedger();
    const policy = parseQuorumPolicyConfig({
      peerThreshold: 2,
      stewardThreshold: 2,
      peerEligibleIds: [peer.agentId],
      stewardEligibleIds: ["agent:real-steward"],
    });
    const result = evaluateBallotEligibility(policy, ledger, {
      voterId: peer.agentId,
      publicKeyHex: peer.publicKeyHex,
      quorumClass: "steward-quorum",
      nowMs: Date.now(),
    });
    assert.equal(result.ok, false);
    assert.match(
      result.ok === false ? result.reason : "",
      /stewardEligible/i,
    );
  });

  it("rejects ballots from revoked keys", () => {
    const id = loadOrCreateIdentity("revoked-voter.key", ws.path);
    const ledger = new KeyLifecycleLedger();
    applyRevocation(ledger, {
      agentId: id.agentId,
      publicKeyHex: id.publicKeyHex,
      reason: "compromise",
      compromisedAtMs: 1000,
      signer: id,
    });
    const policy = parseQuorumPolicyConfig({
      peerThreshold: 2,
      stewardThreshold: 2,
      peerEligibleIds: [id.agentId],
      stewardEligibleIds: [],
    });
    const result = evaluateBallotEligibility(policy, ledger, {
      voterId: id.agentId,
      publicKeyHex: id.publicKeyHex,
      quorumClass: "peer-quorum",
      nowMs: 2000,
    });
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /revoked|not valid/i);
  });

  it("rejects voters below minStandingLevel", () => {
    const id = loadOrCreateIdentity("low-standing.key", ws.path);
    const ledger = new KeyLifecycleLedger();
    const policy = parseQuorumPolicyConfig({
      peerThreshold: 2,
      stewardThreshold: 2,
      peerEligibleIds: [id.agentId],
      stewardEligibleIds: [],
      minStandingLevel: TrustLevel.HIGH,
    });
    const result = evaluateBallotEligibility(policy, ledger, {
      voterId: id.agentId,
      publicKeyHex: id.publicKeyHex,
      quorumClass: "peer-quorum",
      nowMs: Date.now(),
      standingLevel: TrustLevel.LOW,
    });
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /standing/i);
  });
});
