import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadOrCreateIdentity } from "@ovrsr/fpp-trust-core";
import {
  buildTrustStateCapsule,
  validateCapsuleWithAdoptionDisclosure,
} from "./capsule.ts";

describe("adoption disclosure peer validation", () => {
  const dir = mkdtempSync(join(tmpdir(), "fpp-adopt-val-"));
  after(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  const freshness = {
    audience: "fpp:peer:agent-b",
    challenge: "nonce-xyz",
    issuedAt: "2026-07-10T12:00:00.000Z",
    expiresAt: "2026-07-10T12:05:00.000Z",
  };
  const policy = {
    maxLifetimeMs: 10 * 60_000,
    allowedClockSkewMs: 60_000,
    nowMs: Date.parse("2026-07-10T12:01:00.000Z"),
  };

  it("fails closed when declaration-only is elevated toward full completeness", () => {
    const identity = loadOrCreateIdentity(join(dir, "a.key"), "/");
    const capsule = buildTrustStateCapsule({
      identity,
      runtimeId: "r1",
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
    const elevated = {
      ...capsule,
      coverage: { ...capsule.coverage, completeness: "full" as const },
    };
    const result = validateCapsuleWithAdoptionDisclosure(elevated, policy);
    assert.equal(result.valid, false);
    assert.equal(result.adoptionOk, false);
    assert.ok(
      result.reasons.some((r) => /prompt-only|declaration-only|completeness/i.test(r)),
      result.reasons.join("; "),
    );
    assert.ok(
      result.adoptionReasons.some((r) =>
        /prompt-only|declaration-only|completeness/i.test(r),
      ),
    );
  });

  it("caps tool-proxy at partial and names grade + assurance in diagnostics", () => {
    const identity = loadOrCreateIdentity(join(dir, "b.key"), "/");
    const capsule = buildTrustStateCapsule({
      identity,
      runtimeId: "r1",
      implementationVersion: "1.2.2",
      evidenceRoot: "d".repeat(64),
      coverageMetrics: {
        metricVersion: 1,
        finalizedReceipts: 1,
        completeness: "partial",
      },
      freshness,
      view: "peer-summary",
      adoptionDisclosure: {
        constitutionHash: "a".repeat(64),
        harnessId: "sidecar",
        localState: "accepted",
        enforcementGrade: "tool-proxy",
        overlays: ["runtime_degraded"],
        assurance: "peer-advertisable",
      },
    });
    const ok = validateCapsuleWithAdoptionDisclosure(capsule, policy);
    assert.equal(ok.adoptionOk, true);
    assert.equal(capsule.coverage.completeness, "partial");

    const elevated = {
      ...capsule,
      coverage: { ...capsule.coverage, completeness: "full" as const },
      adoptionDisclosure: {
        ...capsule.adoptionDisclosure!,
        overlays: [] as [],
      },
    };
    const bad = validateCapsuleWithAdoptionDisclosure(elevated, policy);
    assert.equal(bad.adoptionOk, false);
    const diag = [...bad.reasons, ...bad.adoptionReasons].join("; ");
    assert.match(diag, /tool-proxy|runtime_degraded|peer-advertisable|completeness/i);
  });

  it("records assurance class separately from signature validity", () => {
    const identity = loadOrCreateIdentity(join(dir, "c.key"), "/");
    const capsule = buildTrustStateCapsule({
      identity,
      runtimeId: "r1",
      implementationVersion: "1.2.2",
      evidenceRoot: "d".repeat(64),
      coverageMetrics: {
        metricVersion: 1,
        finalizedReceipts: 0,
        completeness: "none",
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
    const result = validateCapsuleWithAdoptionDisclosure(capsule, policy);
    assert.equal(result.parseOk, true);
    assert.equal(result.signatureOk, true);
    assert.equal(result.adoptionOk, true);
    assert.equal(capsule.adoptionDisclosure?.assurance, "declaration-only");
  });
});
