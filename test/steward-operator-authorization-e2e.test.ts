/**
 * Vertical-slice E2E: steward TOFU → signed one-shot code.patch → allow once → audit link.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import * as openpgp from "openpgp";
import {
  bootstrapSigningFields,
  canonicalizeV2,
  mintStewardIdV1,
  type OperatorAuthorizationV1,
  type StewardBootstrapV1,
  type StewardKeyAttestationV1,
} from "@ovrsr/fpp-protocol-core";
import {
  AuthorizationService,
  StewardAuthorizationLedger,
  StewardBootstrapService,
  StewardRegistry,
  createDefaultBackendRegistry,
  createOpenPgpBackend,
  PACKAGE_NAME as STEWARD_PKG,
} from "@ovrsr/fpp-steward-auth-core";
import {
  createEnforcementRuntime,
  type FppRuntimeAdapter,
} from "@ovrsr/fpp-enforcement-core";
import { registerStewardCli } from "../plugin-trust/src/steward-cli.js";

type FakeStewardCommand = {
  actionFn?: (...args: unknown[]) => void | Promise<void>;
  command(name: string): FakeStewardCommand;
  description(value: string): FakeStewardCommand;
  argument(...args: unknown[]): FakeStewardCommand;
  option(...args: unknown[]): FakeStewardCommand;
  requiredOption(...args: unknown[]): FakeStewardCommand;
  action(fn: (...args: unknown[]) => void | Promise<void>): FakeStewardCommand;
};

function createStewardCliHarness() {
  const commands = new Map<string, FakeStewardCommand>();
  const make = (): FakeStewardCommand => {
    const command: FakeStewardCommand = {
      command(name: string) {
        const child = make();
        commands.set(name, child);
        return child;
      },
      description() {
        return command;
      },
      argument() {
        return command;
      },
      option() {
        return command;
      },
      requiredOption() {
        return command;
      },
      action(fn) {
        command.actionFn = fn;
        return command;
      },
    };
    return command;
  };
  const root = make();
  return {
    program: { command: (name: string) => root.command(name) },
    commands,
  };
}

const dirs: string[] = [];
after(() => {
  while (dirs.length) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

async function generateKey(name: string) {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name, email: `${name}@example.test` }],
    format: "object",
  });
  return {
    privateKey,
    publicKeyArmored: publicKey.armor(),
    keyRef: `openpgp:${publicKey.getFingerprint().toLowerCase()}`,
  };
}

async function signDetached(payload: object, key: openpgp.PrivateKey) {
  return openpgp.sign({
    message: await openpgp.createMessage({ text: canonicalizeV2(payload) }),
    signingKeys: key,
    detached: true,
  });
}

async function signCleartext(payload: object, key: openpgp.PrivateKey) {
  return openpgp.sign({
    message: await openpgp.createCleartextMessage({
      text: canonicalizeV2(payload),
    }),
    signingKeys: key,
  });
}

describe("steward operator authorization E2E", () => {
  it("exports steward-auth-core without openclaw dependency", () => {
    assert.equal(STEWARD_PKG, "@ovrsr/fpp-steward-auth-core");
    const pkg = JSON.parse(
      readFileSync(
        join(process.cwd(), "packages/steward-auth-core/package.json"),
        "utf8",
      ),
    );
    assert.equal(pkg.dependencies?.openclaw, undefined);
  });

  it("allows one exact apply_patch once, rejects replay, links audits", async () => {
    const root = mkdtempSync(join(tmpdir(), "fpp-steward-e2e-"));
    dirs.push(root);
    const ledgerPath = join(root, "fpp-steward-authorization-ledger.jsonl");
    const auditPath = join(root, "fpp-plugin-audit.jsonl");
    const audience = "instance:e2e";

    const ledger = new StewardAuthorizationLedger({ path: ledgerPath });
    assert.equal(
      ledger.initialize({
        instanceAudience: audience,
        maxStandingLifetimeMs: 86_400_000,
        maxStandingUses: 50,
        maxOneShotLifetimeMs: 3_600_000,
        allowedClockSkewMs: 300_000,
      }).ok,
      true,
    );
    const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
    const registry = new StewardRegistry({ ledger, backends });
    const key = await generateKey("e2e");
    const stewardId = mintStewardIdV1();
    const attestation: StewardKeyAttestationV1 = {
      schemaVersion: 1,
      kind: "steward-key-attestation",
      attestationId: "att-e2e",
      operation: "initial-bind",
      stewardId,
      audience,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: key.keyRef,
        publicKeyArmored: key.publicKeyArmored,
      },
      issuedAt: new Date().toISOString(),
      nonce: "e".repeat(32),
      reason: "e2e tofu",
    };
    assert.equal(
      (
        await registry.admitKeyAttestation({
          attestation,
          format: "detached",
          signaturesArmored: [await signDetached(attestation, key.privateKey)],
          acceptTofu: true,
        })
      ).ok,
      true,
    );

    const service = new AuthorizationService({ ledger, backends, registry });
    const now = Date.now();
    const grant: OperatorAuthorizationV1 = {
      schemaVersion: 1,
      kind: "operator-authorization",
      authorizationId: "authz-e2e-1",
      stewardId,
      signingKeyRef: key.keyRef,
      audience,
      mode: "one-shot",
      scope: {
        classifications: ["code.patch"],
        toolNames: ["apply_patch"],
        resourcePaths: ["src/e2e.ts"],
      },
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 120_000).toISOString(),
      nonce: "f".repeat(32),
      maxUses: 1,
      reason: "e2e one-shot",
    };
    assert.equal(
      (
        await service.admit({
          authorization: grant,
          format: "cleartext",
          cleartextArmored: await signCleartext(grant, key.privateKey),
        })
      ).ok,
      true,
    );

    const adapter: FppRuntimeAdapter = {
      harnessId: "e2e",
      getWorkspacePaths: () => ({ workspaceRoot: root }),
    };
    const runtime = createEnforcementRuntime(
      {
        auditLogPath: auditPath,
        stewardAuthorizationLedgerPath: ledgerPath,
        dispositionMode: "unattended",
        approvalOn: ["code.patch"],
        standingAllowOn: [],
      },
      adapter,
    );

    const patch = "*** Add File: src/e2e.ts\n+export const ok = true;\n";
    const first = await runtime.onBeforeToolCall(
      { toolName: "apply_patch", params: { patch }, toolCallId: "e2e-1" },
      { toolCallId: "e2e-1" },
    );
    assert.equal(first.action, "allow");

    const auditLine = JSON.parse(
      readFileSync(auditPath, "utf8").trim().split("\n").at(-1)!,
    );
    assert.equal(auditLine.authorizationId, "authz-e2e-1");
    assert.equal(auditLine.stewardId, stewardId);
    assert.match(String(auditLine.stewardLedgerEventHash), /^[0-9a-f]{64}$/);

    const second = await runtime.onBeforeToolCall(
      { toolName: "apply_patch", params: { patch }, toolCallId: "e2e-2" },
      { toolCallId: "e2e-2" },
    );
    assert.notEqual(second.action, "allow");

    // Wrong path scope
    const wrongPathGrant: OperatorAuthorizationV1 = {
      ...grant,
      authorizationId: "authz-e2e-path",
      nonce: "g".repeat(32),
      scope: {
        classifications: ["code.patch"],
        resourcePaths: ["src/other.ts"],
      },
    };
    await service.admit({
      authorization: wrongPathGrant,
      format: "detached",
      signaturesArmored: [await signDetached(wrongPathGrant, key.privateKey)],
    });
    const mismatch = await runtime.onBeforeToolCall(
      { toolName: "apply_patch", params: { patch }, toolCallId: "e2e-3" },
      { toolCallId: "e2e-3" },
    );
    assert.notEqual(mismatch.action, "allow");
  });

  it("allows live-shaped external apply_patch once via outOfWorkspacePaths alias", async () => {
    const root = mkdtempSync(join(tmpdir(), "fpp-steward-e2e-ext-"));
    dirs.push(root);
    const ledgerPath = join(root, "fpp-steward-authorization-ledger.jsonl");
    const auditPath = join(root, "fpp-plugin-audit.jsonl");
    const audience = "instance:e2e-ext";
    const externalPath = resolve(root, "..", "openclaw.json");
    const alias = "harness/openclaw.json";

    const ledger = new StewardAuthorizationLedger({ path: ledgerPath });
    assert.equal(
      ledger.initialize({
        instanceAudience: audience,
        maxStandingLifetimeMs: 86_400_000,
        maxStandingUses: 50,
        maxOneShotLifetimeMs: 3_600_000,
        allowedClockSkewMs: 300_000,
      }).ok,
      true,
    );
    const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
    const registry = new StewardRegistry({ ledger, backends });
    const key = await generateKey("e2e-ext");
    const stewardId = mintStewardIdV1();
    const attestation: StewardKeyAttestationV1 = {
      schemaVersion: 1,
      kind: "steward-key-attestation",
      attestationId: "att-e2e-ext",
      operation: "initial-bind",
      stewardId,
      audience,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: key.keyRef,
        publicKeyArmored: key.publicKeyArmored,
      },
      issuedAt: new Date().toISOString(),
      nonce: "j".repeat(32),
      reason: "e2e external",
    };
    assert.equal(
      (
        await registry.admitKeyAttestation({
          attestation,
          format: "detached",
          signaturesArmored: [await signDetached(attestation, key.privateKey)],
          acceptTofu: true,
        })
      ).ok,
      true,
    );

    const service = new AuthorizationService({ ledger, backends, registry });
    const now = Date.now();
    const grant: OperatorAuthorizationV1 = {
      schemaVersion: 1,
      kind: "operator-authorization",
      authorizationId: "authz-e2e-ext",
      stewardId,
      signingKeyRef: key.keyRef,
      audience,
      mode: "one-shot",
      scope: {
        classifications: ["code.patch"],
        toolNames: ["apply_patch"],
        resourcePaths: [alias],
      },
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 120_000).toISOString(),
      nonce: "k".repeat(32),
      maxUses: 1,
      reason: "e2e external one-shot",
    };
    assert.equal(
      (
        await service.admit({
          authorization: grant,
          format: "cleartext",
          cleartextArmored: await signCleartext(grant, key.privateKey),
        })
      ).ok,
      true,
    );

    const adapter: FppRuntimeAdapter = {
      harnessId: "e2e",
      getWorkspacePaths: () => ({ workspaceRoot: root }),
    };
    const runtime = createEnforcementRuntime(
      {
        auditLogPath: auditPath,
        stewardAuthorizationLedgerPath: ledgerPath,
        dispositionMode: "unattended",
        approvalOn: ["code.patch"],
        standingAllowOn: [],
        outOfWorkspacePaths: { [externalPath]: alias },
      },
      adapter,
    );

    const command = [
      "*** Begin Patch",
      `*** Update File: ${externalPath}`,
      "@@",
      "-old",
      "+new",
      "*** End Patch",
      "",
    ].join("\n");
    const first = await runtime.onBeforeToolCall(
      { toolName: "apply_patch", params: { command }, toolCallId: "e2e-ext-1" },
      { toolCallId: "e2e-ext-1" },
    );
    assert.equal(first.action, "allow");

    const auditLine = JSON.parse(
      readFileSync(auditPath, "utf8").trim().split("\n").at(-1)!,
    );
    assert.equal(auditLine.authorizationId, "authz-e2e-ext");
    assert.equal(auditLine.stewardId, stewardId);
    assert.match(String(auditLine.stewardLedgerEventHash), /^[0-9a-f]{64}$/);

    const ledgerEvents = readFileSync(ledgerPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(
      ledgerEvents.some((event) => event.kind === "authorization_consumed"),
    );

    const second = await runtime.onBeforeToolCall(
      { toolName: "apply_patch", params: { command }, toolCallId: "e2e-ext-2" },
      { toolCallId: "e2e-ext-2" },
    );
    assert.notEqual(second.action, "allow");

    const missingMapRuntime = createEnforcementRuntime(
      {
        auditLogPath: join(root, "audit-miss.jsonl"),
        stewardAuthorizationLedgerPath: ledgerPath,
        dispositionMode: "unattended",
        approvalOn: ["code.patch"],
        standingAllowOn: [],
        outOfWorkspacePaths: {},
      },
      adapter,
    );
    const missGrant: OperatorAuthorizationV1 = {
      ...grant,
      authorizationId: "authz-e2e-ext-miss",
      nonce: "l".repeat(32),
    };
    await service.admit({
      authorization: missGrant,
      format: "detached",
      signaturesArmored: [await signDetached(missGrant, key.privateKey)],
    });
    const missed = await missingMapRuntime.onBeforeToolCall(
      { toolName: "apply_patch", params: { command }, toolCallId: "e2e-ext-3" },
      { toolCallId: "e2e-ext-3" },
    );
    assert.notEqual(missed.action, "allow");
  });

  it("fails closed on hard-floor even with a matching steward grant", async () => {
    const root = mkdtempSync(join(tmpdir(), "fpp-steward-e2e-hf-"));
    dirs.push(root);
    const ledgerPath = join(root, "ledger.jsonl");
    const audience = "instance:e2e-hf";
    const ledger = new StewardAuthorizationLedger({ path: ledgerPath });
    ledger.initialize({
      instanceAudience: audience,
      maxStandingLifetimeMs: 86_400_000,
      maxStandingUses: 50,
      maxOneShotLifetimeMs: 3_600_000,
      allowedClockSkewMs: 300_000,
    });
    const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
    const registry = new StewardRegistry({ ledger, backends });
    const key = await generateKey("hf");
    const stewardId = mintStewardIdV1();
    const attestation: StewardKeyAttestationV1 = {
      schemaVersion: 1,
      kind: "steward-key-attestation",
      attestationId: "att-hf-e2e",
      operation: "initial-bind",
      stewardId,
      audience,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: key.keyRef,
        publicKeyArmored: key.publicKeyArmored,
      },
      issuedAt: new Date().toISOString(),
      nonce: "h".repeat(32),
      reason: "hf",
    };
    await registry.admitKeyAttestation({
      attestation,
      format: "detached",
      signaturesArmored: [await signDetached(attestation, key.privateKey)],
      acceptTofu: true,
    });
    const service = new AuthorizationService({ ledger, backends, registry });
    const now = Date.now();
    const grant: OperatorAuthorizationV1 = {
      schemaVersion: 1,
      kind: "operator-authorization",
      authorizationId: "authz-hf-e2e",
      stewardId,
      signingKeyRef: key.keyRef,
      audience,
      mode: "one-shot",
      scope: { classifications: ["gateway.restart"] },
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
      nonce: "i".repeat(32),
      maxUses: 1,
      reason: "should not bypass",
    };
    await service.admit({
      authorization: grant,
      format: "detached",
      signaturesArmored: [await signDetached(grant, key.privateKey)],
    });
    const runtime = createEnforcementRuntime(
      {
        auditLogPath: join(root, "audit.jsonl"),
        stewardAuthorizationLedgerPath: ledgerPath,
        dispositionMode: "unattended",
      },
      {
        harnessId: "e2e",
        getWorkspacePaths: () => ({ workspaceRoot: root }),
      },
    );
    const result = await runtime.onBeforeToolCall(
      {
        toolName: "gateway",
        params: { action: "restart" },
        toolCallId: "hf-1",
      },
      { toolCallId: "hf-1" },
    );
    assert.equal(result.action, "block");
  });
});

describe("steward secure bootstrap E2E", () => {
  function buildBootstrap(
    key: { keyRef: string; publicKeyArmored: string },
    audience: string,
    stewardId: string,
    opts: {
      bootstrapId?: string;
      attestationId?: string;
      nonce?: string;
      bindingNonce?: string;
      policyUses?: number;
    } = {},
  ): StewardBootstrapV1 {
    const issuedAt = new Date().toISOString();
    return {
      schemaVersion: 1,
      kind: "steward-bootstrap",
      bootstrapId: opts.bootstrapId ?? "bootstrap-e2e",
      stewardId,
      audience,
      policy: {
        instanceAudience: audience,
        maxStandingLifetimeMs: 86_400_000,
        maxStandingUses: opts.policyUses ?? 50,
        maxOneShotLifetimeMs: 3_600_000,
        allowedClockSkewMs: 300_000,
      },
      initialBinding: {
        schemaVersion: 1,
        kind: "steward-key-attestation",
        attestationId: opts.attestationId ?? "att-boot-e2e",
        operation: "initial-bind",
        stewardId,
        audience,
        subjectKey: {
          algorithm: "openpgp",
          keyRef: key.keyRef,
          publicKeyArmored: key.publicKeyArmored,
        },
        issuedAt,
        nonce: opts.bindingNonce ?? "n".repeat(32),
        reason: "secure e2e genesis",
      },
      issuedAt,
      nonce: opts.nonce ?? "b".repeat(32),
    };
  }

  it("admits a signed bootstrap atomically and enables required-only grant consumption", async () => {
    const root = mkdtempSync(join(tmpdir(), "fpp-boot-e2e-"));
    dirs.push(root);
    const ledgerPath = join(root, "ledger.jsonl");
    const auditPath = join(root, "audit.jsonl");
    const audience = "instance:secure-e2e";
    const key = await generateKey("secure");
    const stewardId = mintStewardIdV1();
    const bootstrap = buildBootstrap(key, audience, stewardId);
    const signature = await signDetached(
      bootstrapSigningFields(bootstrap),
      key.privateKey,
    );

    const payloadPath = join(root, "bootstrap.json");
    const signaturePath = join(root, "bootstrap.asc");
    writeFileSync(payloadPath, canonicalizeV2(bootstrap), "utf8");
    writeFileSync(signaturePath, signature, "utf8");
    const cli = createStewardCliHarness();
    registerStewardCli(cli.program as never, {
      ledgerPath,
      instanceAudience: audience,
      exit: (code: number) => {
        throw new Error(`exit:${code}`);
      },
      bootstrapInteractive: {
        isInteractive: () => true,
        confirm: async () => key.keyRef.slice(-8),
        write: () => {},
      },
    });
    const logs: string[] = [];
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) =>
      errors.push(args.map(String).join(" "));
    try {
      await cli.commands.get("bootstrap-admit")!.actionFn!({
        payload: payloadPath,
        signature: signaturePath,
        expectedKeyRef: key.keyRef,
        ledger: ledgerPath,
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    const cliOutput = [...logs, ...errors].join("\n");
    assert.doesNotMatch(cliOutput, /BEGIN PGP SIGNATURE|PRIVATE KEY|SECRET KEY/i);

    const ledger = new StewardAuthorizationLedger({ path: ledgerPath });
    const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
    const registry = new StewardRegistry({ ledger, backends });

    const loaded = ledger.loadVerified();
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.equal(loaded.events.length, 2);
    assert.equal(loaded.events[0]!.kind, "ledger_initialized");
    assert.equal(loaded.events[1]!.kind, "key_binding_accepted");
    assert.equal(loaded.events[1]!.detail.bootstrapProfile, "interactive-fingerprint");
    assert.deepEqual(loaded.policy?.maxStandingUses, 50);

    const authz = new AuthorizationService({ ledger, backends, registry });
    const now = Date.now();
    const grant: OperatorAuthorizationV1 = {
      schemaVersion: 1,
      kind: "operator-authorization",
      authorizationId: "authz-secure-1",
      stewardId,
      signingKeyRef: key.keyRef,
      audience,
      mode: "one-shot",
      scope: {
        classifications: ["code.patch"],
        toolNames: ["apply_patch"],
        resourcePaths: ["src/secure.ts"],
      },
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 120_000).toISOString(),
      nonce: "s".repeat(32),
      maxUses: 1,
      reason: "secure bootstrap grant",
    };
    assert.equal(
      (
        await authz.admit({
          authorization: grant,
          format: "detached",
          signaturesArmored: [await signDetached(grant, key.privateKey)],
        })
      ).ok,
      true,
    );

    const runtime = createEnforcementRuntime(
      {
        auditLogPath: auditPath,
        stewardAuthorizationLedgerPath: ledgerPath,
        dispositionMode: "unattended",
        approvalOn: ["code.patch"],
        standingAllowOn: [],
      },
      {
        harnessId: "e2e",
        getWorkspacePaths: () => ({ workspaceRoot: root }),
      },
    );
    const first = await runtime.onBeforeToolCall(
      {
        toolName: "apply_patch",
        params: { patch: "*** Add File: src/secure.ts\n+export const ok = 1;\n" },
        toolCallId: "secure-1",
      },
      { toolCallId: "secure-1" },
    );
    assert.equal(first.action, "allow");
    const second = await runtime.onBeforeToolCall(
      {
        toolName: "apply_patch",
        params: { patch: "*** Add File: src/secure.ts\n+export const ok = 1;\n" },
        toolCallId: "secure-2",
      },
      { toolCallId: "secure-2" },
    );
    assert.notEqual(second.action, "allow");
  });

  it("races two signed bootstraps and keeps a single non-mixed chain", async () => {
    const root = mkdtempSync(join(tmpdir(), "fpp-boot-race-"));
    dirs.push(root);
    const ledgerPath = join(root, "ledger.jsonl");
    const audience = "instance:race";
    const a = await generateKey("race-a");
    const b = await generateKey("race-b");
    const stewardA = mintStewardIdV1();
    const stewardB = mintStewardIdV1();
    const bootA = buildBootstrap(a, audience, stewardA, {
      bootstrapId: "boot-a",
      attestationId: "att-a",
      nonce: "a".repeat(32),
      bindingNonce: "c".repeat(32),
      policyUses: 10,
    });
    const bootB = buildBootstrap(b, audience, stewardB, {
      bootstrapId: "boot-b",
      attestationId: "att-b",
      nonce: "d".repeat(32),
      bindingNonce: "e".repeat(32),
      policyUses: 99,
    });
    const sigA = await signDetached(bootstrapSigningFields(bootA), a.privateKey);
    const sigB = await signDetached(bootstrapSigningFields(bootB), b.privateKey);

    const run = async (
      bootstrap: StewardBootstrapV1,
      signature: string,
      expectedKeyRef: string,
    ) => {
      const ledger = new StewardAuthorizationLedger({ path: ledgerPath });
      const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
      const registry = new StewardRegistry({ ledger, backends });
      const service = new StewardBootstrapService({ ledger, backends, registry });
      return service.admitBootstrap({
        bootstrap,
        signatureArmored: signature,
        expectedKeyRef,
        expectedAudience: audience,
      });
    };

    const [r1, r2] = await Promise.all([
      run(bootA, sigA, a.keyRef),
      run(bootB, sigB, b.keyRef),
    ]);
    const winners = [r1, r2].filter((r) => r.ok);
    const losers = [r1, r2].filter((r) => !r.ok);
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.match(losers[0]!.ok ? "" : losers[0]!.reason, /already initialized|lock/i);

    const loaded = new StewardAuthorizationLedger({ path: ledgerPath }).loadVerified();
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.equal(loaded.events.length, 2);
    assert.equal(loaded.events[0]!.kind, "ledger_initialized");
    assert.equal(loaded.events[1]!.kind, "key_binding_accepted");
    const uses = loaded.policy?.maxStandingUses;
    assert.ok(uses === 10 || uses === 99);
    const subject = loaded.events[1]!.detail.subjectKeyRef;
    if (uses === 10) {
      assert.equal(subject, a.keyRef);
    } else {
      assert.equal(subject, b.keyRef);
    }
  });

  it("treats unexpected pre-initialization as a visible failure for the intended operator", async () => {
    const root = mkdtempSync(join(tmpdir(), "fpp-boot-pre-"));
    dirs.push(root);
    const ledgerPath = join(root, "ledger.jsonl");
    const audience = "instance:pre";
    const hostile = await generateKey("hostile");
    const intended = await generateKey("intended");
    const hostileBoot = buildBootstrap(hostile, audience, mintStewardIdV1(), {
      bootstrapId: "hostile",
      attestationId: "att-h",
      nonce: "h".repeat(32),
      bindingNonce: "i".repeat(32),
    });
    const intendedBoot = buildBootstrap(intended, audience, mintStewardIdV1(), {
      bootstrapId: "intended",
      attestationId: "att-i",
      nonce: "j".repeat(32),
      bindingNonce: "k".repeat(32),
    });

    const ledger = new StewardAuthorizationLedger({ path: ledgerPath });
    const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
    const registry = new StewardRegistry({ ledger, backends });
    const service = new StewardBootstrapService({ ledger, backends, registry });
    assert.equal(
      (
        await service.admitBootstrap({
          bootstrap: hostileBoot,
          signatureArmored: await signDetached(
            bootstrapSigningFields(hostileBoot),
            hostile.privateKey,
          ),
          expectedKeyRef: hostile.keyRef,
          expectedAudience: audience,
        })
      ).ok,
      true,
    );

    const blocked = await service.admitBootstrap({
      bootstrap: intendedBoot,
      signatureArmored: await signDetached(
        bootstrapSigningFields(intendedBoot),
        intended.privateKey,
      ),
      expectedKeyRef: intended.keyRef,
      expectedAudience: audience,
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.ok ? "" : blocked.reason, /already initialized/i);

    const loaded = ledger.loadVerified();
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.equal(loaded.events[1]!.detail.subjectKeyRef, hostile.keyRef);
    assert.notEqual(loaded.events[1]!.detail.subjectKeyRef, intended.keyRef);
  });

  it("rejects wrong expected fingerprint before creating operator coverage", async () => {
    const root = mkdtempSync(join(tmpdir(), "fpp-boot-wrong-"));
    dirs.push(root);
    const ledgerPath = join(root, "ledger.jsonl");
    const audience = "instance:wrong";
    const key = await generateKey("real");
    const other = await generateKey("other");
    const stewardId = mintStewardIdV1();
    const bootstrap = buildBootstrap(key, audience, stewardId);
    const ledger = new StewardAuthorizationLedger({ path: ledgerPath });
    const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
    const registry = new StewardRegistry({ ledger, backends });
    const service = new StewardBootstrapService({ ledger, backends, registry });
    const rejected = await service.admitBootstrap({
      bootstrap,
      signatureArmored: await signDetached(
        bootstrapSigningFields(bootstrap),
        key.privateKey,
      ),
      expectedKeyRef: other.keyRef,
      expectedAudience: audience,
    });
    assert.equal(rejected.ok, false);
    assert.equal(registry.listStewards().length, 0);
    const loaded = ledger.loadVerified();
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.equal(loaded.events.length, 0);
  });
});
