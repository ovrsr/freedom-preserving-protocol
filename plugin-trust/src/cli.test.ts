/**
 * CLI steward-override constraints (Task 10).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createTempWorkspace } from "./test-helpers.js";
import { loadOrCreateIdentity } from "./identity.js";
import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";
import { registerFppTrustCli } from "./cli.js";

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
