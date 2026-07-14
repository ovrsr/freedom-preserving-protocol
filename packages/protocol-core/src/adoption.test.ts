import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADOPTION_OVERLAY_FLAGS,
  ADOPTION_STATES,
  ENFORCEMENT_GRADES,
  parseAdoptionStateRecord,
} from "./adoption.js";

describe("AdoptionStateRecordV1", () => {
  it("accepts non-boolean adoption states", () => {
    for (const state of ADOPTION_STATES) {
      const result = parseAdoptionStateRecord({
        schemaVersion: 1,
        agentId: "fpp:ed25519:" + "c".repeat(64),
        state,
        constitutionHash: "a".repeat(64),
        recordedAt: "2026-07-10T12:00:00.000Z",
      });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.kind, "v1");
        assert.equal(result.record.schemaVersion, 1);
      }
    }
  });

  it("rejects boolean adoption flags", () => {
    assert.equal(
      parseAdoptionStateRecord({
        schemaVersion: 1,
        agentId: "x",
        state: true,
        constitutionHash: "a".repeat(64),
        recordedAt: "2026-07-10T12:00:00.000Z",
      }).ok,
      false,
    );
  });

  it("never silently upgrades V1 to peer-advertisable or V2", () => {
    const result = parseAdoptionStateRecord({
      schemaVersion: 1,
      agentId: "fpp:ed25519:" + "c".repeat(64),
      state: "accepted",
      constitutionHash: "a".repeat(64),
      recordedAt: "2026-07-10T12:00:00.000Z",
      harnessId: "cursor",
      enforcementGrade: "native-hook",
      overlays: ["runtime_degraded"],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      // Extra fields on input must not promote kind to v2 or invent peer assurance.
      assert.equal(result.kind, "v1");
      assert.equal(result.record.schemaVersion, 1);
      assert.equal(
        (result.record as { peerAssurance?: string }).peerAssurance,
        undefined,
      );
    }
  });
});

describe("AdoptionStateRecordV2", () => {
  const baseV2 = {
    schemaVersion: 2 as const,
    agentId: "fpp:ed25519:" + "c".repeat(64),
    state: "accepted" as const,
    constitutionHash: "a".repeat(64),
    recordedAt: "2026-07-10T12:00:00.000Z",
    harnessId: "cursor",
    enforcementGrade: "native-hook" as const,
    overlays: [] as string[],
  };

  it("accepts overlay flags, harnessId, and enforcementGrade", () => {
    for (const grade of ENFORCEMENT_GRADES) {
      const overlays =
        grade === "prompt-only" ? (["runtime_degraded"] as const) : [];
      const result = parseAdoptionStateRecord({
        ...baseV2,
        enforcementGrade: grade,
        overlays: [...overlays],
      });
      assert.equal(result.ok, true, `grade ${grade} should parse`);
      if (result.ok) {
        assert.equal(result.kind, "v2");
        assert.equal(result.record.schemaVersion, 2);
        assert.equal(result.record.harnessId, "cursor");
        assert.equal(result.record.enforcementGrade, grade);
        assert.deepEqual(result.record.overlays, [...overlays]);
      }
    }
  });

  it("accepts all known overlay flags", () => {
    const result = parseAdoptionStateRecord({
      ...baseV2,
      overlays: [...ADOPTION_OVERLAY_FLAGS],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "v2");
      assert.deepEqual(result.record.overlays, [...ADOPTION_OVERLAY_FLAGS]);
    }
  });

  it("rejects unknown enforcement grades", () => {
    const result = parseAdoptionStateRecord({
      ...baseV2,
      enforcementGrade: "dispatcher-bypass",
    });
    assert.equal(result.ok, false);
  });

  it("rejects unknown overlay flags", () => {
    const result = parseAdoptionStateRecord({
      ...baseV2,
      overlays: ["telepathy_enabled"],
    });
    assert.equal(result.ok, false);
  });

  it("requires explicit schemaVersion 2 (missing fields fail)", () => {
    const result = parseAdoptionStateRecord({
      schemaVersion: 2,
      agentId: "fpp:ed25519:" + "c".repeat(64),
      state: "accepted",
      constitutionHash: "a".repeat(64),
      recordedAt: "2026-07-10T12:00:00.000Z",
    });
    assert.equal(result.ok, false);
  });

  it("rejects empty harnessId", () => {
    const result = parseAdoptionStateRecord({
      ...baseV2,
      harnessId: "",
    });
    assert.equal(result.ok, false);
  });
});
