/**
 * Quorum eligibility / threshold unreachable diagnostics (Plan 11 I/J).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeTrustConfig } from "./create-trust-stack.js";

describe("mergeTrustConfig quorum unreachable diagnostics", () => {
  it("warns when quorumStewardEligibleIds is empty", () => {
    const cfg = mergeTrustConfig({
      quorumStewardEligibleIds: [],
      quorumPeerEligibleIds: ["peer:a", "peer:b"],
      quorumPeerThreshold: 2,
      quorumStewardThreshold: 2,
    });
    assert.ok(
      cfg.migrationDiagnostics.some(
        (d) =>
          d.code === "QUORUM_STEWARD_UNREACHABLE" && d.severity === "warn",
      ),
      JSON.stringify(cfg.migrationDiagnostics),
    );
  });

  it("warns when quorumPeerEligibleIds is empty", () => {
    const cfg = mergeTrustConfig({
      quorumStewardEligibleIds: ["steward:a", "steward:b"],
      quorumPeerEligibleIds: [],
      quorumPeerThreshold: 2,
      quorumStewardThreshold: 2,
    });
    assert.ok(
      cfg.migrationDiagnostics.some(
        (d) => d.code === "QUORUM_PEER_UNREACHABLE" && d.severity === "warn",
      ),
      JSON.stringify(cfg.migrationDiagnostics),
    );
  });

  it("warns when steward threshold exceeds eligible count", () => {
    const cfg = mergeTrustConfig({
      quorumStewardEligibleIds: ["steward:a"],
      quorumStewardThreshold: 2,
      quorumPeerEligibleIds: ["peer:a", "peer:b"],
      quorumPeerThreshold: 2,
    });
    assert.ok(
      cfg.migrationDiagnostics.some(
        (d) =>
          d.code === "QUORUM_STEWARD_THRESHOLD_EXCEEDS_ELIGIBLE" &&
          d.severity === "warn",
      ),
      JSON.stringify(cfg.migrationDiagnostics),
    );
  });

  it("warns when peer threshold exceeds eligible count", () => {
    const cfg = mergeTrustConfig({
      quorumStewardEligibleIds: ["steward:a", "steward:b"],
      quorumStewardThreshold: 2,
      quorumPeerEligibleIds: ["peer:a"],
      quorumPeerThreshold: 2,
    });
    assert.ok(
      cfg.migrationDiagnostics.some(
        (d) =>
          d.code === "QUORUM_PEER_THRESHOLD_EXCEEDS_ELIGIBLE" &&
          d.severity === "warn",
      ),
      JSON.stringify(cfg.migrationDiagnostics),
    );
  });

  it("emits no unreachable diagnostic for healthy quorum config", () => {
    const cfg = mergeTrustConfig({
      quorumStewardEligibleIds: ["steward:a", "steward:b"],
      quorumStewardThreshold: 2,
      quorumPeerEligibleIds: ["peer:a", "peer:b", "peer:c"],
      quorumPeerThreshold: 2,
    });
    const codes = cfg.migrationDiagnostics.map((d) => d.code);
    assert.ok(!codes.includes("QUORUM_STEWARD_UNREACHABLE"));
    assert.ok(!codes.includes("QUORUM_PEER_UNREACHABLE"));
    assert.ok(!codes.includes("QUORUM_STEWARD_THRESHOLD_EXCEEDS_ELIGIBLE"));
    assert.ok(!codes.includes("QUORUM_PEER_THRESHOLD_EXCEEDS_ELIGIBLE"));
  });

  it("quorum unreachable warns are independent of enforcement dispositionMode", () => {
    // Trust merge must not read dispositionMode — empty eligible lists always warn.
    const cfg = mergeTrustConfig({
      dispositionMode: "operator-present",
      quorumStewardEligibleIds: [],
      quorumPeerEligibleIds: [],
    });
    assert.ok(
      cfg.migrationDiagnostics.some((d) => d.code === "QUORUM_STEWARD_UNREACHABLE"),
    );
    assert.ok(
      cfg.migrationDiagnostics.some((d) => d.code === "QUORUM_PEER_UNREACHABLE"),
    );
  });
});
