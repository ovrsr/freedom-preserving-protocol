import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as openpgp from "openpgp";
import {
  canonicalizeV2,
  mintStewardIdV1,
  type OperatorAuthorizationV1,
  type StewardKeyAttestationV1,
} from "@ovrsr/fpp-protocol-core";
import {
  AuthorizationService,
  StewardAuthorizationLedger,
  StewardRegistry,
  createDefaultBackendRegistry,
  createOpenPgpBackend,
} from "@ovrsr/fpp-steward-auth-core";
import {
  createEnforcementRuntime,
  type FppRuntimeAdapter,
} from "./runtime-adapter.js";
import { createTempWorkspace } from "./test-helpers.js";

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
  const message = await openpgp.createMessage({
    text: canonicalizeV2(payload),
  });
  return openpgp.sign({ message, signingKeys: key, detached: true });
}

function countConsumed(ledgerPath: string): number {
  return readFileSync(ledgerPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((event) => event.kind === "authorization_consumed").length;
}

function remainingUsesFor(
  ledgerPath: string,
  authorizationId: string,
): number | undefined {
  const ledger = new StewardAuthorizationLedger({ path: ledgerPath });
  const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
  const registry = new StewardRegistry({ ledger, backends });
  const service = new AuthorizationService({ ledger, backends, registry });
  return service
    .listAdmitted()
    .find((entry) => entry.authorization.authorizationId === authorizationId)
    ?.remainingUses;
}

async function admitStandingGrant(input: {
  ledgerPath: string;
  audience: string;
  keyName: string;
  authorizationId: string;
  scope: OperatorAuthorizationV1["scope"];
  maxUses: number;
  noncePrefix: string;
}): Promise<{ stewardId: string }> {
  const ledger = new StewardAuthorizationLedger({ path: input.ledgerPath });
  assert.equal(
    ledger.initialize({
      instanceAudience: input.audience,
      maxStandingLifetimeMs: 86_400_000,
      maxStandingUses: 100,
      maxOneShotLifetimeMs: 3_600_000,
      allowedClockSkewMs: 300_000,
    }).ok,
    true,
  );
  const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
  const registry = new StewardRegistry({ ledger, backends });
  const key = await generateKey(input.keyName);
  const stewardId = mintStewardIdV1();
  const attestation: StewardKeyAttestationV1 = {
    schemaVersion: 1,
    kind: "steward-key-attestation",
    attestationId: `att-${input.keyName}`,
    operation: "initial-bind",
    stewardId,
    audience: input.audience,
    subjectKey: {
      algorithm: "openpgp",
      keyRef: key.keyRef,
      publicKeyArmored: key.publicKeyArmored,
    },
    issuedAt: new Date().toISOString(),
    nonce: `${input.noncePrefix}${"a".repeat(31)}`.slice(0, 32),
    reason: "required-only coverage",
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
    authorizationId: input.authorizationId,
    stewardId,
    signingKeyRef: key.keyRef,
    audience: input.audience,
    mode: "standing",
    scope: input.scope,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 3_600_000).toISOString(),
    nonce: `${input.noncePrefix}${"b".repeat(31)}`.slice(0, 32),
    maxUses: input.maxUses,
    reason: "broad standing grant",
  };
  assert.equal(
    (
      await service.admit({
        authorization: grant,
        format: "detached",
        signaturesArmored: [await signDetached(grant, key.privateKey)],
      })
    ).ok,
    true,
  );
  return { stewardId };
}

