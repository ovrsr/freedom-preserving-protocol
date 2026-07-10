import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLAIM_CLASSES,
  parseClaim,
  type ClaimParseResult,
} from "./claims.js";

const LEGACY_V1 = {
  agentId: "fpp-abcdef0123456789",
  constitutionHash: "a".repeat(64),
  adoptedAt: "2026-01-01T00:00:00.000Z",
  auditMerkleRoot: "b".repeat(64),
  auditEntryCount: 3,
  chainIntact: true,
  recentLaws: ["law1"],
};

const V2_CLAIM = {
  schemaVersion: 2,
  claimClass: "configuration",
  agentId: "fpp:ed25519:" + "c".repeat(64),
  keyAlgorithm: "ed25519",
  constitutionHash: "a".repeat(64),
  adoptedAt: "2026-01-01T00:00:00.000Z",
  auditMerkleRoot: "b".repeat(64),
  auditEntryCount: 3,
  chainIntact: true,
  recentLaws: ["law1"],
};

describe("parseClaim", () => {
  it("parses legacy v1 claims as declaration-only", () => {
    const result = parseClaim(LEGACY_V1);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.kind, "legacy-v1");
    assert.equal(result.assurance, "declaration-only");
    assert.equal(result.claim.agentId, LEGACY_V1.agentId);
  });

  it("parses v2 claims with machine-readable claim classes", () => {
    for (const claimClass of CLAIM_CLASSES) {
      const result = parseClaim({ ...V2_CLAIM, claimClass });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.kind, "v2");
      assert.equal(result.assurance, "schema-validated");
      assert.equal(result.claim.claimClass, claimClass);
    }
  });

  it("fails closed on unknown critical schema versions", () => {
    const result = parseClaim({ ...V2_CLAIM, schemaVersion: 99 });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /version/i);
  });

  it("rejects malformed fields", () => {
    const result = parseClaim({
      ...V2_CLAIM,
      auditEntryCount: "nope",
    });
    assert.equal(result.ok, false);
  });

  it("rejects unknown claim classes on v2", () => {
    const result = parseClaim({ ...V2_CLAIM, claimClass: "telepathy" });
    assert.equal(result.ok, false);
  });

  it("does not escalate v1 into v2 assurance", () => {
    const result: ClaimParseResult = parseClaim(LEGACY_V1);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.notEqual(result.kind, "v2");
    assert.equal(result.assurance, "declaration-only");
    assert.equal("schemaVersion" in result.claim, false);
  });

  it("rejects non-objects", () => {
    assert.equal(parseClaim(null).ok, false);
    assert.equal(parseClaim("claim").ok, false);
  });
});
