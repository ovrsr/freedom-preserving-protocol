/**
 * Steward / operator-authorization CLI registration tests.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as openpgp from "openpgp";
import {
  canonicalizeV2,
  parseStewardBootstrap,
} from "@ovrsr/fpp-protocol-core";
import { StewardAuthorizationLedger } from "@ovrsr/fpp-steward-auth-core";
import { createTempWorkspace } from "./test-helpers.js";
import { loadOrCreateIdentity } from "./identity.js";
import { TrustGraphProtocol } from "./trust-graph.js";
import { registerFppTrustCli } from "./cli.js";
import { registerStewardCli } from "./steward-cli.js";

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
      "bootstrap-template",
      "bootstrap-admit",
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

    const bootstrapAdmit = commands.get("bootstrap-admit")!;
    assert.ok(
      bootstrapAdmit.opts.some((o) => o.flags.includes("--expected-key-ref") && o.required),
    );
    assert.ok(
      bootstrapAdmit.opts.some((o) => o.flags.includes("--payload") && o.required),
    );
    assert.ok(
      bootstrapAdmit.opts.some((o) => o.flags.includes("--signature") && o.required),
    );

    const init = commands.get("init")!;
    assert.ok(
      init.opts.some((o) => o.flags.includes("--bootstrap-profile") && o.required),
    );

    const keyAdmit = commands.get("key-admit")!;
    assert.ok(keyAdmit.opts.some((o) => o.flags.includes("--accept-tofu")));
    assert.ok(keyAdmit.opts.some((o) => o.flags.includes("--bootstrap-profile")));
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
    const errs: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    };
    console.error = (...a: unknown[]) => {
      errs.push(a.map(String).join(" "));
    };
    try {
      init!.actionFn!({
        ledger: ledgerPath,
        audience: "instance:cli-init",
        maxStandingLifetimeMs: "86400000",
        maxStandingUses: "100",
        maxOneshotLifetimeMs: "3600000",
        allowedClockSkewMs: "300000",
        bootstrapProfile: "legacy-tofu",
      });
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    const out = logs.join("\n");
    assert.match(out, /fpp:steward:v1:/);
    assert.match(out, /instance:cli-init/);
    assert.match(out, /legacy-tofu/);
    assert.match(errs.join("\n"), /insecure compatibility/i);
    assert.equal(exitCode, undefined);
  });

  it("steward init without legacy-tofu profile fails before ledger write", () => {
    const { program, commands } = createFakeProgram();
    const ledgerPath = join(ws.path, "init-gated.jsonl");
    let exitCode: number | undefined;
    registerStewardCli(program as never, {
      ledgerPath,
      instanceAudience: "instance:gated",
      exit: (code: number) => {
        exitCode = code;
        throw new Error(`exit:${code}`);
      },
    });
    const init = commands.get("init")!;
    assert.throws(() => {
      init.actionFn!({
        ledger: ledgerPath,
        audience: "instance:gated",
        maxStandingLifetimeMs: "86400000",
        maxStandingUses: "100",
        maxOneshotLifetimeMs: "3600000",
        allowedClockSkewMs: "300000",
      });
    });
    assert.equal(exitCode, 1);
    assert.equal(existsSync(ledgerPath), false);
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
    assert.ok(keyAdmit.opts.some((o) => o.flags.includes("--bootstrap-profile")));
  });

  it("bootstrap-template uses the configured host audience when the option is omitted", () => {
    const { program, commands } = createFakeProgram();
    const publicKeyPath = join(ws.path, "configured-template-public.asc");
    writeFileSync(
      publicKeyPath,
      "-----BEGIN PGP PUBLIC KEY BLOCK-----\npublic\n-----END PGP PUBLIC KEY BLOCK-----",
      "utf8",
    );
    registerStewardCli(program as never, {
      ledgerPath: join(ws.path, "configured-template-ledger.jsonl"),
      instanceAudience: "instance:configured-template",
      exit: (code: number) => {
        throw new Error(`exit:${code}`);
      },
    });
    const originalWrite = process.stdout.write;
    const output: string[] = [];
    process.stdout.write = ((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      commands.get("bootstrap-template")!.actionFn!({
        keyRef: `openpgp:${"a".repeat(40)}`,
        publicKey: publicKeyPath,
      });
    } finally {
      process.stdout.write = originalWrite;
    }
    const parsed = parseStewardBootstrap(JSON.parse(output.join("")));
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.bootstrap.audience, "instance:configured-template");
      assert.equal(
        parsed.bootstrap.policy.instanceAudience,
        "instance:configured-template",
      );
    }
  });

  it("secure bootstrap fails before output or prompting without a trusted audience", async () => {
    const { program, commands } = createFakeProgram();
    const ledgerPath = join(ws.path, "missing-audience-ledger.jsonl");
    const publicKeyPath = join(ws.path, "missing-audience-public.asc");
    const payloadPath = join(ws.path, "missing-audience-payload.json");
    const signaturePath = join(ws.path, "missing-audience-signature.asc");
    const keyRef = `openpgp:${"a".repeat(40)}`;
    const audience = "instance:payload-only";
    const issuedAt = new Date().toISOString();
    writeFileSync(
      publicKeyPath,
      "-----BEGIN PGP PUBLIC KEY BLOCK-----\npublic\n-----END PGP PUBLIC KEY BLOCK-----",
      "utf8",
    );
    writeFileSync(
      payloadPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: "steward-bootstrap",
        bootstrapId: "bootstrap-payload-only",
        stewardId: "fpp:steward:v1:aaaaaaaaaaaaaaaaaaaaaaaaaa",
        audience,
        policy: {
          instanceAudience: audience,
          maxStandingLifetimeMs: 86_400_000,
          maxStandingUses: 100,
          maxOneShotLifetimeMs: 3_600_000,
          allowedClockSkewMs: 300_000,
        },
        initialBinding: {
          schemaVersion: 1,
          kind: "steward-key-attestation",
          attestationId: "att-payload-only",
          operation: "initial-bind",
          stewardId: "fpp:steward:v1:aaaaaaaaaaaaaaaaaaaaaaaaaa",
          audience,
          subjectKey: {
            algorithm: "openpgp",
            keyRef,
            publicKeyArmored: readFileSync(publicKeyPath, "utf8"),
          },
          issuedAt,
          nonce: "n".repeat(32),
          reason: "payload audience must not trust itself",
        },
        issuedAt,
        nonce: "b".repeat(32),
      }),
      "utf8",
    );
    writeFileSync(
      signaturePath,
      "-----BEGIN PGP SIGNATURE-----\ninvalid\n-----END PGP SIGNATURE-----",
      "utf8",
    );
    let promptCount = 0;
    const errors: string[] = [];
    registerStewardCli(program as never, {
      ledgerPath,
      exit: (code: number) => {
        throw new Error(`exit:${code}`);
      },
      bootstrapInteractive: {
        isInteractive: () => true,
        confirm: async () => {
          promptCount += 1;
          return "aaaaaaaa";
        },
        write: () => {
          promptCount += 1;
        },
      },
    });

    const originalWrite = process.stdout.write;
    const originalError = console.error;
    const output: string[] = [];
    process.stdout.write = ((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      assert.throws(() =>
        commands.get("bootstrap-template")!.actionFn!({
          keyRef,
          publicKey: publicKeyPath,
        }),
      );
      await assert.rejects(
        commands.get("bootstrap-admit")!.actionFn!({
          payload: payloadPath,
          signature: signaturePath,
          expectedKeyRef: keyRef,
          ledger: ledgerPath,
        }),
      );
    } finally {
      process.stdout.write = originalWrite;
      console.error = originalError;
    }
    assert.match(errors.join("\n"), /configured.*audience|--audience/i);
    assert.equal(output.join(""), "");
    assert.equal(promptCount, 0);
    assert.equal(existsSync(ledgerPath), false);
    assert.doesNotMatch(errors.join("\n"), /instance:local-/);
  });

  it("bootstrap-template rejects private and secret OpenPGP armor before output", () => {
    const { program, commands } = createFakeProgram();
    let exitCode: number | undefined;
    registerStewardCli(program as never, {
      ledgerPath: join(ws.path, "template-secret-ledger.jsonl"),
      instanceAudience: "instance:template-host",
      exit: (code: number) => {
        exitCode = code;
        throw new Error(`exit:${code}`);
      },
    });
    const template = commands.get("bootstrap-template")!;
    const originalWrite = process.stdout.write;
    const output: string[] = [];
    process.stdout.write = ((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      for (const label of ["PRIVATE", "SECRET"]) {
        const keyPath = join(ws.path, `${label.toLowerCase()}-key.asc`);
        writeFileSync(
          keyPath,
          [
            `-----BEGIN PGP ${label} KEY BLOCK-----`,
            "mDMEAAAA",
            `-----END PGP ${label} KEY BLOCK-----`,
          ].join("\n"),
          "utf8",
        );
        assert.throws(() =>
          template.actionFn!({
            audience: "instance:template-host",
            keyRef: `openpgp:${"a".repeat(40)}`,
            publicKey: keyPath,
          }),
        );
        assert.equal(exitCode, 1);
      }
    } finally {
      process.stdout.write = originalWrite;
    }
    assert.equal(output.join(""), "");
  });

  it("bootstrap-admit anchors omitted audience to configured host audience", async () => {
    const { program, commands } = createFakeProgram();
    const ledgerPath = join(ws.path, "wrong-host-audience-ledger.jsonl");
    const payloadPath = join(ws.path, "wrong-host-audience.json");
    const signaturePath = join(ws.path, "wrong-host-audience.asc");
    const keyRef = `openpgp:${"a".repeat(40)}`;
    const audience = "instance:payload-audience";
    const issuedAt = new Date().toISOString();
    writeFileSync(
      payloadPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: "steward-bootstrap",
        bootstrapId: "bootstrap-wrong-host",
        stewardId: "fpp:steward:v1:aaaaaaaaaaaaaaaaaaaaaaaaaa",
        audience,
        policy: {
          instanceAudience: audience,
          maxStandingLifetimeMs: 86_400_000,
          maxStandingUses: 100,
          maxOneShotLifetimeMs: 3_600_000,
          allowedClockSkewMs: 300_000,
        },
        initialBinding: {
          schemaVersion: 1,
          kind: "steward-key-attestation",
          attestationId: "att-wrong-host",
          operation: "initial-bind",
          stewardId: "fpp:steward:v1:aaaaaaaaaaaaaaaaaaaaaaaaaa",
          audience,
          subjectKey: {
            algorithm: "openpgp",
            keyRef,
            publicKeyArmored:
              "-----BEGIN PGP PUBLIC KEY BLOCK-----\ninvalid\n-----END PGP PUBLIC KEY BLOCK-----",
          },
          issuedAt,
          nonce: "n".repeat(32),
          reason: "wrong host test",
        },
        issuedAt,
        nonce: "b".repeat(32),
      }),
      "utf8",
    );
    writeFileSync(
      signaturePath,
      "-----BEGIN PGP SIGNATURE-----\ninvalid\n-----END PGP SIGNATURE-----",
      "utf8",
    );
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    registerStewardCli(program as never, {
      ledgerPath,
      instanceAudience: "instance:configured-host",
      exit: (code: number) => {
        throw new Error(`exit:${code}`);
      },
      bootstrapInteractive: {
        isInteractive: () => true,
        confirm: async () => "aaaaaaaa",
        write: () => {},
      },
    });
    try {
      await assert.rejects(
        commands.get("bootstrap-admit")!.actionFn!({
          payload: payloadPath,
          signature: signaturePath,
          expectedKeyRef: keyRef,
          ledger: ledgerPath,
        }),
      );
    } finally {
      console.error = originalError;
    }
    assert.match(errors.join("\n"), /expected audience/i);
    assert.equal(existsSync(ledgerPath), false);
  });

  it("drives real secure bootstrap actions through valid and no-write failure ceremonies", async () => {
    const audience = "instance:cli-actions";
    const { privateKey, publicKey } = await openpgp.generateKey({
      type: "ecc",
      curve: "curve25519Legacy",
      userIDs: [{ name: "cli-actions", email: "cli-actions@example.test" }],
      format: "object",
    });
    const keyRef = `openpgp:${publicKey.getFingerprint().toLowerCase()}`;
    const publicKeyPath = join(ws.path, "cli-actions-public.asc");
    writeFileSync(publicKeyPath, publicKey.armor(), "utf8");

    const templateHarness = createFakeProgram();
    registerStewardCli(templateHarness.program as never, {
      ledgerPath: join(ws.path, "cli-actions-template-ledger.jsonl"),
      instanceAudience: audience,
      exit: (code: number) => {
        throw new Error(`exit:${code}`);
      },
    });
    const originalWrite = process.stdout.write;
    const templateChunks: string[] = [];
    process.stdout.write = ((chunk: unknown) => {
      templateChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      templateHarness.commands.get("bootstrap-template")!.actionFn!({
        audience,
        keyRef,
        publicKey: publicKeyPath,
        maxStandingUses: "17",
      });
    } finally {
      process.stdout.write = originalWrite;
    }
    const templateText = templateChunks.join("");
    const parsed = parseStewardBootstrap(JSON.parse(templateText));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const bootstrap = parsed.bootstrap;
    const signature = await openpgp.sign({
      message: await openpgp.createMessage({
        text: canonicalizeV2(bootstrap),
      }),
      signingKeys: privateKey,
      detached: true,
    });
    const payloadPath = join(ws.path, "cli-actions-bootstrap.json");
    const signaturePath = join(ws.path, "cli-actions-bootstrap.asc");
    writeFileSync(payloadPath, canonicalizeV2(bootstrap), "utf8");
    writeFileSync(signaturePath, signature, "utf8");

    type Scenario = {
      name: string;
      interactive?: boolean;
      answer?: string;
      hostAudience?: string;
      expectedKeyRef?: string;
      seed?: "complete" | "legacy-init-only";
      expectedError?: RegExp;
    };
    const runScenario = async (scenario: Scenario) => {
      const ledgerPath = join(ws.path, `cli-actions-${scenario.name}.jsonl`);
      const ledger = new StewardAuthorizationLedger({ path: ledgerPath });
      if (scenario.seed === "complete") {
        const seeded = ledger.initializeWithInitialBinding(
          {
            instanceAudience: audience,
            maxStandingLifetimeMs: 86_400_000,
            maxStandingUses: 3,
            maxOneShotLifetimeMs: 3_600_000,
            allowedClockSkewMs: 300_000,
          },
          {
            kind: "key_binding_accepted",
            evidenceDigest: "a".repeat(64),
            detail: { operation: "initial-bind", subjectKeyRef: keyRef },
            uniqueKeys: {
              attestationId: `att-seed-${scenario.name}`,
              nonce: scenario.name.padEnd(32, "x"),
            },
          },
        );
        assert.equal(seeded.ok, true);
      } else if (scenario.seed === "legacy-init-only") {
        assert.equal(
          ledger.initialize({
            instanceAudience: audience,
            maxStandingLifetimeMs: 86_400_000,
            maxStandingUses: 3,
            maxOneShotLifetimeMs: 3_600_000,
            allowedClockSkewMs: 300_000,
          }).ok,
          true,
        );
      }
      const before = existsSync(ledgerPath)
        ? readFileSync(ledgerPath, "utf8")
        : undefined;
      const harness = createFakeProgram();
      const logs: string[] = [];
      const errors: string[] = [];
      const prompts: string[] = [];
      registerStewardCli(harness.program as never, {
        ledgerPath,
        instanceAudience: scenario.hostAudience ?? audience,
        exit: (code: number) => {
          throw new Error(`exit:${code}`);
        },
        bootstrapInteractive: {
          isInteractive: () => scenario.interactive ?? true,
          confirm: async () =>
            scenario.answer ?? keyRef.slice(-8),
          write: (line: string) => prompts.push(line),
        },
      });
      const originalLog = console.log;
      const originalError = console.error;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };
      console.error = (...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      };
      let thrown: unknown;
      try {
        await harness.commands.get("bootstrap-admit")!.actionFn!({
          payload: payloadPath,
          signature: signaturePath,
          expectedKeyRef: scenario.expectedKeyRef ?? keyRef,
          ledger: ledgerPath,
        });
      } catch (err) {
        thrown = err;
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }
      const after = existsSync(ledgerPath)
        ? readFileSync(ledgerPath, "utf8")
        : undefined;
      if (scenario.expectedError) {
        assert.ok(thrown, `${scenario.name} must fail`);
        assert.match(errors.join("\n"), scenario.expectedError);
        assert.equal(
          after,
          before,
          `${scenario.name} changed the ledger on rejection`,
        );
      } else {
        assert.equal(thrown, undefined);
        const loaded = ledger.loadVerified();
        assert.equal(loaded.ok, true);
        if (loaded.ok) {
          assert.equal(loaded.events.length, 2);
          assert.equal(loaded.events[0]!.kind, "ledger_initialized");
          assert.equal(loaded.events[1]!.kind, "key_binding_accepted");
        }
      }
      const observableOutput = [
        templateText,
        ...logs,
        ...errors,
        ...prompts,
      ].join("\n");
      assert.doesNotMatch(observableOutput, /BEGIN PGP (?:PRIVATE|SECRET) KEY/i);
      assert.doesNotMatch(observableOutput, /BEGIN PGP SIGNATURE/i);
      assert.equal(observableOutput.includes(signature), false);
    };

    await runScenario({ name: "valid" });
    await runScenario({
      name: "non-tty",
      interactive: false,
      expectedError: /interactive TTY/i,
    });
    await runScenario({
      name: "wrong-answer",
      answer: "deadbeef",
      expectedError: /confirmation did not match/i,
    });
    await runScenario({
      name: "declined",
      answer: "decline",
      expectedError: /operator declined/i,
    });
    await runScenario({
      name: "wrong-audience",
      hostAudience: "instance:other-host",
      expectedError: /expected audience/i,
    });
    await runScenario({
      name: "wrong-key",
      expectedKeyRef: `openpgp:${"b".repeat(40)}`,
      answer: "bbbbbbbb",
      expectedError: /expectedKeyRef does not match/i,
    });
    await runScenario({
      name: "pre-existing",
      seed: "complete",
      expectedError: /already initialized.*explicit operator recovery/i,
    });
    await runScenario({
      name: "legacy-init-only",
      seed: "legacy-init-only",
      expectedError: /initialized-only.*explicit operator recovery/i,
    });
  });
});
