import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isGovernanceMode,
  parseGovernanceEpoch,
  parseGovernanceEvent,
  parseGovernanceState,
} from "./governance.js";

const HEX64 = "a".repeat(64);
const HEX64_B = "b".repeat(64);

describe("GovernanceMode", () => {
  it("accepts enabled, draining, and disabled", () => {
    for (const mode of ["enabled", "draining", "disabled"] as const) {
      assert.equal(isGovernanceMode(mode), true, mode);
    }
  });

  it("rejects malformed modes", () => {
    for (const mode of ["Enabled", "off", "ungated", "", 1, null, undefined]) {
      assert.equal(isGovernanceMode(mode), false, String(mode));
    }
  });
});

describe("GovernanceEpoch", () => {
  it("accepts non-negative integers", () => {
    for (const epoch of [0, 1, 42, 2 ** 31 - 1]) {
      const result = parseGovernanceEpoch(epoch);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.epoch, epoch);
    }
  });

  it("rejects negative, non-integral, and non-number epochs", () => {
    for (const epoch of [-1, 1.5, Number.NaN, "0", null, undefined, true]) {
      assert.equal(parseGovernanceEpoch(epoch).ok, false, String(epoch));
    }
  });
});

describe("GovernanceStateV1", () => {
  const valid = {
    schemaVersion: 1 as const,
    mode: "enabled" as const,
    epoch: 0,
  };

  it("accepts enabled/draining/disabled state records", () => {
    for (const mode of ["enabled", "draining", "disabled"] as const) {
      const result = parseGovernanceState({ ...valid, mode, epoch: 7 });
      assert.equal(result.ok, true, mode);
      if (result.ok) {
        assert.equal(result.state.mode, mode);
        assert.equal(result.state.epoch, 7);
      }
    }
  });

  it("rejects malformed mode or epoch on state records", () => {
    assert.equal(parseGovernanceState({ ...valid, mode: "off" }).ok, false);
    assert.equal(parseGovernanceState({ ...valid, epoch: -1 }).ok, false);
    assert.equal(parseGovernanceState({ ...valid, epoch: 1.25 }).ok, false);
    assert.equal(
      parseGovernanceState({ mode: "enabled", epoch: 0 }).ok,
      false,
    );
  });
});

describe("GovernanceEventV1", () => {
  const validDisabled = {
    schemaVersion: 1 as const,
    kind: "governance-disabled" as const,
    eventId: "evt_01TEST",
    ts: "2026-07-20T12:00:00.000Z",
    epoch: 1,
    previousMode: "draining" as const,
    mode: "disabled" as const,
    actor: { role: "operator", id: "op_local_host" },
    constitutionHash: HEX64,
    policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    prevHash: HEX64_B,
    entryHash: "c".repeat(64),
    reason: "operator requested constitutional layer off",
    signature: {
      alg: "Ed25519",
      keyId: "host-operator-key-1",
      sig: "BASE64_SIGNATURE_PLACEHOLDER",
    },
  };

  const validEnabled = {
    ...validDisabled,
    kind: "governance-enabled" as const,
    epoch: 2,
    previousMode: "disabled" as const,
    mode: "enabled" as const,
    reason: "operator re-enabled constitutional layer",
  };

  it("parses governance-disabled and governance-enabled events", () => {
    const disabled = parseGovernanceEvent(validDisabled);
    assert.equal(disabled.ok, true);
    if (disabled.ok) {
      assert.equal(disabled.event.kind, "governance-disabled");
      assert.equal(disabled.event.epoch, 1);
    }

    const enabled = parseGovernanceEvent(validEnabled);
    assert.equal(enabled.ok, true);
    if (enabled.ok) {
      assert.equal(enabled.event.kind, "governance-enabled");
      assert.equal(enabled.event.epoch, 2);
    }
  });

  it("rejects malformed event kinds, actors, hashes, and epochs", () => {
    assert.equal(
      parseGovernanceEvent({ ...validDisabled, kind: "governance-paused" }).ok,
      false,
    );
    assert.equal(
      parseGovernanceEvent({
        ...validDisabled,
        actor: { role: "operator" },
      }).ok,
      false,
    );
    assert.equal(
      parseGovernanceEvent({
        ...validDisabled,
        actor: { role: "", id: "op" },
      }).ok,
      false,
    );
    assert.equal(
      parseGovernanceEvent({
        ...validDisabled,
        constitutionHash: "not-a-hash",
      }).ok,
      false,
    );
    assert.equal(
      parseGovernanceEvent({ ...validDisabled, prevHash: "zz".repeat(32) }).ok,
      false,
    );
    assert.equal(
      parseGovernanceEvent({ ...validDisabled, entryHash: "short" }).ok,
      false,
    );
    assert.equal(
      parseGovernanceEvent({ ...validDisabled, epoch: -1 }).ok,
      false,
    );
    assert.equal(
      parseGovernanceEvent({ ...validDisabled, mode: "draining" }).ok,
      false,
    );
  });
});
