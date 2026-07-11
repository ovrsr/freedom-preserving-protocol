/**
 * CLI steward-override constraints (Task 10) and quorum CLI (Plan 9).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace } from "./test-helpers.js";
import { loadOrCreateIdentity } from "./identity.js";
import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";
import { registerFppTrustCli } from "./cli.js";
import { KeyLifecycleLedger } from "./key-lifecycle.js";
import { parseQuorumPolicyConfig } from "./quorum-policy.js";
import {
  QuorumSessionManager,
  computeIntendedMandateDigest,
  signQuorumBallot,
  signQuorumProposal,
} from "./quorum-session.js";

type FakeCmd = {
  name: string;
  description?: string;
  args: unknown[];
  opts: Array<{ flags: string; required: boolean }>;
  actionFn?: (...args: unknown[]) => void;
  command(name: string): FakeCmd;
  description(d: string): FakeCmd;
  argument(...a: unknown[]): FakeCmd;
  option(...a: unknown[]): FakeCmd;
  requiredOption(...a: unknown[]): FakeCmd;
  action(fn: (...args: unknown[]) => void): FakeCmd;
};

function createFakeProgram() {
  const commands = new Map<string, FakeCmd>();
  const make = (name: string): FakeCmd => {
    const cmd: FakeCmd = {
      name,
      args: [],
      opts: [],
      command(n: string) {
        const child = make(n);
        commands.set(n, child);
        return child;
      },
      description(d: string) {
        cmd.description = d;
        return cmd;
      },
      argument(...a: unknown[]) {
        cmd.args.push(a);
        return cmd;
      },
      option(flags: string) {
        cmd.opts.push({ flags, required: false });
        return cmd;
      },
      requiredOption(flags: string) {
        cmd.opts.push({ flags, required: true });
        return cmd;
      },
      action(fn) {
        cmd.actionFn = fn;
        return cmd;
      },
    };
    return cmd;
  };
  const root = make("program");
  return {
    program: {
      command: (n: string) => root.command(n),
    },
    commands,
  };
}

describe("cli steward-override", () => {
  const ws = createTempWorkspace("fpp-cli-");
  after(() => ws.cleanup());

  it("registers steward-override with required reason/capability/expires and deprecates seed", () => {
    const identity = loadOrCreateIdentity("cli.key", ws.path);
    const trustGraph = new TrustGraphProtocol();
    const { program, commands } = createFakeProgram();
    registerFppTrustCli(program as never, {
      identity,
      trustGraph,
      constitutionHash: "aa".repeat(32),
    } as never);

    const override = commands.get("steward-override");
    assert.ok(override);
    assert.ok(override!.opts.some((o) => o.flags.includes("--reason") && o.required));
    assert.ok(
      override!.opts.some((o) => o.flags.includes("--capability") && o.required),
    );
    assert.ok(override!.opts.some((o) => o.flags.includes("--expires") && o.required));

    const seed = commands.get("seed");
    assert.ok(seed);
    assert.ok(seed!.description?.toLowerCase().includes("deprecated"));
  });

  it("records a bounded steward override distinct from observed trust", () => {
    const identity = loadOrCreateIdentity("cli2.key", ws.path);
    const trustGraph = new TrustGraphProtocol();
    trustGraph.addAgent(identity.agentId, "h");
    const peer = loadOrCreateIdentity("peer.key", ws.path);
    const expires = new Date(Date.now() + 3600_000).toISOString();

    trustGraph.addAgent(peer.agentId, "h");
    trustGraph.updateAgentPublicKey(peer.agentId, peer.publicKeyHex);
    trustGraph.recordScopedAssessment({
      from: identity.agentId,
      to: peer.agentId,
      scope: {
        capability: "handshake",
        resource: "*",
        audience: "*",
        environment: "*",
      },
      level: TrustLevel.HIGH,
      confidence: 0.5,
      validFrom: Date.now(),
      validUntil: Date.parse(expires),
      source: "steward-override",
      rationale: "operator assertion: bootstrap",
    });

    const listed = trustGraph
      .getScopedStore()
      .list()
      .filter((a) => a.source === "steward-override");
    assert.equal(listed.length, 1);
    assert.ok(listed[0]!.rationale?.includes("operator assertion"));
    assert.ok(listed[0]!.validUntil > Date.now());
    assert.notEqual(listed[0]!.source, "direct");
  });
});

describe("cli quorum-status / quorum-revoke-mandate", () => {
  const ws = createTempWorkspace("fpp-cli-quorum-");
  after(() => ws.cleanup());

  it("registers quorum-status and quorum-revoke-mandate commands", () => {
    const identity = loadOrCreateIdentity("cli-q.key", ws.path);
    const trustGraph = new TrustGraphProtocol();
    const { program, commands } = createFakeProgram();
    registerFppTrustCli(program as never, {
      identity,
      trustGraph,
      constitutionHash: "aa".repeat(32),
    } as never);

    assert.ok(commands.get("quorum-status"));
    assert.ok(commands.get("quorum-revoke-mandate"));
    const revoke = commands.get("quorum-revoke-mandate");
    assert.ok(
      revoke!.opts.some((o) => o.flags.includes("--reason") && o.required),
    );
  });

  it("quorum-status lists open and finalized sessions", () => {
    const identity = loadOrCreateIdentity("cli-q2.key", ws.path);
    const trustGraph = new TrustGraphProtocol();

    const clockMs = Date.parse("2026-07-10T12:00:00.000Z");
    const policy = parseQuorumPolicyConfig({
      peerThreshold: 1,
      stewardThreshold: 1,
      peerEligibleIds: [identity.agentId],
      stewardEligibleIds: [identity.agentId],
    });
    const quorum = new QuorumSessionManager({
      policy,
      ledger: new KeyLifecycleLedger(),
      mandateStorePath: join(ws.path, "cli-mandates.json"),
      statePath: join(ws.path, "cli-quorum.json"),
      nowMs: () => clockMs,
    });
    const digest = computeIntendedMandateDigest({
      scope: { classifications: ["pkg.install"] },
      budgets: { maxActions: 1, remainingActions: 1 },
      mandateValidFrom: "2026-07-10T12:00:00.000Z",
      mandateValidTo: "2026-07-11T12:00:00.000Z",
    });
    assert.equal(
      quorum.propose(
        signQuorumProposal(
          {
            schemaVersion: 1,
            proposalId: "cli-prop",
            quorumClass: "steward-quorum",
            proposerId: identity.agentId,
            mandateDigest: digest,
            scope: { classifications: ["pkg.install"] },
            budgets: { maxActions: 1, remainingActions: 1 },
            mandateValidFrom: "2026-07-10T12:00:00.000Z",
            mandateValidTo: "2026-07-11T12:00:00.000Z",
            proposedAt: new Date(clockMs).toISOString(),
            expiresAt: new Date(clockMs + 3_600_000).toISOString(),
          },
          identity,
        ),
      ).ok,
      true,
    );
    assert.equal(
      quorum.second(
        signQuorumBallot(
          {
            schemaVersion: 1,
            ballotId: "cli-b1",
            proposalId: "cli-prop",
            voterId: identity.agentId,
            vote: "aye",
            mandateDigest: digest,
            castAt: new Date(clockMs).toISOString(),
          },
          identity,
        ),
      ).ok,
      true,
    );
    assert.equal(quorum.finalize("cli-prop", identity).ok, true);

    const { program, commands } = createFakeProgram();
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      registerFppTrustCli(program as never, {
        identity,
        trustGraph,
        constitutionHash: "aa".repeat(32),
        quorum,
      } as never);
      commands.get("quorum-status")!.actionFn!();
    } finally {
      console.log = origLog;
    }
    const out = logs.join("\n");
    assert.match(out, /cli-prop/);
    assert.match(out, /steward-quorum|finalized/i);
  });

  it("quorum-revoke-mandate revokes without minting peer-signed mandates via steward-override", () => {
    const identity = loadOrCreateIdentity("cli-q3.key", ws.path);
    const trustGraph = new TrustGraphProtocol();

    const clockMs = Date.parse("2026-07-10T12:00:00.000Z");
    const mandateStorePath = join(ws.path, "cli-mandates-revoke.json");
    const policy = parseQuorumPolicyConfig({
      peerThreshold: 1,
      stewardThreshold: 1,
      peerEligibleIds: [],
      stewardEligibleIds: [identity.agentId],
    });
    const quorum = new QuorumSessionManager({
      policy,
      ledger: new KeyLifecycleLedger(),
      mandateStorePath,
      statePath: join(ws.path, "cli-quorum-revoke.json"),
      nowMs: () => clockMs,
    });
    const digest = computeIntendedMandateDigest({
      scope: { classifications: ["pkg.install"] },
      budgets: { maxActions: 1, remainingActions: 1 },
      mandateValidFrom: "2026-07-10T12:00:00.000Z",
      mandateValidTo: "2026-07-11T12:00:00.000Z",
    });
    quorum.propose(
      signQuorumProposal(
        {
          schemaVersion: 1,
          proposalId: "rev-prop",
          quorumClass: "steward-quorum",
          proposerId: identity.agentId,
          mandateDigest: digest,
          scope: { classifications: ["pkg.install"] },
          budgets: { maxActions: 1, remainingActions: 1 },
          mandateValidFrom: "2026-07-10T12:00:00.000Z",
          mandateValidTo: "2026-07-11T12:00:00.000Z",
          proposedAt: new Date(clockMs).toISOString(),
          expiresAt: new Date(clockMs + 3_600_000).toISOString(),
        },
        identity,
      ),
    );
    quorum.second(
      signQuorumBallot(
        {
          schemaVersion: 1,
          ballotId: "rev-b1",
          proposalId: "rev-prop",
          voterId: identity.agentId,
          vote: "aye",
          mandateDigest: digest,
          castAt: new Date(clockMs).toISOString(),
        },
        identity,
      ),
    );
    const fin = quorum.finalize("rev-prop", identity);
    assert.equal(fin.ok, true);
    if (!fin.ok) return;

    const { program, commands } = createFakeProgram();
    registerFppTrustCli(program as never, {
      identity,
      trustGraph,
      constitutionHash: "aa".repeat(32),
      quorum,
    } as never);

    commands.get("quorum-revoke-mandate")!.actionFn!(fin.mandate.mandateId, {
      reason: "operator recall",
    });

    const file = JSON.parse(readFileSync(mandateStorePath, "utf8")) as {
      mandates: Array<{ revoked?: boolean; issuerClass: string }>;
    };
    assert.equal(file.mandates[0]?.revoked, true);
    assert.equal(file.mandates[0]?.issuerClass, "steward-quorum");
    // steward-override must remain a separate path — no silent peer-mandate mint
    const overrides = trustGraph
      .getScopedStore()
      .list()
      .filter((a) => a.source === "steward-override");
    assert.equal(overrides.length, 0);
  });
});
