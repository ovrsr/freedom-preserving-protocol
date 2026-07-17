/**
 * Emergency override submit tool — verify-only, never signs.
 * Stewards only for v1: peer escalation is a larger separate trust decision.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  canonicalizeV2,
  emergencyOverrideSigningFields,
  signMessage,
  type SignedEmergencyOverrideV1,
} from "@ovrsr/fpp-protocol-core";
import { createTempWorkspace } from "./test-helpers.js";
import { loadOrCreateIdentity } from "./identity.js";
import {
  executeEmergencyOverrideSubmit,
  type EmergencyOverrideSubmitDependencies,
} from "./tools.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function signOverride(
  override: Omit<SignedEmergencyOverrideV1, "signature" | "publicKey">,
  seed: Uint8Array,
): SignedEmergencyOverrideV1 {
  const publicKey = Buffer.from(ed.getPublicKey(seed)).toString("hex");
  const withKey = { ...override, publicKey } as SignedEmergencyOverrideV1;
  const message = Buffer.from(
    canonicalizeV2(emergencyOverrideSigningFields(withKey)),
    "utf8",
  );
  const signature = Buffer.from(signMessage(message, seed)).toString("hex");
  return { ...withKey, signature };
}

describe("fpp_emergency_override_submit", () => {
  const ws = createTempWorkspace("fpp-emg-submit-");
  after(() => ws.cleanup());

  const stewardSeed = ed.utils.randomPrivateKey();
  const stewardPublicKey = Buffer.from(ed.getPublicKey(stewardSeed)).toString(
    "hex",
  );

  function makeDeps(): EmergencyOverrideSubmitDependencies & {
    identity: ReturnType<typeof loadOrCreateIdentity>;
    signCalls: { count: number };
  } {
    const identity = loadOrCreateIdentity("agent-emg.key", ws.path);
    const signCalls = { count: 0 };
    const wrapped = {
      ...identity,
      sign: (message: Uint8Array) => {
        signCalls.count += 1;
        return identity.sign(message);
      },
    };
    return {
      identity: wrapped,
      stewardEligibleIds: ["steward:alice"],
      emergencyOverrideStorePath: join(ws.path, "fpp-emergency-overrides.json"),
      signCalls,
    };
  }

  const base = {
    schemaVersion: 1 as const,
    overrideId: "e-submit-1",
    issuerId: "steward:alice",
    scope: { classifications: ["exec.system-modify"] },
    budgets: { maxActions: 2, remainingActions: 2 },
    validFrom: "2026-07-01T00:00:00.000Z",
    validTo: "2026-08-01T00:00:00.000Z",
    evidenceRef: "evidence:submit-1",
  };

  it("admits a steward-signed in-allowlist override", () => {
    const deps = makeDeps();
    const override = signOverride(base, stewardSeed);
    assert.equal(override.publicKey, stewardPublicKey);
    const result = executeEmergencyOverrideSubmit(
      { signedJson: JSON.stringify(override) },
      deps,
    );
    const details = result.details as { ok?: boolean; overrideId?: string };
    assert.equal(details.ok, true);
    assert.equal(details.overrideId, "e-submit-1");
    assert.ok(existsSync(deps.emergencyOverrideStorePath));
    const file = JSON.parse(
      readFileSync(deps.emergencyOverrideStorePath, "utf8"),
    ) as { overrides: SignedEmergencyOverrideV1[] };
    assert.equal(file.overrides[0]?.overrideId, "e-submit-1");
    assert.equal(deps.signCalls.count, 0);
  });

  it("rejects agent-identity-signed override (no self-escalation)", () => {
    const deps = makeDeps();
    // Sign with the local agent seed by reconstructing from identity key.
    const agentSeed = new Uint8Array(
      readFileSync(join(ws.path, "agent-emg.key")),
    );
    const override = signOverride(
      { ...base, overrideId: "e-submit-self" },
      agentSeed,
    );
    const result = executeEmergencyOverrideSubmit(
      { signedJson: JSON.stringify(override) },
      deps,
    );
    const details = result.details as { ok?: boolean; reason?: string };
    assert.equal(details.ok, false);
    assert.equal(details.reason, "agent-self-key");
    assert.equal(deps.signCalls.count, 0);
  });

  it("rejects signature-invalid override", () => {
    const deps = makeDeps();
    const override = signOverride(
      { ...base, overrideId: "e-submit-bad" },
      stewardSeed,
    );
    override.signature = "00".repeat(64);
    const result = executeEmergencyOverrideSubmit(
      { signedJson: JSON.stringify(override) },
      deps,
    );
    const details = result.details as { ok?: boolean; reason?: string };
    assert.equal(details.ok, false);
    assert.equal(details.reason, "signature-invalid");
    assert.equal(deps.signCalls.count, 0);
  });

  it("rejects issuer not in quorumStewardEligibleIds", () => {
    const deps = makeDeps();
    const override = signOverride(
      { ...base, overrideId: "e-submit-peer", issuerId: "peer:bob" },
      stewardSeed,
    );
    const result = executeEmergencyOverrideSubmit(
      { signedJson: JSON.stringify(override) },
      deps,
    );
    const details = result.details as { ok?: boolean; reason?: string };
    assert.equal(details.ok, false);
    assert.equal(details.reason, "issuer-not-steward");
    assert.equal(deps.signCalls.count, 0);
  });

  it("accepts structured override object as well as signedJson", () => {
    const deps = makeDeps();
    const override = signOverride(
      { ...base, overrideId: "e-submit-obj" },
      stewardSeed,
    );
    const result = executeEmergencyOverrideSubmit({ override }, deps);
    const details = result.details as { ok?: boolean; overrideId?: string };
    assert.equal(details.ok, true);
    assert.equal(details.overrideId, "e-submit-obj");
    assert.equal(deps.signCalls.count, 0);
  });
});
