/**
 * Vertical-slice E2E: steward TOFU → signed one-shot code.patch → allow once → audit link.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
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
  PACKAGE_NAME as STEWARD_PKG,
} from "@ovrsr/fpp-steward-auth-core";
import {
  createEnforcementRuntime,
  type FppRuntimeAdapter,
} from "@ovrsr/fpp-enforcement-core";

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
