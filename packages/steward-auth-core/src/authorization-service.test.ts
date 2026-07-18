import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import * as openpgp from "openpgp";
import {
  canonicalizeV2,
  mintStewardIdV1,
  type OperatorAuthorizationV1,
  type StewardKeyAttestationV1,
} from "@ovrsr/fpp-protocol-core";
import { AuthorizationService } from "./authorization-service.js";
import { StewardAuthorizationLedger } from "./ledger.js";
import { createOpenPgpBackend } from "./openpgp-backend.js";
import { createDefaultBackendRegistry } from "./signature-backend.js";
import { StewardRegistry } from "./steward-registry.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

const POLICY = {
  instanceAudience: "instance:test-1",
  maxStandingLifetimeMs: 86_400_000,
  maxStandingUses: 100,
  maxOneShotLifetimeMs: 3_600_000,
  allowedClockSkewMs: 300_000,
} as const;

async function generateKey(name: string) {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name, email: `${name}@example.test` }],
    format: "object",
  });
  const fingerprint = publicKey.getFingerprint().toLowerCase();
  return {
    privateKey,
    publicKeyArmored: publicKey.armor(),
    keyRef: `openpgp:${fingerprint}`,
  };
}

async function signDetached(payload: object, key: openpgp.PrivateKey) {
  const canonical = canonicalizeV2(payload);
  const message = await openpgp.createMessage({ text: canonical });
  return openpgp.sign({ message, signingKeys: key, detached: true });
}

async function signCleartext(payload: object, key: openpgp.PrivateKey) {
  const canonical = canonicalizeV2(payload);
  return openpgp.sign({
    message: await openpgp.createCleartextMessage({ text: canonical }),
    signingKeys: key,
  });
}

async function bootstrap() {
  const dir = mkdtempSync(join(tmpdir(), "fpp-authz-"));
  dirs.push(dir);
  const path = join(dir, "ledger.jsonl");
  const ledger = new StewardAuthorizationLedger({ path });
  assert.equal(ledger.initialize({ ...POLICY }).ok, true);
  const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
  const registry = new StewardRegistry({ ledger, backends });
  const key = await generateKey("op");
  const stewardId = mintStewardIdV1();
  const attestation: StewardKeyAttestationV1 = {
    schemaVersion: 1,
    kind: "steward-key-attestation",
    attestationId: "att-1",
    operation: "initial-bind",
    stewardId,
    audience: POLICY.instanceAudience,
    subjectKey: {
      algorithm: "openpgp",
      keyRef: key.keyRef,
      publicKeyArmored: key.publicKeyArmored,
    },
    issuedAt: new Date().toISOString(),
    nonce: "k".repeat(32),
    reason: "bootstrap",
  };
  const sig = await signDetached(attestation, key.privateKey);
  assert.equal(
    (
      await registry.admitKeyAttestation({
        attestation,
        format: "detached",
        signaturesArmored: [sig],
        acceptTofu: true,
      })
    ).ok,
    true,
  );
  const service = new AuthorizationService({ ledger, backends, registry });
  return { service, key, stewardId, ledger, registry };
}

function authz(
  stewardId: string,
  keyRef: string,
  overrides: Partial<OperatorAuthorizationV1> = {},
): OperatorAuthorizationV1 {
  const now = Date.now();
  return {
    schemaVersion: 1,
    kind: "operator-authorization",
    authorizationId: overrides.authorizationId ?? `authz-${now}`,
    stewardId,
    signingKeyRef: keyRef,
    audience: POLICY.instanceAudience,
    mode: "one-shot",
    scope: { classifications: ["code.patch"] },
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    nonce: overrides.nonce ?? `${"m".repeat(31)}${Math.random().toString(16).slice(2, 3)}`,
    maxUses: 1,
    reason: "test grant",
    ...overrides,
  };
}

