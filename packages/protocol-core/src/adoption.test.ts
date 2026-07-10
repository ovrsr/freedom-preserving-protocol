import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ADOPTION_STATES, parseAdoptionStateRecord } from "./adoption.js";

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
});
