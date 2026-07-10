/**
 * RED/GREEN tests: self-assessed vs peer-assessed trust views must stay separate.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createTempWorkspace } from "./test-helpers.js";
import { loadOrCreateIdentity } from "./identity.js";
import { TrustGraphProtocol } from "./trust-graph.js";
import {
  TrustViewStore,
  computeViewDivergence,
  type EvidenceViewSummary,
} from "./trust-views.js";
import { buildTrustStateCapsule } from "./capsule.js";

describe("trust-views separation", () => {
  const ws = createTempWorkspace("fpp-trust-views-");
  after(() => ws.cleanup());

  it("self and peer evidence cannot overwrite each other", () => {
    const store = new TrustViewStore();
    store.recordSelfEvidence("agent-a", {
      id: "self-1",
      kind: "local_receipt",
      weight: 0.9,
      observedAt: "2026-07-10T00:00:00.000Z",
    });
    store.recordPeerEvidence("agent-a", {
      id: "peer-1",
      kind: "peer_attestation",
      weight: 0.2,
      observedAt: "2026-07-10T00:00:00.000Z",
      sourceId: "peer-b",
    });

    const self = store.getSelfView("agent-a");
    const peer = store.getPeerView("agent-a");
    assert.equal(self.evidenceCount, 1);
    assert.equal(peer.evidenceCount, 1);
    assert.notEqual(self.summaryWeight, peer.summaryWeight);

    // Peer update must not mutate self view
    store.recordPeerEvidence("agent-a", {
      id: "peer-2",
      kind: "peer_attestation",
      weight: 0.1,
      observedAt: "2026-07-10T01:00:00.000Z",
      sourceId: "peer-c",
    });
    assert.equal(store.getSelfView("agent-a").evidenceCount, 1);
    assert.equal(store.getPeerView("agent-a").evidenceCount, 2);
  });

  it("exposes divergence instead of averaging self and peer away", () => {
    const store = new TrustViewStore();
    store.recordSelfEvidence("agent-a", {
      id: "s1",
      kind: "local_receipt",
      weight: 0.95,
      observedAt: "2026-07-10T00:00:00.000Z",
    });
    store.recordPeerEvidence("agent-a", {
      id: "p1",
      kind: "peer_attestation",
      weight: 0.15,
      observedAt: "2026-07-10T00:00:00.000Z",
      sourceId: "peer-b",
    });

    const div = computeViewDivergence(
      store.getSelfView("agent-a"),
      store.getPeerView("agent-a"),
    );
    assert.ok(div.absoluteDelta > 0.5);
    assert.equal(div.averagedAway, false);
    assert.ok(div.explanation.includes("self"));
  });

  it("propagated peer summaries stay below direct peer and remain distinct", () => {
    const store = new TrustViewStore();
    store.recordPeerEvidence("agent-a", {
      id: "direct-1",
      kind: "peer_attestation",
      weight: 0.8,
      observedAt: "2026-07-10T00:00:00.000Z",
      sourceId: "peer-b",
    });
    store.recordPropagatedEvidence("agent-a", {
      id: "prop-1",
      kind: "propagated",
      weight: 0.8,
      observedAt: "2026-07-10T00:00:00.000Z",
      sourceId: "peer-c",
      path: ["local", "peer-c", "agent-a"],
    });

    const direct = store.getPeerView("agent-a");
    const propagated = store.getPropagatedView("agent-a");
    assert.ok(propagated.summaryWeight < direct.summaryWeight);
    assert.ok(propagated.ceilingApplied);
  });

  it("capsules include view summaries without a global intrinsic score", () => {
    const identity = loadOrCreateIdentity("id.key", ws.path);
    const store = new TrustViewStore();
    store.recordSelfEvidence(identity.agentId, {
      id: "s1",
      kind: "local_receipt",
      weight: 0.7,
      observedAt: "2026-07-10T00:00:00.000Z",
    });
    const summary: EvidenceViewSummary = store.getSelfView(identity.agentId);
    const capsule = buildTrustStateCapsule({
      identity,
      runtimeId: "rt-1",
      implementationVersion: "1.0.0",
      evidenceRoot: "aa".repeat(32),
      coverageMetrics: {
        metricVersion: 1,
        finalizedReceipts: 1,
        completeness: "partial",
      },
      freshness: {
        issuedAt: "2026-07-10T00:00:00.000Z",
        expiresAt: "2026-07-10T01:00:00.000Z",
        challengeNonce: "n1",
        audience: "peer",
      },
      view: "self",
      viewSummaries: {
        self: summary,
        peer: store.getPeerView(identity.agentId),
        propagated: store.getPropagatedView(identity.agentId),
        divergence: computeViewDivergence(
          summary,
          store.getPeerView(identity.agentId),
        ),
      },
    });

    assert.ok(capsule.viewSummaries);
    assert.equal(capsule.viewSummaries.self.channel, "self");
    assert.equal(
      (capsule as { globalScore?: number }).globalScore,
      undefined,
    );
  });

  it("trust graph updateReputation no longer merges into a single intrinsic score path for views", () => {
    const g = new TrustGraphProtocol();
    g.addAgent("a", "h");
    const views = g.getViewStore();
    views.recordSelfEvidence("a", {
      id: "s1",
      kind: "local_receipt",
      weight: 0.9,
      observedAt: "2026-07-10T00:00:00.000Z",
    });
    g.updateReputation("a", "negative", { reliability: 0.1 });
    // Legacy reputation may still update for compat, but views stay separate
    assert.equal(views.getSelfView("a").evidenceCount, 1);
    assert.equal(views.getPeerView("a").evidenceCount, 0);
  });
});