describe("AuthorizationService", () => {
  it("admits valid detached and clear-signed grants", async () => {
    const { service, key, stewardId } = await bootstrap();
    const a = authz(stewardId, key.keyRef, {
      authorizationId: "authz-detached",
      nonce: "p".repeat(32),
    });
    const sig = await signDetached(a, key.privateKey);
    assert.equal(
      (
        await service.admit({
          authorization: a,
          format: "detached",
          signaturesArmored: [sig],
        })
      ).ok,
      true,
    );

    const b = authz(stewardId, key.keyRef, {
      authorizationId: "authz-clear",
      nonce: "q".repeat(32),
    });
    const clear = await signCleartext(b, key.privateKey);
    assert.equal(
      (
        await service.admit({
          authorization: b,
          format: "cleartext",
          cleartextArmored: clear,
        })
      ).ok,
      true,
    );
  });

  it("rejects wrong/unbound/expired/replayed/over-broad grants", async () => {
    const { service, key, stewardId } = await bootstrap();
    const other = await generateKey("other");
    const wrongKey = authz(stewardId, other.keyRef, {
      authorizationId: "authz-wrong",
      nonce: "r".repeat(32),
    });
    assert.equal(
      (
        await service.admit({
          authorization: wrongKey,
          format: "detached",
          signaturesArmored: [
            await signDetached(wrongKey, other.privateKey),
          ],
        })
      ).ok,
      false,
    );

    const expired = authz(stewardId, key.keyRef, {
      authorizationId: "authz-exp",
      nonce: "s".repeat(32),
      issuedAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-01-01T01:00:00.000Z",
    });
    assert.equal(
      (
        await service.admit({
          authorization: expired,
          format: "detached",
          signaturesArmored: [await signDetached(expired, key.privateKey)],
        })
      ).ok,
      false,
    );

    const good = authz(stewardId, key.keyRef, {
      authorizationId: "authz-replay",
      nonce: "t".repeat(32),
    });
    const goodSig = await signDetached(good, key.privateKey);
    assert.equal(
      (
        await service.admit({
          authorization: good,
          format: "detached",
          signaturesArmored: [goodSig],
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await service.admit({
          authorization: good,
          format: "detached",
          signaturesArmored: [goodSig],
        })
      ).ok,
      false,
    );

    const consent = authz(stewardId, key.keyRef, {
      authorizationId: "authz-consent",
      nonce: "u".repeat(32),
      scope: { classifications: ["affected-party-consent"] },
    });
    assert.equal(
      (
        await service.admit({
          authorization: consent,
          format: "detached",
          signaturesArmored: [await signDetached(consent, key.privateKey)],
        })
      ).ok,
      false,
    );
  });

  it("matches scope, consumes one-shot, and supports standing revoke/exhaust", async () => {
    const { service, key, stewardId } = await bootstrap();
    const grant = authz(stewardId, key.keyRef, {
      authorizationId: "authz-scope",
      nonce: "v".repeat(32),
      mode: "standing",
      maxUses: 2,
      scope: {
        classifications: ["code.patch"],
        toolNames: ["apply_patch"],
        resourcePaths: ["src/a.ts"],
      },
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
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

    const action = {
      classification: "code.patch",
      toolName: "apply_patch",
      resourcePaths: ["src/a.ts"],
      targetsAmbiguous: false,
    };
    const candidate = service.findCandidate(action);
    assert.equal(candidate.ok, true);
    if (!candidate.ok) return;

    const first = service.consumeIfValid(candidate.authorizationId, action);
    assert.equal(first.ok, true);
    const second = service.consumeIfValid(candidate.authorizationId, action);
    assert.equal(second.ok, true);
    const third = service.consumeIfValid(candidate.authorizationId, action);
    assert.equal(third.ok, false);
    if (!third.ok) assert.equal(third.reason, "exhausted");

    const mismatch = service.findCandidate({
      ...action,
      resourcePaths: ["src/b.ts"],
    });
    assert.equal(mismatch.ok, false);
  });

  it("revokes authorization and invalidates on key revoke", async () => {
    const { service, key, stewardId, registry } = await bootstrap();
    const grant = authz(stewardId, key.keyRef, {
      authorizationId: "authz-rev",
      nonce: "w".repeat(32),
      mode: "standing",
      maxUses: 5,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
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

    const revocation = {
      schemaVersion: 1 as const,
      kind: "operator-authorization-revocation" as const,
      authorizationId: "authz-rev",
      stewardId,
      signingKeyRef: key.keyRef,
      audience: POLICY.instanceAudience,
      issuedAt: new Date().toISOString(),
      nonce: "x".repeat(32),
      reason: "cancel",
    };
    assert.equal(
      (
        await service.admitRevocation({
          revocation,
          format: "detached",
          signaturesArmored: [await signDetached(revocation, key.privateKey)],
        })
      ).ok,
      true,
    );
    const action = {
      classification: "code.patch",
      toolName: "apply_patch",
      resourcePaths: [],
      targetsAmbiguous: false,
    };
    assert.equal(service.findCandidate(action).ok, false);

    // Fresh grant then revoke key
    const grant2 = authz(stewardId, key.keyRef, {
      authorizationId: "authz-keyrev",
      nonce: "y".repeat(32),
      mode: "standing",
      maxUses: 3,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    assert.equal(
      (
        await service.admit({
          authorization: grant2,
          format: "detached",
          signaturesArmored: [await signDetached(grant2, key.privateKey)],
        })
      ).ok,
      true,
    );
    const keyRevoke: StewardKeyAttestationV1 = {
      schemaVersion: 1,
      kind: "steward-key-attestation",
      attestationId: "att-keyrev",
      operation: "revoke",
      stewardId,
      audience: POLICY.instanceAudience,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: key.keyRef,
        publicKeyArmored: key.publicKeyArmored,
      },
      issuedAt: new Date().toISOString(),
      nonce: "z".repeat(32),
      reason: "compromise",
    };
    assert.equal(
      (
        await registry.admitKeyAttestation({
          attestation: keyRevoke,
          format: "detached",
          signaturesArmored: [await signDetached(keyRevoke, key.privateKey)],
          authorizerKeyRef: key.keyRef,
          acceptTofu: false,
        })
      ).ok,
      true,
    );
    service.rebuildFromLedger();
    assert.equal(service.findCandidate(action).ok, false);
  });
});
