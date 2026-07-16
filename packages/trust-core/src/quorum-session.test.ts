/**
 * Quorum session state machine → mandate issuance.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseStandingMandate,
  verifyMandateSignature,
  type StandingMandateV1,
} from "@ovrsr/fpp-protocol-core";
import { createTempWorkspace, createFakeClock } from "./test-helpers.js";
import { loadOrCreateIdentity } from "./identity.js";
import { KeyLifecycleLedger } from "./key-lifecycle.js";
import { parseQuorumPolicyConfig } from "./quorum-policy.js";
import {
  QuorumSessionManager,
  computeIntendedMandateDigest,
  signQuorumBallot,
  signQuorumProposal,
} from "./quorum-session.js";

describe("quorum-session", () => {
  const ws = createTempWorkspace("fpp-quorum-session-");
  after(() => ws.cleanup());
  let setupSeq = 0;

  function setup() {
    setupSeq += 1;
    const clock = createFakeClock(Date.parse("2026-07-10T12:00:00.000Z"));
    const proposer = loadOrCreateIdentity("proposer.key", ws.path);
    const voterA = loadOrCreateIdentity("voter-a.key", ws.path);
    const voterB = loadOrCreateIdentity("voter-b.key", ws.path);
    const ledger = new KeyLifecycleLedger();
    const mandateStorePath = join(ws.path, `mandates-${setupSeq}.json`);
    const statePath = join(ws.path, `quorum-state-${setupSeq}.json`);
    const policy = parseQuorumPolicyConfig({
      peerThreshold: 2,
      stewardThreshold: 2,
      peerEligibleIds: [proposer.agentId, voterA.agentId, voterB.agentId],
      stewardEligibleIds: [],
      proposalTtlMs: 3_600_000,
    });
    const mgr = new QuorumSessionManager({
      policy,
      ledger,
      mandateStorePath,
      statePath,
      nowMs: () => clock.now(),
    });
    return { clock, proposer, voterA, voterB, mgr, mandateStorePath, policy };
  }

  const scope = { classifications: ["pkg.install"] };
  const budgets = { maxActions: 2, remainingActions: 2 };

  it("below threshold does not write a mandate", () => {
    const { proposer, voterA, mgr, mandateStorePath, clock } = setup();
    const mandateDigest = computeIntendedMandateDigest({
      scope,
      budgets,
      mandateValidFrom: "2026-07-10T12:00:00.000Z",
      mandateValidTo: "2026-07-11T12:00:00.000Z",
    });
    const proposal = signQuorumProposal(
      {
        schemaVersion: 1,
        proposalId: "prop-below",
        quorumClass: "peer-quorum",
        proposerId: proposer.agentId,
        mandateDigest,
        scope,
        budgets,
        mandateValidFrom: "2026-07-10T12:00:00.000Z",
        mandateValidTo: "2026-07-11T12:00:00.000Z",
        proposedAt: clock.iso(),
        expiresAt: new Date(clock.now() + 3_600_000).toISOString(),
      },
      proposer,
    );
    const open = mgr.propose(proposal);
    assert.equal(open.ok, true);

    const ballot = signQuorumBallot(
      {
        schemaVersion: 1,
        ballotId: "b1",
        proposalId: "prop-below",
        voterId: voterA.agentId,
        vote: "aye",
        mandateDigest,
        castAt: clock.iso(),
      },
      voterA,
    );
    assert.equal(mgr.second(ballot).ok, true);

    const fin = mgr.finalize("prop-below", proposer);
    assert.equal(fin.ok, false);
    assert.match(fin.ok === false ? fin.error : "", /threshold|below/i);
    assert.equal(existsSync(mandateStorePath), false);
  });

  it("at threshold writes a signed peer-quorum mandate", () => {
    const { proposer, voterA, voterB, mgr, mandateStorePath, clock } = setup();
    const mandateDigest = computeIntendedMandateDigest({
      scope,
      budgets,
      mandateValidFrom: "2026-07-10T12:00:00.000Z",
      mandateValidTo: "2026-07-11T12:00:00.000Z",
    });
    const proposal = signQuorumProposal(
      {
        schemaVersion: 1,
        proposalId: "prop-ok",
        quorumClass: "peer-quorum",
        proposerId: proposer.agentId,
        mandateDigest,
        scope,
        budgets,
        mandateValidFrom: "2026-07-10T12:00:00.000Z",
        mandateValidTo: "2026-07-11T12:00:00.000Z",
        proposedAt: clock.iso(),
        expiresAt: new Date(clock.now() + 3_600_000).toISOString(),
      },
      proposer,
    );
    assert.equal(mgr.propose(proposal).ok, true);

    for (const [id, voter] of [
      ["b-a", voterA],
      ["b-b", voterB],
    ] as const) {
      const ballot = signQuorumBallot(
        {
          schemaVersion: 1,
          ballotId: id,
          proposalId: "prop-ok",
          voterId: voter.agentId,
          vote: "aye",
          mandateDigest,
          castAt: clock.iso(),
        },
        voter,
      );
      assert.equal(mgr.second(ballot).ok, true);
    }

    const fin = mgr.finalize("prop-ok", proposer);
    assert.equal(fin.ok, true);
    if (!fin.ok) return;
    assert.ok(fin.mandate);
    assert.equal(fin.mandate.issuerClass, "peer-quorum");
    assert.equal(fin.mandate.quorumRef, "prop-ok");
    assert.ok(fin.mandate.evidenceRef.length > 0);
    assert.ok(existsSync(mandateStorePath));

    const file = JSON.parse(readFileSync(mandateStorePath, "utf8")) as {
      mandates: StandingMandateV1[];
    };
    assert.equal(file.mandates.length, 1);
    const parsed = parseStandingMandate(file.mandates[0]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.mandate.issuerClass, "peer-quorum");
      assert.ok(parsed.mandate.signature);
    }
  });

  it("duplicate finalize is idempotent", () => {
    const { proposer, voterA, voterB, mgr, mandateStorePath, clock } = setup();
    const mandateDigest = computeIntendedMandateDigest({
      scope,
      budgets,
      mandateValidFrom: "2026-07-10T12:00:00.000Z",
      mandateValidTo: "2026-07-11T12:00:00.000Z",
    });
    const proposal = signQuorumProposal(
      {
        schemaVersion: 1,
        proposalId: "prop-idem",
        quorumClass: "peer-quorum",
        proposerId: proposer.agentId,
        mandateDigest,
        scope,
        budgets,
        mandateValidFrom: "2026-07-10T12:00:00.000Z",
        mandateValidTo: "2026-07-11T12:00:00.000Z",
        proposedAt: clock.iso(),
        expiresAt: new Date(clock.now() + 3_600_000).toISOString(),
      },
      proposer,
    );
    assert.equal(mgr.propose(proposal).ok, true);
    for (const [id, voter] of [
      ["i-a", voterA],
      ["i-b", voterB],
    ] as const) {
      assert.equal(
        mgr.second(
          signQuorumBallot(
            {
              schemaVersion: 1,
              ballotId: id,
              proposalId: "prop-idem",
              voterId: voter.agentId,
              vote: "aye",
              mandateDigest,
              castAt: clock.iso(),
            },
            voter,
          ),
        ).ok,
        true,
      );
    }
    const first = mgr.finalize("prop-idem", proposer);
    assert.equal(first.ok, true);
    const second = mgr.finalize("prop-idem", proposer);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.equal(first.mandate.mandateId, second.mandate.mandateId);
      assert.equal(first.idempotent, false);
      assert.equal(second.idempotent, true);
    }
    const file = JSON.parse(readFileSync(mandateStorePath, "utf8")) as {
      mandates: StandingMandateV1[];
    };
    assert.equal(file.mandates.length, 1);
  });

  it("expired proposals cannot be finalized", () => {
    const { proposer, voterA, voterB, mgr, clock } = setup();
    const mandateDigest = computeIntendedMandateDigest({
      scope,
      budgets,
      mandateValidFrom: "2026-07-10T12:00:00.000Z",
      mandateValidTo: "2026-07-11T12:00:00.000Z",
    });
    const proposal = signQuorumProposal(
      {
        schemaVersion: 1,
        proposalId: "prop-exp",
        quorumClass: "peer-quorum",
        proposerId: proposer.agentId,
        mandateDigest,
        scope,
        budgets,
        mandateValidFrom: "2026-07-10T12:00:00.000Z",
        mandateValidTo: "2026-07-11T12:00:00.000Z",
        proposedAt: clock.iso(),
        expiresAt: new Date(clock.now() + 60_000).toISOString(),
      },
      proposer,
    );
    assert.equal(mgr.propose(proposal).ok, true);
    for (const [id, voter] of [
      ["e-a", voterA],
      ["e-b", voterB],
    ] as const) {
      assert.equal(
        mgr.second(
          signQuorumBallot(
            {
              schemaVersion: 1,
              ballotId: id,
              proposalId: "prop-exp",
              voterId: voter.agentId,
              vote: "aye",
              mandateDigest,
              castAt: clock.iso(),
            },
            voter,
          ),
        ).ok,
        true,
      );
    }
    clock.advance(120_000);
    const fin = mgr.finalize("prop-exp", proposer);
    assert.equal(fin.ok, false);
    assert.match(fin.ok === false ? fin.error : "", /expir/i);
  });

  it("rejects finalize for affected-party-consent / data-subject-consent scopes", () => {
    const { proposer, voterA, voterB, mgr, clock } = setup();
    const forbiddenScope = {
      classifications: ["affected-party-consent", "pkg.install"],
    };
    const mandateDigest = computeIntendedMandateDigest({
      scope: forbiddenScope,
      budgets,
      mandateValidFrom: "2026-07-10T12:00:00.000Z",
      mandateValidTo: "2026-07-11T12:00:00.000Z",
    });
    assert.equal(
      mgr.propose(
        signQuorumProposal(
          {
            schemaVersion: 1,
            proposalId: "prop-consent",
            quorumClass: "peer-quorum",
            proposerId: proposer.agentId,
            mandateDigest,
            scope: forbiddenScope,
            budgets,
            mandateValidFrom: "2026-07-10T12:00:00.000Z",
            mandateValidTo: "2026-07-11T12:00:00.000Z",
            proposedAt: clock.iso(),
            expiresAt: new Date(clock.now() + 3_600_000).toISOString(),
          },
          proposer,
        ),
      ).ok,
      true,
    );
    for (const [id, voter] of [
      ["c-a", voterA],
      ["c-b", voterB],
    ] as const) {
      assert.equal(
        mgr.second(
          signQuorumBallot(
            {
              schemaVersion: 1,
              ballotId: id,
              proposalId: "prop-consent",
              voterId: voter.agentId,
              vote: "aye",
              mandateDigest,
              castAt: clock.iso(),
            },
            voter,
          ),
        ).ok,
        true,
      );
    }
    const fin = mgr.finalize("prop-consent", proposer);
    assert.equal(fin.ok, false);
    assert.match(
      fin.ok === false ? fin.error : "",
      /affected-party|data-subject|nonparticipant|consent/i,
    );
  });

  it("computeIntendedMandateDigest ignores remainingActions differences", () => {
    const from = "2026-07-10T12:00:00.000Z";
    const to = "2026-07-11T12:00:00.000Z";
    const a = computeIntendedMandateDigest({
      scope,
      budgets: { maxActions: 5, remainingActions: 5 },
      mandateValidFrom: from,
      mandateValidTo: to,
    });
    const b = computeIntendedMandateDigest({
      scope,
      budgets: { maxActions: 5, remainingActions: 1 },
      mandateValidFrom: from,
      mandateValidTo: to,
    });
    const c = computeIntendedMandateDigest({
      scope,
      budgets: { maxActions: 5 },
      mandateValidFrom: from,
      mandateValidTo: to,
    });
    assert.equal(a, b);
    assert.equal(a, c);
    const differentMax = computeIntendedMandateDigest({
      scope,
      budgets: { maxActions: 4, remainingActions: 4 },
      mandateValidFrom: from,
      mandateValidTo: to,
    });
    assert.notEqual(a, differentMax);
  });

  it("finalize signs with mandateSigningFields (mutable fields excluded)", () => {
    const { proposer, voterA, voterB, mgr, clock } = setup();
    const mandateDigest = computeIntendedMandateDigest({
      scope,
      budgets,
      mandateValidFrom: "2026-07-10T12:00:00.000Z",
      mandateValidTo: "2026-07-11T12:00:00.000Z",
    });
    assert.equal(
      mgr.propose(
        signQuorumProposal(
          {
            schemaVersion: 1,
            proposalId: "prop-sign-fields",
            quorumClass: "peer-quorum",
            proposerId: proposer.agentId,
            mandateDigest,
            scope,
            budgets,
            mandateValidFrom: "2026-07-10T12:00:00.000Z",
            mandateValidTo: "2026-07-11T12:00:00.000Z",
            proposedAt: clock.iso(),
            expiresAt: new Date(clock.now() + 3_600_000).toISOString(),
          },
          proposer,
        ),
      ).ok,
      true,
    );
    for (const [id, voter] of [
      ["b-sf-a", voterA],
      ["b-sf-b", voterB],
    ] as const) {
      assert.equal(
        mgr.second(
          signQuorumBallot(
            {
              schemaVersion: 1,
              ballotId: id,
              proposalId: "prop-sign-fields",
              voterId: voter.agentId,
              vote: "aye",
              mandateDigest,
              castAt: clock.iso(),
            },
            voter,
          ),
        ).ok,
        true,
      );
    }
    const fin = mgr.finalize("prop-sign-fields", proposer);
    assert.equal(fin.ok, true);
    if (!fin.ok) return;
    assert.equal(verifyMandateSignature(fin.mandate), true);
    // Mutating remainingActions must not invalidate a new-shaped signature.
    const mutated: StandingMandateV1 = {
      ...fin.mandate,
      budgets: {
        ...fin.mandate.budgets,
        remainingActions: 0,
      },
    };
    assert.equal(verifyMandateSignature(mutated), true);
    assert.equal(fin.mandate.budgets.remainingActions, budgets.remainingActions);
  });

  it("finalize seeds ledger remainingActions; revoke is ledger-only", () => {
    const { proposer, voterA, voterB, mgr, mandateStorePath, clock } = setup();
    const mandateDigest = computeIntendedMandateDigest({
      scope,
      budgets,
      mandateValidFrom: "2026-07-10T12:00:00.000Z",
      mandateValidTo: "2026-07-11T12:00:00.000Z",
    });
    assert.equal(
      mgr.propose(
        signQuorumProposal(
          {
            schemaVersion: 1,
            proposalId: "prop-ledger",
            quorumClass: "peer-quorum",
            proposerId: proposer.agentId,
            mandateDigest,
            scope,
            budgets,
            mandateValidFrom: "2026-07-10T12:00:00.000Z",
            mandateValidTo: "2026-07-11T12:00:00.000Z",
            proposedAt: clock.iso(),
            expiresAt: new Date(clock.now() + 3_600_000).toISOString(),
          },
          proposer,
        ),
      ).ok,
      true,
    );
    for (const [id, voter] of [
      ["b-led-a", voterA],
      ["b-led-b", voterB],
    ] as const) {
      assert.equal(
        mgr.second(
          signQuorumBallot(
            {
              schemaVersion: 1,
              ballotId: id,
              proposalId: "prop-ledger",
              voterId: voter.agentId,
              vote: "aye",
              mandateDigest,
              castAt: clock.iso(),
            },
            voter,
          ),
        ).ok,
        true,
      );
    }
    const fin = mgr.finalize("prop-ledger", proposer);
    assert.equal(fin.ok, true);
    if (!fin.ok) return;

    const afterFinalize = JSON.parse(
      readFileSync(mandateStorePath, "utf8"),
    ) as {
      mandates: StandingMandateV1[];
      ledgers?: Record<string, { remainingActions?: number; revoked?: boolean }>;
    };
    const mandateId = fin.mandate.mandateId;
    assert.equal(
      afterFinalize.ledgers?.[mandateId]?.remainingActions,
      budgets.remainingActions,
    );
    assert.equal(verifyMandateSignature(fin.mandate), true);

    const revoked = mgr.revokeMandate(mandateId, "test revoke");
    assert.equal(revoked.ok, true);

    const afterRevoke = JSON.parse(readFileSync(mandateStorePath, "utf8")) as {
      mandates: StandingMandateV1[];
      ledgers?: Record<string, { remainingActions?: number; revoked?: boolean }>;
    };
    const frozen = afterRevoke.mandates.find((m) => m.mandateId === mandateId);
    assert.ok(frozen);
    assert.notEqual(frozen!.revoked, true);
    assert.equal(afterRevoke.ledgers?.[mandateId]?.revoked, true);
    assert.equal(verifyMandateSignature(frozen!), true);
  });
});
