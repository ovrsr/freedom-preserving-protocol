import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeQuorumEvidenceDigest,
  parseQuorumBallot,
  parseQuorumEvidencePackage,
  parseQuorumProposal,
  validateBallotAgainstProposal,
  type QuorumBallotV1,
  type QuorumEvidencePackageV1,
  type QuorumProposalV1,
} from "./quorum.js";

describe("QuorumProposalV1 / QuorumBallotV1", () => {
  const validProposal: QuorumProposalV1 = {
    schemaVersion: 1,
    proposalId: "prop-001",
    quorumClass: "peer-quorum",
    proposerId: "agent:alice",
    mandateDigest:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    scope: {
      classifications: ["pkg.install"],
      capabilities: ["tool:exec"],
    },
    budgets: { maxActions: 3, remainingActions: 3 },
    mandateValidFrom: "2026-07-10T00:00:00.000Z",
    mandateValidTo: "2026-07-11T00:00:00.000Z",
    proposedAt: "2026-07-10T12:00:00.000Z",
    expiresAt: "2026-07-10T13:00:00.000Z",
    publicKey: "bb".repeat(32),
    signature: "cc".repeat(64),
  };

  const validBallot: QuorumBallotV1 = {
    schemaVersion: 1,
    ballotId: "ballot-001",
    proposalId: "prop-001",
    voterId: "agent:bob",
    vote: "aye",
    mandateDigest: validProposal.mandateDigest,
    castAt: "2026-07-10T12:05:00.000Z",
    publicKey: "dd".repeat(32),
    signature: "ee".repeat(64),
  };

  it("accepts a valid quorum proposal", () => {
    const result = parseQuorumProposal(validProposal);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.proposal.proposalId, "prop-001");
      assert.equal(result.proposal.quorumClass, "peer-quorum");
    }
  });

  it("accepts a valid quorum ballot", () => {
    const result = parseQuorumBallot(validBallot);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.ballot.vote, "aye");
    }
  });

  it("rejects proposals missing signatures", () => {
    const { signature: _s, ...rest } = validProposal;
    void _s;
    assert.equal(parseQuorumProposal(rest).ok, false);
  });

  it("rejects ballots missing signatures", () => {
    const { signature: _s, ...rest } = validBallot;
    void _s;
    assert.equal(parseQuorumBallot(rest).ok, false);
  });

  it("rejects ballots whose mandateDigest mismatches the proposal", () => {
    const mismatched = {
      ...validBallot,
      mandateDigest: "ff".repeat(32),
    };
    const check = validateBallotAgainstProposal(mismatched, validProposal);
    assert.equal(check.ok, false);
    assert.match(check.error ?? "", /mandateDigest|mismatch/i);
  });

  it("accepts ballots that match the proposal mandateDigest", () => {
    const check = validateBallotAgainstProposal(validBallot, validProposal);
    assert.equal(check.ok, true);
  });

  it("parses a quorum evidence package and computes a stable evidence digest", () => {
    const pkg: QuorumEvidencePackageV1 = {
      schemaVersion: 1,
      proposal: validProposal,
      ballots: [validBallot],
      finalizedAt: "2026-07-10T12:10:00.000Z",
    };
    const parsed = parseQuorumEvidencePackage(pkg);
    assert.equal(parsed.ok, true);
    const digestA = computeQuorumEvidenceDigest(pkg);
    const digestB = computeQuorumEvidenceDigest(pkg);
    assert.equal(digestA.length, 64);
    assert.equal(digestA, digestB);
    assert.match(digestA, /^[0-9a-f]{64}$/);
  });

  it("rejects evidence packages with unsigned ballots", () => {
    const { signature: _s, ...unsignedBallot } = validBallot;
    void _s;
    assert.equal(
      parseQuorumEvidencePackage({
        schemaVersion: 1,
        proposal: validProposal,
        ballots: [unsignedBallot],
        finalizedAt: "2026-07-10T12:10:00.000Z",
      }).ok,
      false,
    );
  });
});
