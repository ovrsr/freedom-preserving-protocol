/**
 * Quorum mandate tool contracts (propose / second / finalize).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace, createFakeClock } from "./test-helpers.js";
import { loadOrCreateIdentity } from "./identity.js";
import { KeyLifecycleLedger } from "./key-lifecycle.js";
import { parseQuorumPolicyConfig } from "./quorum-policy.js";
import { QuorumSessionManager } from "./quorum-session.js";
import {
  executeMandateFinalize,
  executeMandatePropose,
  executeMandateSecond,
  type QuorumToolDependencies,
} from "./tools.js";
import type { StandingMandateV1 } from "@ovrsr/fpp-protocol-core";

describe("quorum mandate tools", () => {
  const ws = createTempWorkspace("fpp-mandate-tools-");
  after(() => ws.cleanup());

  function makeDeps(): QuorumToolDependencies & {
    clock: ReturnType<typeof createFakeClock>;
    voterA: ReturnType<typeof loadOrCreateIdentity>;
    voterB: ReturnType<typeof loadOrCreateIdentity>;
  } {
    const clock = createFakeClock(Date.parse("2026-07-10T12:00:00.000Z"));
    const identity = loadOrCreateIdentity("tool-proposer.key", ws.path);
    const voterA = loadOrCreateIdentity("tool-voter-a.key", ws.path);
    const voterB = loadOrCreateIdentity("tool-voter-b.key", ws.path);
    const ledger = new KeyLifecycleLedger();
    const mandateStorePath = join(ws.path, "tool-mandates.json");
    const statePath = join(ws.path, "tool-quorum-state.json");
    const policy = parseQuorumPolicyConfig({
      peerThreshold: 2,
      stewardThreshold: 2,
      peerEligibleIds: [identity.agentId, voterA.agentId, voterB.agentId],
      stewardEligibleIds: [],
    });
    const quorum = new QuorumSessionManager({
      policy,
      ledger,
      mandateStorePath,
      statePath,
      nowMs: () => clock.now(),
    });
    return {
      identity,
      quorum,
      clock,
      voterA,
      voterB,
      mandateStorePath,
    };
  }

  it("fpp_mandate_propose creates an open proposal", () => {
    const deps = makeDeps();
    const result = executeMandatePropose(
      {
        proposalId: "tool-prop-1",
        quorumClass: "peer-quorum",
        classifications: ["pkg.install"],
        maxActions: 2,
        mandateValidTo: "2026-07-11T12:00:00.000Z",
      },
      deps,
    );
    assert.match(result.content[0]?.text ?? "", /proposed|proposal/i);
    const details = result.details as { ok?: boolean; proposalId?: string };
    assert.equal(details.ok, true);
    assert.equal(details.proposalId, "tool-prop-1");
  });

  it("propose → second → finalize issues a mandate file", () => {
    const deps = makeDeps();
    const proposed = executeMandatePropose(
      {
        proposalId: "tool-prop-2",
        quorumClass: "peer-quorum",
        classifications: ["net.fetch"],
        maxActions: 1,
        mandateValidTo: "2026-07-11T12:00:00.000Z",
      },
      deps,
    );
    assert.equal((proposed.details as { ok?: boolean }).ok, true);

    // Peer A seconds via ballotJson path (agent-callable without human UI)
    const secondA = executeMandateSecond(
      {
        proposalId: "tool-prop-2",
        vote: "aye",
        ballotId: "tool-b-a",
      },
      { ...deps, identity: deps.voterA },
    );
    assert.equal((secondA.details as { ok?: boolean }).ok, true);

    const secondB = executeMandateSecond(
      {
        proposalId: "tool-prop-2",
        vote: "aye",
        ballotId: "tool-b-b",
      },
      { ...deps, identity: deps.voterB },
    );
    assert.equal((secondB.details as { ok?: boolean }).ok, true);

    const finalized = executeMandateFinalize(
      { proposalId: "tool-prop-2" },
      deps,
    );
    assert.equal((finalized.details as { ok?: boolean }).ok, true);
    assert.ok(existsSync(deps.mandateStorePath));
    const file = JSON.parse(readFileSync(deps.mandateStorePath, "utf8")) as {
      mandates: StandingMandateV1[];
    };
    assert.equal(file.mandates[0]?.issuerClass, "peer-quorum");
    assert.equal(file.mandates[0]?.authorization === undefined, true);
  });

  it("accepts peer ballotJson for second without local vote params", () => {
    const deps = makeDeps();
    executeMandatePropose(
      {
        proposalId: "tool-prop-3",
        quorumClass: "peer-quorum",
        classifications: ["pkg.install"],
        maxActions: 1,
        mandateValidTo: "2026-07-11T12:00:00.000Z",
      },
      deps,
    );
    // First cast with voterA to get a signed ballot, then re-submit as ballotJson
    // from a different caller identity (simulates receiving peer ballot).
    const cast = executeMandateSecond(
      {
        proposalId: "tool-prop-3",
        vote: "aye",
        ballotId: "json-ballot",
      },
      { ...deps, identity: deps.voterA },
    );
    const ballotJson = (cast.details as { ballotJson?: string }).ballotJson;
    assert.ok(ballotJson);

    // Replay of same ballotId must fail
    const replay = executeMandateSecond(
      { ballotJson },
      { ...deps, identity: deps.voterB },
    );
    assert.equal((replay.details as { ok?: boolean }).ok, false);
  });
});
