import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadOrCreateIdentity } from "./identity.js";
import {
  buildTrustStateCapsule,
  validateTrustStateCapsule,
  isLegacyClaimMasquerading,
} from "./capsule.js";

describe("TrustStateCapsuleV2 builder", () => {
  const dir = mkdtempSync(join(tmpdir(), "fpp-cap-"));
  after(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  const freshness = {
    audience: "fpp:peer:agent-b",
    challenge: "nonce-abc",
    issuedAt: "2026-07-10T12:00:00.000Z",
    expiresAt: "2026-07-10T12:05:00.000Z",
  };

  it("builds a fresh signed capsule bound to runtime and evidence roots", () => {
    const identity = loadOrCreateIdentity(join(dir, "id.key"), "/");
    const capsule = buildTrustStateCapsule({
      identity,
      runtimeId: "runtime-1",
      implementationVersion: "1.2.2",
      evidenceRoot: "d".repeat(64),
      receiptRoot: "e".repeat(64),
      coverageMetrics: {
        metricVersion: 1,
        finalizedReceipts: 3,
        completeness: "partial",
      },
      freshness,
      view: "self",
      lineageRef: "lineage:abc",
      selectiveProofRefs: ["proof:0"],
    });
    assert.equal(capsule.schemaVersion, 2);
    assert.equal(capsule.runtimeId, "runtime-1");
    assert.equal(capsule.receiptRoot, "e".repeat(64));
    assert.equal(capsule.view, "self");
    assert.equal(capsule.coverageMetricVersion, 1);

    const result = validateTrustStateCapsule(capsule, {
      maxLifetimeMs: 10 * 60_000,
      allowedClockSkewMs: 60_000,
      nowMs: Date.parse("2026-07-10T12:01:00.000Z"),
    });
    assert.equal(result.valid, true);
    assert.equal(result.view, "self");
  });

  it("rejects expired capsules and distinguishes peer-summary view", () => {
    const identity = loadOrCreateIdentity(join(dir, "id2.key"), "/");
    const capsule = buildTrustStateCapsule({
      identity,
      runtimeId: "runtime-1",
      implementationVersion: "1.2.2",
      evidenceRoot: "d".repeat(64),
      coverageMetrics: {
        metricVersion: 1,
        finalizedReceipts: 0,
        completeness: "unknown",
      },
      freshness,
      view: "peer-summary",
    });
    assert.equal(capsule.view, "peer-summary");
    assert.equal(capsule.coverage.completeness, "partial"); // unknown mapped
    const expired = validateTrustStateCapsule(capsule, {
      maxLifetimeMs: 10 * 60_000,
      allowedClockSkewMs: 0,
      nowMs: Date.parse("2026-07-10T13:00:00.000Z"),
    });
    assert.equal(expired.valid, false);
    assert.equal(expired.freshnessOk, false);
  });

  it("detects legacy claims masquerading as capsules", () => {
    assert.equal(
      isLegacyClaimMasquerading({
        agentId: "fpp-abc",
        constitutionHash: "a".repeat(64),
        schemaVersion: 1,
      }),
      true,
    );
    assert.equal(
      isLegacyClaimMasquerading({
        schemaVersion: 2,
        evidenceRoot: "d".repeat(64),
        freshness,
      }),
      false,
    );
  });
});
