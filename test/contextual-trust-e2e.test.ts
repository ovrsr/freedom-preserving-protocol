/**
 * End-to-end: v1 migration → evidence → scoped assessment → dispute →
 * key rotation → cluster downgrade.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTempWorkspace } from "../plugin-trust/src/test-helpers.js";
import { loadOrCreateIdentity } from "../plugin-trust/src/identity.js";
import {
  loadTrustGraph,
  migrateV1ToV2,
  saveTrustGraph,
} from "../plugin-trust/src/persistence.js";
import { TrustGraphProtocol, TrustLevel } from "../plugin-trust/src/trust-graph.js";
import { evaluateTrustPolicy } from "../plugin-trust/src/trust-policy.js";
import {
  DisputeLedger,
  openChallenge,
  recordRemediation,
  recordRehabilitation,
  resolveDispute,
} from "../plugin-trust/src/disputes.js";
import {
  KeyLifecycleLedger,
  applyRotation,
  applyRevocation,
} from "../plugin-trust/src/key-lifecycle.js";
import { GroupContextManager } from "../plugin-trust/src/group-context.js";
import { TrustEventLedger, computeEventRoot } from "../plugin-trust/src/trust-events.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(
  __dirname,
  "..",
  "plugin-trust",
  "src",
  "fixtures",
  "trust-graph-v1.json",
);

describe("contextual-trust-e2e", () => {
  const ws = createTempWorkspace("fpp-ctx-e2e-");
  after(() => ws.cleanup());

  it("migrates v1, rebuilds from events, and runs due-process without deleting evidence", async () => {
    assert.ok(existsSync(FIXTURE), "v1 fixture must exist");
    const graphPath = "graph.json";
    mkdirSync(join(ws.path), { recursive: true });
    copyFileSync(FIXTURE, join(ws.path, graphPath));

    const identity = loadOrCreateIdentity("agent.key", ws.path);
    const snapshot = migrateV1ToV2(graphPath, identity, ws.path);
    assert.equal(snapshot.version, 2);
    assert.ok(existsSync(join(ws.path, `${graphPath}.v1.bak`)));
    const bak = JSON.parse(
      readFileSync(join(ws.path, `${graphPath}.v1.bak`), "utf8"),
    );
    assert.equal(bak.version, 1);

    const loaded = loadTrustGraph(graphPath, ws.path, { identity });
    const legacy = loaded.getLegacyObservations();
    assert.ok(legacy.length > 0);
    assert.ok(legacy.every((o) => o.source === "legacy_v1" && o.confidence <= 0.4));

    // Rebuild root from events file
    const eventsFile = join(ws.path, `${graphPath}.events.jsonl`);
    assert.ok(existsSync(eventsFile));
    const events = readFileSync(eventsFile, "utf8")
      .trim()
      .split(/\n/)
      .map((l) => JSON.parse(l));
    assert.equal(computeEventRoot(events), snapshot.eventRoot);

    // Direct vs propagated + severe violation policy
    loaded.addAgent(identity.agentId, "h");
    const peer = loadOrCreateIdentity("peer.key", ws.path);
    loaded.addAgent(peer.agentId, "h");
    loaded.establishTrust(
      identity.agentId,
      peer.agentId,
      TrustLevel.MEDIUM,
      TrustLevel.LOW,
      [],
      { capability: "file.read" },
    );
    loaded.getViewStore().recordPeerEvidence(peer.agentId, {
      id: "direct-1",
      kind: "peer_attestation",
      weight: 0.8,
      observedAt: new Date().toISOString(),
      sourceId: identity.agentId,
    });
    loaded.getViewStore().recordPropagatedEvidence(peer.agentId, {
      id: "prop-1",
      kind: "propagated",
      weight: 0.8,
      observedAt: new Date().toISOString(),
      sourceId: "intermediary",
      path: [identity.agentId, "x", peer.agentId],
    });
    const views = loaded.getEvidenceViews(peer.agentId);
    assert.ok(views.propagated.summaryWeight < views.peer.summaryWeight);

    const policy = evaluateTrustPolicy(
      [
        {
          id: "sev-1",
          severity: "severe",
          polarity: "negative",
          observedAtMs: Date.now(),
          capability: "file.read",
          confidence: 0.95,
          remediated: false,
          disputeStatus: "none",
        },
        ...Array.from({ length: 20 }, (_, i) => ({
          id: `ok-${i}`,
          severity: "routine" as const,
          polarity: "positive" as const,
          observedAtMs: Date.now(),
          capability: "file.read",
          confidence: 0.9,
          remediated: false,
          disputeStatus: "none" as const,
        })),
      ],
      { capability: "file.read", nowMs: Date.now() },
    );
    assert.ok(policy.severeFloorActive);
    assert.ok(policy.level <= TrustLevel.LOW);

    // Due process: challenge + remediation without deleting original evidence id
    const disputes = new DisputeLedger();
    const challenge = openChallenge(disputes, {
      evidenceId: "sev-1",
      subjectId: peer.agentId,
      claimantId: identity.agentId,
      reason: "false positive",
      respondBy: new Date(Date.now() + 86400000).toISOString(),
      signer: peer,
    });
    recordRemediation(disputes, {
      disputeId: challenge.disputeId,
      actions: "patched classifier",
      signer: peer,
    });
    recordRehabilitation(disputes, {
      disputeId: challenge.disputeId,
      scope: { capability: "file.read" },
      signer: identity,
      authorized: true,
    });
    resolveDispute(disputes, {
      disputeId: challenge.disputeId,
      outcome: "rehabilitated",
      signer: identity,
      authorized: true,
    });
    const caseAfter = disputes.get(challenge.disputeId)!;
    assert.equal(caseAfter.originalEvidenceId, "sev-1");
    assert.equal(caseAfter.status, "rehabilitated");
    assert.ok(caseAfter.records.length >= 3);

    // Key rotation continuity
    const keys = new KeyLifecycleLedger();
    loaded.updateAgentPublicKey(peer.agentId, peer.publicKeyHex);
    const newPeer = loadOrCreateIdentity("peer-new.key", ws.path);
    assert.equal(
      applyRotation(loaded, keys, {
        agentId: peer.agentId,
        oldPublicKeyHex: peer.publicKeyHex,
        newPublicKeyHex: newPeer.publicKeyHex,
        reason: "scheduled",
        atMs: Date.now(),
        signer: peer,
      }),
      true,
    );

    // Cluster mark + downgrade on key compromise
    const cluster = new GroupContextManager(loaded, identity.agentId);
    cluster.noteAgentJoined("thread-1", peer.agentId);
    cluster.markVerified("thread-1", peer.agentId, TrustLevel.MEDIUM, {
      validUntil: Date.now() + 60_000,
    });
    applyRevocation(keys, {
      agentId: peer.agentId,
      publicKeyHex: newPeer.publicKeyHex,
      reason: "compromise",
      compromisedAtMs: Date.now(),
      signer: identity,
    });
    cluster.downgradeMember("thread-1", peer.agentId, "key-compromise");
    const st = cluster.getClusterTrustState("thread-1");
    assert.ok(st!.unverifiedAgents.includes(peer.agentId));

    // Persist v2 again
    const ledger = new TrustEventLedger();
    await saveTrustGraph(graphPath, loaded, ws.path, { identity, ledger });
    const reloaded = loadTrustGraph(graphPath, ws.path, { identity });
    assert.ok(reloaded.getAgent(peer.agentId));
  });
});
