/**
 * End-to-end: quorum finalize → mandate store → unattended disposition allow
 * with authorization=quorum-mandate + budget debit.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { MandateStore } from "../plugin/src/mandate-store.ts";

import { loadOrCreateIdentity } from "../plugin-trust/src/identity.ts";
import { KeyLifecycleLedger } from "../plugin-trust/src/key-lifecycle.ts";
import { parseQuorumPolicyConfig } from "../plugin-trust/src/quorum-policy.ts";
import {
  QuorumSessionManager,
  computeIntendedMandateDigest,
  signQuorumBallot,
  signQuorumProposal,
} from "../plugin-trust/src/quorum-session.ts";

describe("quorum mandate e2e", () => {
  const dir = mkdtempSync(join(tmpdir(), "fpp-quorum-e2e-"));
  after(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("finalize → store → unattended allow + debit + quorum-mandate receipt", async () => {
    const mandateStorePath = join(dir, "shared-mandates.json");
    const clockMs = Date.parse("2026-07-10T12:00:00.000Z");
    const proposer = loadOrCreateIdentity("e2e-proposer.key", dir);
    const voterA = loadOrCreateIdentity("e2e-voter-a.key", dir);
    const voterB = loadOrCreateIdentity("e2e-voter-b.key", dir);

    const policy = parseQuorumPolicyConfig({
      peerThreshold: 2,
      stewardThreshold: 2,
      peerEligibleIds: [proposer.agentId, voterA.agentId, voterB.agentId],
      stewardEligibleIds: [],
    });
    const quorum = new QuorumSessionManager({
      policy,
      ledger: new KeyLifecycleLedger(),
      mandateStorePath,
      statePath: join(dir, "quorum-state.json"),
      nowMs: () => clockMs,
    });

    const scope = { classifications: ["pkg.install"] };
    const budgets = { maxActions: 2, remainingActions: 2 };
    const mandateDigest = computeIntendedMandateDigest({
      scope,
      budgets,
      mandateValidFrom: "2026-07-10T00:00:00.000Z",
      mandateValidTo: "2099-01-01T00:00:00.000Z",
    });

    const proposed = quorum.propose(
      signQuorumProposal(
        {
          schemaVersion: 1,
          proposalId: "e2e-quorum-1",
          quorumClass: "peer-quorum",
          proposerId: proposer.agentId,
          mandateDigest,
          scope,
          budgets,
          mandateValidFrom: "2026-07-10T00:00:00.000Z",
          mandateValidTo: "2099-01-01T00:00:00.000Z",
          proposedAt: new Date(clockMs).toISOString(),
          expiresAt: new Date(clockMs + 3_600_000).toISOString(),
        },
        proposer,
      ),
    );
    assert.equal(proposed.ok, true, proposed.ok ? "" : proposed.error);

    for (const [ballotId, voter] of [
      ["e2e-b-a", voterA],
      ["e2e-b-b", voterB],
    ] as const) {
      const seconded = quorum.second(
        signQuorumBallot(
          {
            schemaVersion: 1,
            ballotId,
            proposalId: "e2e-quorum-1",
            voterId: voter.agentId,
            vote: "aye",
            mandateDigest,
            castAt: new Date(clockMs).toISOString(),
          },
          voter,
        ),
      );
      assert.equal(seconded.ok, true, seconded.ok ? "" : seconded.error);
    }

    const fin = quorum.finalize("e2e-quorum-1", proposer);
    assert.equal(fin.ok, true, fin.ok ? "" : fin.error);
    if (!fin.ok) return;
    assert.equal(fin.mandate.issuerClass, "peer-quorum");
    assert.ok(existsSync(mandateStorePath), "mandate store file missing");

    const storeProbe = new MandateStore(mandateStorePath);
    const coverage = storeProbe.findCoverage("pkg.install", {
      nowMs: Date.now(),
    });
    assert.ok(
      coverage,
      `expected coverage; raw=${readFileSync(mandateStorePath, "utf8").slice(0, 240)}`,
    );
    assert.equal(coverage!.authorization, "quorum-mandate");
    assert.equal(coverage!.issuerClass, "peer-quorum");

    const {
      registerEnforcement,
      resetReceiptStore,
      resetStrictModeCache,
      getActiveReceiptStore,
    } = await import("../plugin/src/index.ts");
    const { createHookCapture } = await import("../plugin/src/test-helpers.ts");

    resetStrictModeCache();
    resetReceiptStore();
    const capture = createHookCapture({
      auditLogPath: join(dir, "audit.jsonl"),
      receiptLogPath: join(dir, "receipts.jsonl"),
      identityKeyPath: join(dir, "agent.key"),
      mandateStorePath,
      dispositionMode: "unattended",
      respectTrustStrictMode: false,
    });
    registerEnforcement(capture.api);
    const before = capture.hooks.find((h) => h.event === "before_tool_call")!
      .handler;
    const afterTool = capture.hooks.find((h) => h.event === "after_tool_call")
      ?.handler;

    const result = await before(
      {
        toolName: "shell_exec",
        params: { command: "npm install lodash" },
      },
      {
        agentId: "agent-q",
        runId: "run-q",
        sessionKey: "session-q",
        toolCallId: "call-quorum-mandate",
      },
    );
    assert.equal(result, undefined);

    if (afterTool) {
      await afterTool(
        {
          toolName: "shell_exec",
          params: { command: "npm install lodash" },
          result: { ok: true },
          error: undefined,
        },
        {
          agentId: "agent-q",
          runId: "run-q",
          sessionKey: "session-q",
          toolCallId: "call-quorum-mandate",
        },
      );
    }

    const reloaded = new MandateStore(mandateStorePath);
    assert.equal(reloaded.getRemaining(fin.mandate.mandateId), 1);

    const store = getActiveReceiptStore()!;
    const receipt = store.getFinalized("call-quorum-mandate");
    assert.ok(receipt, "expected finalized receipt after after_tool_call");
    assert.equal(receipt!.disposition, "allow");
    assert.equal(receipt!.authorization, "quorum-mandate");
  });
});
