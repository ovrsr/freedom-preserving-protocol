import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEvidenceEnvelope } from "./evidence.js";

describe("EvidenceEnvelopeV1", () => {
  const valid = {
    schemaVersion: 1,
    evidenceId: "ev-1",
    evidenceClass: "claim",
    claimClass: "runtime",
    payloadDigest: "a".repeat(64),
    recordedAt: "2026-07-10T12:00:00.000Z",
  };

  it("accepts append-only evidence envelopes", () => {
    assert.equal(parseEvidenceEnvelope(valid).ok, true);
  });

  it("supports correction references without deleting history", () => {
    const result = parseEvidenceEnvelope({
      ...valid,
      evidenceId: "ev-2",
      corrects: "ev-1",
      annotation: "supersedes prior incomplete claim",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.envelope.corrects, "ev-1");
  });

  it("does not embed a global trust score", () => {
    assert.equal(
      parseEvidenceEnvelope({ ...valid, trustScore: 0.9 }).ok,
      false,
    );
  });
});
