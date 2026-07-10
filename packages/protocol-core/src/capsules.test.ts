import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTrustStateCapsule } from "./capsules.js";

describe("TrustStateCapsuleV2", () => {
  const valid = {
    schemaVersion: 2,
    runtimeId: "openclaw-gateway-1",
    implementationVersion: "1.2.2",
    evidenceRoot: "d".repeat(64),
    coverage: {
      claims: 3,
      receipts: 1,
      completeness: "partial",
    },
    freshness: {
      audience: "fpp:peer:agent-b",
      challenge: "n1",
      issuedAt: "2026-07-10T12:00:00.000Z",
      expiresAt: "2026-07-10T12:05:00.000Z",
    },
    agentId: "fpp:ed25519:" + "c".repeat(64),
    publicKey: "a".repeat(64),
    signature: "b".repeat(128),
    keyAlgorithm: "ed25519",
  };

  it("accepts a valid capsule", () => {
    assert.equal(parseTrustStateCapsule(valid).ok, true);
  });

  it("requires implementation version and evidence root", () => {
    const { implementationVersion: _i, evidenceRoot: _e, ...rest } = valid;
    void _i;
    void _e;
    assert.equal(parseTrustStateCapsule(rest).ok, false);
  });
});
