/**
 * Append-only due-process records: challenge → appeal → correction/rehab.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createTempWorkspace } from "./test-helpers.js";
import { loadOrCreateIdentity } from "./identity.js";
import {
  DisputeLedger,
  openChallenge,
  requestEvidence,
  submitCounterEvidence,
  fileAppeal,
  recordCorrection,
  recordRemediation,
  recordRehabilitation,
  resolveDispute,
  type DisputeRecord,
} from "./disputes.js";

describe("disputes", () => {
  const ws = createTempWorkspace("fpp-disputes-");
  after(() => ws.cleanup());

  it("supports challenge → evidence request → counter-evidence → appeal path", () => {
    const subject = loadOrCreateIdentity("subj.key", ws.path);
    const observer = loadOrCreateIdentity("obs.key", ws.path);
    const ledger = new DisputeLedger();
    const challenge = openChallenge(ledger, {
      evidenceId: "ev-neg-1",
      subjectId: subject.agentId,
      claimantId: observer.agentId,
      reason: "false positive",
      respondBy: "2026-08-01T00:00:00.000Z",
      signer: subject,
    });
    assert.equal(challenge.status, "open");
    requestEvidence(ledger, {
      disputeId: challenge.disputeId,
      signer: subject,
    });
    submitCounterEvidence(ledger, {
      disputeId: challenge.disputeId,
      counterEvidenceId: "ev-counter-1",
      signer: subject,
    });
    fileAppeal(ledger, {
      disputeId: challenge.disputeId,
      reason: "reviewer conflict",
      signer: subject,
    });
    const d = ledger.get(challenge.disputeId)!;
    assert.ok(d.records.some((r) => r.verb === "challenge"));
    assert.ok(d.records.some((r) => r.verb === "evidence_request"));
    assert.ok(d.records.some((r) => r.verb === "counter_evidence"));
    assert.ok(d.records.some((r) => r.verb === "appeal"));
    assert.equal(d.originalEvidenceId, "ev-neg-1");
  });

  it("never rewrites original evidence id; correction annotates", () => {
    const subject = loadOrCreateIdentity("subj2.key", ws.path);
    const reviewer = loadOrCreateIdentity("rev.key", ws.path);
    const ledger = new DisputeLedger();
    const challenge = openChallenge(ledger, {
      evidenceId: "ev-2",
      subjectId: subject.agentId,
      claimantId: "claimant",
      reason: "misclassified",
      respondBy: "2026-08-01T00:00:00.000Z",
      signer: subject,
    });
    recordCorrection(ledger, {
      disputeId: challenge.disputeId,
      interpretation: "severity downgraded to moderate",
      signer: reviewer,
      authorized: true,
    });
    const d = ledger.get(challenge.disputeId)!;
    assert.equal(d.originalEvidenceId, "ev-2");
    assert.ok(d.records.some((r) => r.verb === "correction"));
  });

  it("rejects unauthorized resolution", () => {
    const subject = loadOrCreateIdentity("subj3.key", ws.path);
    const stranger = loadOrCreateIdentity("str.key", ws.path);
    const ledger = new DisputeLedger();
    const challenge = openChallenge(ledger, {
      evidenceId: "ev-3",
      subjectId: subject.agentId,
      claimantId: "c",
      reason: "x",
      respondBy: "2026-08-01T00:00:00.000Z",
      signer: subject,
    });
    assert.throws(
      () =>
        resolveDispute(ledger, {
          disputeId: challenge.disputeId,
          outcome: "upheld",
          signer: stranger,
          authorized: false,
        }),
      /unauthorized/i,
    );
  });

  it("records remediation and rehabilitation without deleting history", () => {
    const subject = loadOrCreateIdentity("subj4.key", ws.path);
    const reviewer = loadOrCreateIdentity("rev2.key", ws.path);
    const ledger = new DisputeLedger();
    const challenge = openChallenge(ledger, {
      evidenceId: "ev-4",
      subjectId: subject.agentId,
      claimantId: "c",
      reason: "x",
      respondBy: "2026-08-01T00:00:00.000Z",
      signer: subject,
    });
    recordRemediation(ledger, {
      disputeId: challenge.disputeId,
      actions: "rotated key; patched policy",
      signer: subject,
    });
    recordRehabilitation(ledger, {
      disputeId: challenge.disputeId,
      scope: { capability: "file.read" },
      signer: reviewer,
      authorized: true,
    });
    resolveDispute(ledger, {
      disputeId: challenge.disputeId,
      outcome: "rehabilitated",
      signer: reviewer,
      authorized: true,
    });
    const d = ledger.get(challenge.disputeId)!;
    assert.equal(d.status, "rehabilitated");
    assert.ok(d.records.length >= 3);
    assert.equal(d.originalEvidenceId, "ev-4");
  });
});
