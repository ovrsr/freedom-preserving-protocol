import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseTrustStateCapsule,
  validateCapsuleAdoptionConsistency,
} from "./capsules.js";

describe("TrustStateCapsuleV2", () => {
  const valid = {
    schemaVersion: 2,
    runtimeId: "openclaw-gateway-1",
    implementationVersion: "1.2.2",
    evidenceRoot: "d".repeat(64),
    coverage: {
      claims: 3,
      receipts: 1,
      completeness: "partial" as const,
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
    keyAlgorithm: "ed25519" as const,
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

  it("accepts legacy capsules without adoptionDisclosure", () => {
    const result = parseTrustStateCapsule(valid);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.capsule.adoptionDisclosure, undefined);
    }
  });

  it("accepts capsules with adoption disclosure summary", () => {
    const result = parseTrustStateCapsule({
      ...valid,
      adoptionDisclosure: {
        constitutionHash: "a".repeat(64),
        harnessId: "cursor",
        localState: "accepted",
        enforcementGrade: "native-hook",
        overlays: [],
        assurance: "peer-advertisable",
      },
    });
    assert.equal(result.ok, true);
  });

  it("peer-summary advertising adoption without disclosure fails consistency", () => {
    const check = validateCapsuleAdoptionConsistency({
      ...valid,
      view: "peer-summary",
      advertisingAdoption: true,
    });
    assert.equal(check.ok, false);
    assert.match(check.error ?? "", /adoptionDisclosure/i);
  });

  it("prompt-only disclosure cannot pair with full completeness", () => {
    const check = validateCapsuleAdoptionConsistency({
      ...valid,
      coverage: { ...valid.coverage, completeness: "full" },
      adoptionDisclosure: {
        constitutionHash: "a".repeat(64),
        harnessId: "generic",
        localState: "accepted",
        enforcementGrade: "prompt-only",
        overlays: ["runtime_degraded"],
        assurance: "declaration-only",
      },
    });
    assert.equal(check.ok, false);
    assert.match(check.error ?? "", /prompt-only|completeness/i);
  });
});
