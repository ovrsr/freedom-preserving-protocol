/**
 * Graded harness adoption e2e (Plan 13):
 * reviewed → local accepted with grade → disclosure → capsule validate.
 * Asserts peer ceilings for native-hook, tool-proxy (partial), prompt-only.
 * Revoke preserves history and clears peer-active acceptance.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  appendAdoptionState,
  computePeerAdvertisability,
  currentAdoptionState,
  readAdoptionHistory,
} from "../scripts/adoption-state.ts";
import {
  parseAdoptionDisclosure,
} from "../packages/protocol-core/src/adoption-disclosure.ts";
import { loadOrCreateIdentity } from "../packages/trust-core/src/identity.ts";
import {
  buildTrustStateCapsule,
} from "../packages/trust-core/src/capsule.ts";
import {
  validateCapsuleWithAdoptionDisclosure,
} from "../plugin-trust/src/capsule.ts";

describe("graded harness adoption e2e", () => {
  const dir = mkdtempSync(join(tmpdir(), "fpp-graded-e2e-"));
  after(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  const hash = "a".repeat(64);
  const freshness = {
    audience: "fpp:peer:agent-b",
    challenge: "e2e-nonce",
    issuedAt: "2026-07-10T12:00:00.000Z",
    expiresAt: "2026-07-10T12:05:00.000Z",
  };
  const policy = {
    maxLifetimeMs: 10 * 60_000,
    allowedClockSkewMs: 60_000,
    nowMs: Date.parse("2026-07-10T12:01:00.000Z"),
  };

  it("native-hook: local accepted + peer-advertisable capsule", () => {
    const log = join(dir, "native.jsonl");
    appendAdoptionState(log, {
      agentId: "agent-e2e",
      state: "reviewed",
      constitutionHash: hash,
      harnessId: "cursor",
      enforcementGrade: "native-hook",
      overlays: [],
    });
    appendAdoptionState(log, {
      agentId: "agent-e2e",
      state: "accepted",
      constitutionHash: hash,
      harnessId: "cursor",
      enforcementGrade: "native-hook",
      overlays: [],
    });
    assert.equal(currentAdoptionState(log), "accepted");
    const record = readAdoptionHistory(log).at(-1)!.record;
    assert.equal(record.schemaVersion, 2);
    const peer = computePeerAdvertisability(record, {
      passed: true,
      preToolHook: true,
    });
    assert.equal(peer.peerAdvertisable, true);

    const disclosure = parseAdoptionDisclosure({
      schemaVersion: 1,
      agentId: "agent-e2e",
      constitutionHash: hash,
      harnessId: "cursor",
      localState: "accepted",
      enforcementGrade: "native-hook",
      overlays: [],
      assurance: "peer-advertisable",
      recordedAt: "2026-07-10T12:00:00.000Z",
    });
    assert.equal(disclosure.ok, true);

    const identity = loadOrCreateIdentity(join(dir, "native.key"), "/");
    const capsule = buildTrustStateCapsule({
      identity,
      runtimeId: "e2e",
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
        constitutionHash: hash,
        harnessId: "cursor",
        localState: "accepted",
        enforcementGrade: "native-hook",
        overlays: [],
        assurance: "peer-advertisable",
      },
    });
    const validated = validateCapsuleWithAdoptionDisclosure(capsule, policy);
    assert.equal(validated.valid, true);
    assert.equal(validated.adoptionOk, true);
  });

  it("tool-proxy: peer-advertisable only with partial/degraded disclosure", () => {
    const log = join(dir, "proxy.jsonl");
    appendAdoptionState(log, {
      agentId: "agent-e2e",
      state: "reviewed",
      constitutionHash: hash,
      harnessId: "sidecar",
      enforcementGrade: "tool-proxy",
      overlays: ["runtime_degraded"],
    });
    appendAdoptionState(log, {
      agentId: "agent-e2e",
      state: "accepted",
      constitutionHash: hash,
      harnessId: "sidecar",
      enforcementGrade: "tool-proxy",
      overlays: ["runtime_degraded"],
    });
    const record = readAdoptionHistory(log).at(-1)!.record;
    assert.equal(
      computePeerAdvertisability(record, { passed: true, toolProxy: true })
        .peerAdvertisable,
      true,
    );
    assert.equal(
      computePeerAdvertisability(
        {
          ...record,
          schemaVersion: 2,
          enforcementGrade: "tool-proxy",
          overlays: [],
          harnessId: "sidecar",
          agentId: "agent-e2e",
          state: "accepted",
          constitutionHash: hash,
          recordedAt: "2026-07-10T12:00:00.000Z",
        },
        { passed: true, toolProxy: true },
      ).peerAdvertisable,
      false,
    );

    const identity = loadOrCreateIdentity(join(dir, "proxy.key"), "/");
    const capsule = buildTrustStateCapsule({
      identity,
      runtimeId: "e2e",
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
        constitutionHash: hash,
        harnessId: "sidecar",
        localState: "accepted",
        enforcementGrade: "tool-proxy",
        overlays: ["runtime_degraded"],
        assurance: "peer-advertisable",
      },
    });
    assert.equal(
      validateCapsuleWithAdoptionDisclosure(capsule, policy).adoptionOk,
      true,
    );
    assert.throws(() =>
      buildTrustStateCapsule({
        identity,
        runtimeId: "e2e",
        implementationVersion: "1.2.2",
        evidenceRoot: "d".repeat(64),
        coverageMetrics: {
          metricVersion: 1,
          finalizedReceipts: 1,
          completeness: "full",
        },
        freshness,
        view: "peer-summary",
        adoptionDisclosure: {
          constitutionHash: hash,
          harnessId: "sidecar",
          localState: "accepted",
          enforcementGrade: "tool-proxy",
          overlays: ["runtime_degraded"],
          assurance: "peer-advertisable",
        },
      }),
    );
  });

  it("prompt-only: local accepted + declaration-only peer ceiling", () => {
    const log = join(dir, "prompt.jsonl");
    appendAdoptionState(log, {
      agentId: "agent-e2e",
      state: "reviewed",
      constitutionHash: hash,
      harnessId: "generic",
      enforcementGrade: "prompt-only",
      overlays: ["runtime_degraded"],
    });
    appendAdoptionState(log, {
      agentId: "agent-e2e",
      state: "accepted",
      constitutionHash: hash,
      harnessId: "generic",
      enforcementGrade: "prompt-only",
      overlays: ["runtime_degraded"],
    });
    const record = readAdoptionHistory(log).at(-1)!.record;
    assert.equal(currentAdoptionState(log), "accepted");
    assert.equal(
      computePeerAdvertisability(record, { passed: true, preToolHook: true })
        .peerAdvertisable,
      false,
    );
    assert.equal(
      computePeerAdvertisability(record, { passed: true }).assurance,
      "declaration-only",
    );

    assert.equal(
      parseAdoptionDisclosure({
        schemaVersion: 1,
        agentId: "agent-e2e",
        constitutionHash: hash,
        harnessId: "generic",
        localState: "accepted",
        enforcementGrade: "prompt-only",
        overlays: ["runtime_degraded"],
        assurance: "peer-advertisable",
        recordedAt: "2026-07-10T12:00:00.000Z",
      }).ok,
      false,
    );

    const identity = loadOrCreateIdentity(join(dir, "prompt.key"), "/");
    const capsule = buildTrustStateCapsule({
      identity,
      runtimeId: "e2e",
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
        constitutionHash: hash,
        harnessId: "generic",
        localState: "accepted",
        enforcementGrade: "prompt-only",
        overlays: ["runtime_degraded"],
        assurance: "declaration-only",
      },
    });
    assert.equal(
      validateCapsuleWithAdoptionDisclosure(capsule, policy).adoptionOk,
      true,
    );
  });

  it("revoke removes peer-active acceptance without erasing history", () => {
    const log = join(dir, "revoke.jsonl");
    appendAdoptionState(log, {
      agentId: "agent-e2e",
      state: "reviewed",
      constitutionHash: hash,
      harnessId: "cursor",
      enforcementGrade: "native-hook",
      overlays: [],
    });
    appendAdoptionState(log, {
      agentId: "agent-e2e",
      state: "accepted",
      constitutionHash: hash,
      harnessId: "cursor",
      enforcementGrade: "native-hook",
      overlays: [],
    });
    appendAdoptionState(log, {
      agentId: "agent-e2e",
      state: "revoked",
      constitutionHash: hash,
      harnessId: "cursor",
      enforcementGrade: "native-hook",
      overlays: [],
      notes: "e2e exit; peer ads cleared — no active acceptance",
    });
    const history = readAdoptionHistory(log);
    assert.ok(history.some((e) => e.record.state === "accepted"));
    assert.equal(currentAdoptionState(log), "revoked");
    const last = history.at(-1)!.record;
    assert.equal(
      computePeerAdvertisability(last, { passed: true, preToolHook: true })
        .peerAdvertisable,
      false,
    );
    assert.match(readFileSync(log, "utf-8"), /accepted/);
    assert.match(readFileSync(log, "utf-8"), /revoked/);
  });
});
