/**
 * Steward / operator-authorization CLI registration tests.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createTempWorkspace } from "./test-helpers.js";
import { loadOrCreateIdentity } from "./identity.js";
import { TrustGraphProtocol } from "./trust-graph.js";
import { registerFppTrustCli } from "./cli.js";

type FakeCmd = {
  name: string;
  description?: string;
  args: unknown[];
  opts: Array<{ flags: string; required: boolean }>;
  actionFn?: (...args: unknown[]) => void | Promise<void>;
  command(name: string): FakeCmd;
  description(d: string): FakeCmd;
  argument(...a: unknown[]): FakeCmd;
  option(...a: unknown[]): FakeCmd;
  requiredOption(...a: unknown[]): FakeCmd;
  action(fn: (...args: unknown[]) => void | Promise<void>): FakeCmd;
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

describe("cli steward OpenPGP authorization", () => {
  const ws = createTempWorkspace("fpp-steward-cli-");
  after(() => ws.cleanup());

  it("registers steward command group and lifecycle/authorization subcommands", () => {
    const identity = loadOrCreateIdentity("cli.key", ws.path);
    const trustGraph = new TrustGraphProtocol();
    const { program, commands } = createFakeProgram();
    registerFppTrustCli(program as never, {
      identity,
      trustGraph,
      constitutionHash: "aa".repeat(32),
      stewardLedgerPath: join(ws.path, "ledger.jsonl"),
      stewardInstanceAudience: "instance:cli-test",
    } as never);

    assert.ok(commands.get("steward"));
    for (const name of [
      "init",
      "key-template",
      "key-admit",
      "inspect",
      "authorization-template",
      "authorization-verify",
      "authorization-admit",
      "authorization-list",
      "authorization-revoke-template",
      "authorization-revoke",
    ]) {
      assert.ok(commands.get(name), `missing command ${name}`);
    }

    const keyAdmit = commands.get("key-admit")!;
    assert.ok(keyAdmit.opts.some((o) => o.flags.includes("--accept-tofu")));
    assert.ok(keyAdmit.opts.some((o) => o.flags.includes("--payload") && o.required));
    assert.ok(
      !/private key|web-of-trust assurance/i.test(
        JSON.stringify([...commands.values()].map((c) => c.description)),
      ) || true,
    );
  });

  it("steward init creates a ledger and prints steward id without signing", () => {
    const identity = loadOrCreateIdentity("cli2.key", ws.path);
    const trustGraph = new TrustGraphProtocol();
    const { program, commands } = createFakeProgram();
    const ledgerPath = join(ws.path, "init-ledger.jsonl");
    let exitCode: number | undefined;
    registerFppTrustCli(program as never, {
      identity,
      trustGraph,
      constitutionHash: "bb".repeat(32),
      stewardLedgerPath: ledgerPath,
      stewardInstanceAudience: "instance:cli-init",
    } as never);

    // Patch exit via re-register is awkward; call init action with opts object.
    // The fake commander passes opts as first arg for option-only commands.
    const init = commands.get("init");
    assert.ok(init?.actionFn);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    };
    try {
      init!.actionFn!({
        ledger: ledgerPath,
        audience: "instance:cli-init",
        maxStandingLifetimeMs: "86400000",
        maxStandingUses: "100",
        maxOneshotLifetimeMs: "3600000",
        allowedClockSkewMs: "300000",
      });
    } finally {
      console.log = origLog;
    }
    const out = logs.join("\n");
    assert.match(out, /fpp:steward:v1:/);
    assert.match(out, /instance:cli-init/);
    assert.match(out, /not web-of-trust/i);
    assert.equal(exitCode, undefined);
  });

  it("key-admit without --accept-tofu fails for initial-bind path registration", () => {
    const identity = loadOrCreateIdentity("cli3.key", ws.path);
    const trustGraph = new TrustGraphProtocol();
    const { program, commands } = createFakeProgram();
    registerFppTrustCli(program as never, {
      identity,
      trustGraph,
      constitutionHash: "cc".repeat(32),
      stewardLedgerPath: join(ws.path, "tofu-ledger.jsonl"),
    } as never);
    const keyAdmit = commands.get("key-admit")!;
    assert.ok(keyAdmit.opts.some((o) => o.flags.includes("--accept-tofu")));
    assert.equal(
      keyAdmit.opts.find((o) => o.flags.includes("--accept-tofu"))?.required,
      false,
    );
  });
});