describe("steward operator coverage in enforcement runtime", () => {
  const ws = createTempWorkspace("fpp-steward-rt-");
  after(() => ws.cleanup());

  it("allows one-shot code.patch via steward grant and records audit evidence", async () => {
    const ledgerPath = join(ws.path, "fpp-steward-authorization-ledger.jsonl");
    const auditPath = join(ws.path, "fpp-plugin-audit.jsonl");
    const audience = "instance:runtime-test";
    const ledger = new StewardAuthorizationLedger({ path: ledgerPath });
    assert.equal(
      ledger.initialize({
        instanceAudience: audience,
        maxStandingLifetimeMs: 86_400_000,
        maxStandingUses: 100,
        maxOneShotLifetimeMs: 3_600_000,
        allowedClockSkewMs: 300_000,
      }).ok,
      true,
    );
    const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
    const registry = new StewardRegistry({ ledger, backends });
    const key = await generateKey("rt");
    const stewardId = mintStewardIdV1();
    const attestation: StewardKeyAttestationV1 = {
      schemaVersion: 1,
      kind: "steward-key-attestation",
      attestationId: "att-rt",
      operation: "initial-bind",
      stewardId,
      audience,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: key.keyRef,
        publicKeyArmored: key.publicKeyArmored,
      },
      issuedAt: new Date().toISOString(),
      nonce: "1".repeat(32),
      reason: "runtime test",
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
      authorizationId: "authz-rt-1",
      stewardId,
      signingKeyRef: key.keyRef,
      audience,
      mode: "one-shot",
      scope: {
        classifications: ["code.patch"],
        toolNames: ["apply_patch"],
        resourcePaths: ["src/a.ts"],
      },
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
      nonce: "2".repeat(32),
      maxUses: 1,
      reason: "one patch",
    };
    assert.equal(
      (
        await service.admit({
          authorization: grant,
          format: "detached",
          signaturesArmored: [await signDetached(grant, key.privateKey)],
        })
      ).ok,
      true,
    );

    const adapter: FppRuntimeAdapter = {
      harnessId: "test",
      getWorkspacePaths: () => ({ workspaceRoot: ws.path }),
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

    const patch = "*** Add File: src/a.ts\n+ console.log(1);\n";
    const first = await runtime.onBeforeToolCall(
      {
        toolName: "apply_patch",
        params: { patch },
        toolCallId: "tc-1",
      },
      { toolCallId: "tc-1" },
    );
    assert.equal(first.action, "allow");

    const audit = readFileSync(auditPath, "utf8").trim().split("\n");
    const last = JSON.parse(audit[audit.length - 1]!);
    assert.equal(last.decision, "allow");
    assert.equal(last.authorizationId, "authz-rt-1");
    assert.equal(last.stewardId, stewardId);
    assert.ok(typeof last.stewardLedgerEventHash === "string");

    const second = await runtime.onBeforeToolCall(
      {
        toolName: "apply_patch",
        params: { patch },
        toolCallId: "tc-2",
      },
      { toolCallId: "tc-2" },
    );
    assert.notEqual(second.action, "allow");
  });

  it("does not let steward grants override hard-floor deny", async () => {
    const ledgerPath = join(ws.path, "ledger-hf.jsonl");
    const audience = "instance:hf";
    const ledger = new StewardAuthorizationLedger({ path: ledgerPath });
    ledger.initialize({
      instanceAudience: audience,
      maxStandingLifetimeMs: 86_400_000,
      maxStandingUses: 100,
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
      attestationId: "att-hf",
      operation: "initial-bind",
      stewardId,
      audience,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: key.keyRef,
        publicKeyArmored: key.publicKeyArmored,
      },
      issuedAt: new Date().toISOString(),
      nonce: "3".repeat(32),
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
      authorizationId: "authz-hf",
      stewardId,
      signingKeyRef: key.keyRef,
      audience,
      mode: "one-shot",
      scope: { classifications: ["gateway.restart"] },
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
      nonce: "4".repeat(32),
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
        auditLogPath: join(ws.path, "audit-hf.jsonl"),
        stewardAuthorizationLedgerPath: ledgerPath,
        dispositionMode: "unattended",
      },
      {
        harnessId: "test",
        getWorkspacePaths: () => ({ workspaceRoot: ws.path }),
      },
    );
    const result = await runtime.onBeforeToolCall(
      { toolName: "gateway", params: { action: "restart" }, toolCallId: "tc-hf" },
      { toolCallId: "tc-hf" },
    );
    assert.equal(result.action, "block");
    assert.equal(countConsumed(ledgerPath), 0);
    assert.equal(remainingUsesFor(ledgerPath, "authz-hf"), 1);
  });

  it("does not consume a broad grant for ordinary exec.benign classifier allow", async () => {
    const ledgerPath = join(ws.path, "ledger-benign.jsonl");
    const maxUses = 5;
    await admitStandingGrant({
      ledgerPath,
      audience: "instance:benign",
      keyName: "benign",
      authorizationId: "authz-benign",
      scope: { classifications: ["exec.benign", "code.patch"] },
      maxUses,
      noncePrefix: "c",
    });

    const runtime = createEnforcementRuntime(
      {
        auditLogPath: join(ws.path, "audit-benign.jsonl"),
        stewardAuthorizationLedgerPath: ledgerPath,
        dispositionMode: "unattended",
        standingAllowOn: [],
      },
      {
        harnessId: "test",
        getWorkspacePaths: () => ({ workspaceRoot: ws.path }),
      },
    );
    const result = await runtime.onBeforeToolCall(
      {
        toolName: "shell_exec",
        params: { command: "echo ok" },
        toolCallId: "tc-benign",
      },
      { toolCallId: "tc-benign" },
    );
    assert.equal(result.action, "allow");
    assert.equal(countConsumed(ledgerPath), 0);
    assert.equal(remainingUsesFor(ledgerPath, "authz-benign"), maxUses);
  });

  it("does not consume a matching grant when standingAllowOn already allows", async () => {
    const ledgerPath = join(ws.path, "ledger-standing.jsonl");
    const maxUses = 4;
    await admitStandingGrant({
      ledgerPath,
      audience: "instance:standing",
      keyName: "standing",
      authorizationId: "authz-standing",
      // Classification-only scope still matches apply_patch and would debit under
      // eager operator lookup; standingAllowOn must win without consumption.
      scope: {
        classifications: ["code.patch"],
      },
      maxUses,
      noncePrefix: "d",
    });

    const runtime = createEnforcementRuntime(
      {
        auditLogPath: join(ws.path, "audit-standing.jsonl"),
        stewardAuthorizationLedgerPath: ledgerPath,
        dispositionMode: "unattended",
        approvalOn: ["code.patch"],
        standingAllowOn: ["code.patch"],
      },
      {
        harnessId: "test",
        getWorkspacePaths: () => ({ workspaceRoot: ws.path }),
      },
    );
    const result = await runtime.onBeforeToolCall(
      {
        toolName: "apply_patch",
        params: { patch: "*** Add File: src/a.ts\n+ console.log(1);\n" },
        toolCallId: "tc-standing",
      },
      { toolCallId: "tc-standing" },
    );
    assert.equal(result.action, "allow");
    assert.equal(countConsumed(ledgerPath), 0);
    assert.equal(remainingUsesFor(ledgerPath, "authz-standing"), maxUses);
  });

  it("does not consume a matching grant when staged/reversible allow already permits", async () => {
    const ledgerPath = join(ws.path, "ledger-staged.jsonl");
    const maxUses = 3;
    await admitStandingGrant({
      ledgerPath,
      audience: "instance:staged",
      keyName: "staged",
      authorizationId: "authz-staged",
      // Descriptor path extraction is apply_patch-only; omit resourcePaths so
      // classification/tool scope still matches and would debit under eager lookup.
      scope: {
        classifications: ["fs.write.workspace"],
        toolNames: ["write_file"],
      },
      maxUses,
      noncePrefix: "e",
    });

    const runtime = createEnforcementRuntime(
      {
        auditLogPath: join(ws.path, "audit-staged.jsonl"),
        stewardAuthorizationLedgerPath: ledgerPath,
        dispositionMode: "unattended",
        standingAllowOn: [],
      },
      {
        harnessId: "test",
        getWorkspacePaths: () => ({ workspaceRoot: ws.path }),
      },
    );
    const result = await runtime.onBeforeToolCall(
      {
        toolName: "write_file",
        params: { path: "src/note.txt", content: "hello" },
        toolCallId: "tc-staged",
      },
      { toolCallId: "tc-staged" },
    );
    assert.equal(result.action, "allow");
    assert.equal(countConsumed(ledgerPath), 0);
    assert.equal(remainingUsesFor(ledgerPath, "authz-staged"), maxUses);
  });

  it("consumes exactly once when operator-present baseline requires approval", async () => {
    const ledgerPath = join(ws.path, "ledger-req.jsonl");
    const maxUses = 2;
    const { stewardId } = await admitStandingGrant({
      ledgerPath,
      audience: "instance:req",
      keyName: "req",
      authorizationId: "authz-req",
      scope: {
        classifications: ["code.patch"],
        toolNames: ["apply_patch"],
        resourcePaths: ["src/b.ts"],
      },
      maxUses,
      noncePrefix: "f",
    });

    const auditPath = join(ws.path, "audit-req.jsonl");
    const runtime = createEnforcementRuntime(
      {
        auditLogPath: auditPath,
        stewardAuthorizationLedgerPath: ledgerPath,
        dispositionMode: "operator-present",
        approvalOn: ["code.patch"],
        standingAllowOn: [],
      },
      {
        harnessId: "test",
        getWorkspacePaths: () => ({ workspaceRoot: ws.path }),
      },
    );
    const first = await runtime.onBeforeToolCall(
      {
        toolName: "apply_patch",
        params: { patch: "*** Add File: src/b.ts\n+ console.log(2);\n" },
        toolCallId: "tc-req-1",
      },
      { toolCallId: "tc-req-1" },
    );
    assert.equal(first.action, "allow");
    assert.equal(countConsumed(ledgerPath), 1);
    assert.equal(remainingUsesFor(ledgerPath, "authz-req"), maxUses - 1);

    const audit = readFileSync(auditPath, "utf8").trim().split("\n");
    const last = JSON.parse(audit[audit.length - 1]!);
    assert.equal(last.authorizationId, "authz-req");
    assert.equal(last.stewardId, stewardId);

    const second = await runtime.onBeforeToolCall(
      {
        toolName: "apply_patch",
        params: { patch: "*** Add File: src/b.ts\n+ console.log(2);\n" },
        toolCallId: "tc-req-2",
      },
      { toolCallId: "tc-req-2" },
    );
    assert.equal(second.action, "allow");
    assert.equal(countConsumed(ledgerPath), 2);
    assert.equal(remainingUsesFor(ledgerPath, "authz-req"), 0);

    const third = await runtime.onBeforeToolCall(
      {
        toolName: "apply_patch",
        params: { patch: "*** Add File: src/b.ts\n+ console.log(2);\n" },
        toolCallId: "tc-req-3",
      },
      { toolCallId: "tc-req-3" },
    );
    assert.notEqual(third.action, "allow");
    assert.equal(countConsumed(ledgerPath), 2);
  });

  it("allows a live-shaped absolute external apply_patch once via outOfWorkspacePaths", async () => {
    const ledgerPath = join(ws.path, "ledger-ext.jsonl");
    const auditPath = join(ws.path, "audit-ext.jsonl");
    const audience = "instance:ext";
    const externalPath = resolve(ws.path, "..", "openclaw.json");
    const alias = "harness/openclaw.json";
    const ledger = new StewardAuthorizationLedger({ path: ledgerPath });
    assert.equal(
      ledger.initialize({
        instanceAudience: audience,
        maxStandingLifetimeMs: 86_400_000,
        maxStandingUses: 100,
        maxOneShotLifetimeMs: 3_600_000,
        allowedClockSkewMs: 300_000,
      }).ok,
      true,
    );
    const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
    const registry = new StewardRegistry({ ledger, backends });
    const key = await generateKey("ext");
    const stewardId = mintStewardIdV1();
    const attestation: StewardKeyAttestationV1 = {
      schemaVersion: 1,
      kind: "steward-key-attestation",
      attestationId: "att-ext",
      operation: "initial-bind",
      stewardId,
      audience,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: key.keyRef,
        publicKeyArmored: key.publicKeyArmored,
      },
      issuedAt: new Date().toISOString(),
      nonce: "5".repeat(32),
      reason: "external path",
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
      authorizationId: "authz-ext-1",
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
      expiresAt: new Date(now + 60_000).toISOString(),
      nonce: "6".repeat(32),
      maxUses: 1,
      reason: "external config patch",
    };
    assert.equal(
      (
        await service.admit({
          authorization: grant,
          format: "detached",
          signaturesArmored: [await signDetached(grant, key.privateKey)],
        })
      ).ok,
      true,
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
    const runtime = createEnforcementRuntime(
      {
        auditLogPath: auditPath,
        stewardAuthorizationLedgerPath: ledgerPath,
        dispositionMode: "unattended",
        approvalOn: ["code.patch"],
        standingAllowOn: [],
        outOfWorkspacePaths: { [externalPath]: alias },
      },
      {
        harnessId: "test",
        getWorkspacePaths: () => ({ workspaceRoot: ws.path }),
      },
    );

    const first = await runtime.onBeforeToolCall(
      {
        toolName: "apply_patch",
        params: { command },
        toolCallId: "tc-ext-1",
      },
      { toolCallId: "tc-ext-1" },
    );
    assert.equal(first.action, "allow");

    const audit = readFileSync(auditPath, "utf8").trim().split("\n");
    const last = JSON.parse(audit[audit.length - 1]!);
    assert.equal(last.decision, "allow");
    assert.equal(last.authorizationId, "authz-ext-1");
    assert.equal(last.stewardId, stewardId);
    assert.ok(typeof last.stewardLedgerEventHash === "string");

    const ledgerEvents = readFileSync(ledgerPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(
      ledgerEvents.some((event) => event.kind === "authorization_consumed"),
    );

    const second = await runtime.onBeforeToolCall(
      {
        toolName: "apply_patch",
        params: { command },
        toolCallId: "tc-ext-2",
      },
      { toolCallId: "tc-ext-2" },
    );
    assert.notEqual(second.action, "allow");
  });

  it("abstains without consuming when external map is missing or mismatched", async () => {
    const ledgerPath = join(ws.path, "ledger-miss.jsonl");
    const audience = "instance:miss";
    const externalPath = resolve(ws.path, "..", "openclaw-miss.json");
    const alias = "harness/openclaw.json";
    const ledger = new StewardAuthorizationLedger({ path: ledgerPath });
    ledger.initialize({
      instanceAudience: audience,
      maxStandingLifetimeMs: 86_400_000,
      maxStandingUses: 100,
      maxOneShotLifetimeMs: 3_600_000,
      allowedClockSkewMs: 300_000,
    });
    const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
    const registry = new StewardRegistry({ ledger, backends });
    const key = await generateKey("miss");
    const stewardId = mintStewardIdV1();
    const attestation: StewardKeyAttestationV1 = {
      schemaVersion: 1,
      kind: "steward-key-attestation",
      attestationId: "att-miss",
      operation: "initial-bind",
      stewardId,
      audience,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: key.keyRef,
        publicKeyArmored: key.publicKeyArmored,
      },
      issuedAt: new Date().toISOString(),
      nonce: "7".repeat(32),
      reason: "miss",
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
      authorizationId: "authz-miss",
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
      expiresAt: new Date(now + 60_000).toISOString(),
      nonce: "8".repeat(32),
      maxUses: 1,
      reason: "should remain unconsumed",
    };
    await service.admit({
      authorization: grant,
      format: "detached",
      signaturesArmored: [await signDetached(grant, key.privateKey)],
    });

    const command = [
      "*** Begin Patch",
      `*** Update File: ${externalPath}`,
      "@@",
      "-old",
      "+new",
      "*** End Patch",
      "",
    ].join("\n");

    for (const outOfWorkspacePaths of [
      {},
      { [externalPath]: "harness/wrong-alias.json" },
      { [resolve(ws.path, "..", "other.json")]: alias },
    ]) {
      const runtime = createEnforcementRuntime(
        {
          auditLogPath: join(ws.path, `audit-miss-${Object.keys(outOfWorkspacePaths).length}.jsonl`),
          stewardAuthorizationLedgerPath: ledgerPath,
          dispositionMode: "unattended",
          approvalOn: ["code.patch"],
          standingAllowOn: [],
          outOfWorkspacePaths,
        },
        {
          harnessId: "test",
          getWorkspacePaths: () => ({ workspaceRoot: ws.path }),
        },
      );
      const result = await runtime.onBeforeToolCall(
        {
          toolName: "apply_patch",
          params: { command },
          toolCallId: `tc-miss-${Object.keys(outOfWorkspacePaths).length}`,
        },
        { toolCallId: `tc-miss-${Object.keys(outOfWorkspacePaths).length}` },
      );
      assert.notEqual(result.action, "allow");
    }

    const ledgerEvents = readFileSync(ledgerPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(
      ledgerEvents.filter((event) => event.kind === "authorization_consumed")
        .length,
      0,
    );
  });
});
