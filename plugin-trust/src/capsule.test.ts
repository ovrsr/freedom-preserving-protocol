import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadOrCreateIdentity } from "@ovrsr/fpp-trust-core";
import { buildTrustStateCapsule } from "./capsule.ts";
import { validateCapsuleWithAdoptionDisclosure } from "./capsule.ts";

describe("plugin-trust capsule adoption disclosure", () => {
  const dir = mkdtempSync(join(tmpdir(), "fpp-pt-cap-"));
  after(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  const freshness = {
    audience: "fpp:peer:agent-b",
    challenge: "nonce-abc",
    issuedAt: "2026-07-10T12:00:00.000Z",
    expiresAt: "2026-07-10T12:05:00.000Z",
  };

  const policy = {
    maxLifetimeMs: 10 * 60_000,
    allowedClockSkewMs: 60_000,
    nowMs: Date.parse("2026-07-10T12:01:00.000Z"),
  };

  it("validates capsule with native-hook peer-advertisable disclosure", () => {
    const identity = loadOrCreateIdentity(join(dir, "id.key"), "/");
    const capsule = buildTrustStateCapsule({
      identity,
      runtimeId: "runtime-1",
      implementationVersion: "1.2.2",
      evidenceRoot: "d".repeat(64),
      coverageMetrics: {
        metricVersion: 1,
        finalizedReceipts: 1,
        completeness: "partial",
      },
      freshness,
      view: "peer-summary",
      advertisingAdoption: true,
      adoptionDisclosure: {
        constitutionHash: "a".repeat(64),
        harnessId: "cursor",
        localState: "accepted",
        enforcementGrade: "native-hook",
        overlays: [],
        assurance: "peer-advertisable",
      },
    });
    const result = validateCapsuleWithAdoptionDisclosure(capsule, policy);
    assert.equal(result.valid, true);
    assert.equal(result.adoptionOk, true);
  });

  it("rejects elevating prompt-only to peer-advertisable in disclosure", () => {
    const identity = loadOrCreateIdentity(join(dir, "id2.key"), "/");
    const capsule = buildTrustStateCapsule({
      identity,
      runtimeId: "runtime-1",
      implementationVersion: "1.2.2",
      evidenceRoot: "d".repeat(64),
      coverageMetrics: {
        metricVersion: 1,
        finalizedReceipts: 0,
        completeness: "partial",
      },
      freshness,
      view: "peer-summary",
      adoptionDisclosure: {
        constitutionHash: "a".repeat(64),
        harnessId: "generic",
        localState: "accepted",
        enforcementGrade: "prompt-only",
        overlays: ["runtime_degraded"],
        assurance: "declaration-only",
      },
    });
    // Manually elevate assurance to simulate peer elevation attempt
    const elevated = {
      ...capsule,
      adoptionDisclosure: {
        ...capsule.adoptionDisclosure!,
        assurance: "peer-advertisable" as const,
      },
    };
    const result = validateCapsuleWithAdoptionDisclosure(elevated, policy);
    assert.equal(result.adoptionOk, false);
    assert.ok(
      result.adoptionReasons.some((r) => /prompt-only/i.test(r)),
      result.adoptionReasons.join("; "),
    );
  });
});
