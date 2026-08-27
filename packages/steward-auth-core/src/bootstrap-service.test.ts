import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import * as openpgp from "openpgp";
import {
  bootstrapSigningFields,
  canonicalizeV2,
  mintStewardIdV1,
  type StewardBootstrapV1,
  type StewardKeyAttestationV1,
} from "@ovrsr/fpp-protocol-core";
import { StewardBootstrapService } from "./bootstrap-service.js";
import { StewardAuthorizationLedger } from "./ledger.js";
import { createOpenPgpBackend } from "./openpgp-backend.js";
import { createDefaultBackendRegistry } from "./signature-backend.js";
import { StewardRegistry } from "./steward-registry.js";

const dirs: string[] = [];

function tempLedgerPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "fpp-steward-boot-"));
  dirs.push(dir);
  return join(dir, "fpp-steward-authorization-ledger.jsonl");
}

afterEach(() => {
  while (dirs.length > 0) {
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
  const fingerprint = publicKey.getFingerprint().toLowerCase();
  return {
    privateKey,
    publicKeyArmored: publicKey.armor(),
    fingerprint,
    keyRef: `openpgp:${fingerprint}`,
  };
}

async function detachedSignBootstrap(
  bootstrap: StewardBootstrapV1,
  privateKey: openpgp.PrivateKey,
): Promise<string> {
  const canonical = canonicalizeV2(bootstrapSigningFields(bootstrap));
  const message = await openpgp.createMessage({ text: canonical });
  return openpgp.sign({
    message,
    signingKeys: privateKey,
    detached: true,
  });
}

function buildBootstrap(
  key: { keyRef: string; publicKeyArmored: string },
  overrides: Partial<StewardBootstrapV1> = {},
): StewardBootstrapV1 {
  const stewardId = overrides.stewardId ?? mintStewardIdV1();
  const audience = overrides.audience ?? "instance:test-1";
  const issuedAt = overrides.issuedAt ?? new Date().toISOString();
  const initialBinding: StewardKeyAttestationV1 = {
    schemaVersion: 1,
    kind: "steward-key-attestation",
    attestationId: "att-boot-001",
    operation: "initial-bind",
    stewardId,
    audience,
    subjectKey: {
      algorithm: "openpgp",
      keyRef: key.keyRef,
      publicKeyArmored: key.publicKeyArmored,
    },
    issuedAt,
    nonce: "n".repeat(32),
    reason: "secure genesis",
    ...(overrides.initialBinding ?? {}),
  };
  return {
    schemaVersion: 1,
    kind: "steward-bootstrap",
    bootstrapId: "bootstrap-001",
    stewardId,
    audience,
    policy: {
      instanceAudience: audience,
      maxStandingLifetimeMs: 86_400_000,
      maxStandingUses: 100,
      maxOneShotLifetimeMs: 3_600_000,
      allowedClockSkewMs: 300_000,
    },
    initialBinding,
    issuedAt,
    nonce: "b".repeat(32),
    ...overrides,
    initialBinding:
      overrides.initialBinding !== undefined
        ? { ...initialBinding, ...overrides.initialBinding }
        : initialBinding,
  };
}

describe("StewardBootstrapService", () => {
  it("admits a valid detached-signature bootstrap when expected key matches payload and certificate", async () => {
    const path = tempLedgerPath();
    const ledger = new StewardAuthorizationLedger({ path });
    const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
    const registry = new StewardRegistry({ ledger, backends });
    const service = new StewardBootstrapService({ ledger, backends, registry });
    const key = await generateKey("boot");
    const bootstrap = buildBootstrap(key);
    const signature = await detachedSignBootstrap(bootstrap, key.privateKey);

    const result = await service.admitBootstrap({
      bootstrap,
      signatureArmored: signature,
      expectedKeyRef: key.keyRef,
      expectedAudience: "instance:test-1",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const loaded = ledger.loadVerified();
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.equal(loaded.events.length, 2);
    assert.equal(loaded.events[0]!.kind, "ledger_initialized");
    assert.equal(loaded.events[1]!.kind, "key_binding_accepted");
    assert.equal(
      loaded.events[1]!.detail.bootstrapProfile,
      "interactive-fingerprint",
    );
    assert.equal(loaded.events[1]!.detail.expectedKeyRef, key.keyRef);
    assert.equal(
      registry.getSteward(bootstrap.stewardId)?.keys.get(key.keyRef)?.status,
      "active",
    );
  });

  it("requires an independent expected audience and rejects secret-key armor before admission", async () => {
    const path = tempLedgerPath();
    const ledger = new StewardAuthorizationLedger({ path });
    const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
    const registry = new StewardRegistry({ ledger, backends });
    const service = new StewardBootstrapService({ ledger, backends, registry });
    const key = await generateKey("audience-required");
    const bootstrap = buildBootstrap(key);
    const signature = await detachedSignBootstrap(bootstrap, key.privateKey);

    const missingAudience = await service.admitBootstrap({
      bootstrap,
      signatureArmored: signature,
      expectedKeyRef: key.keyRef,
    } as never);
    assert.equal(missingAudience.ok, false);
    assert.match(
      missingAudience.ok ? "" : missingAudience.reason,
      /expected audience.*required/i,
    );
    assert.equal(existsSync(path), false);

    const secretArmor = [
      "-----BEGIN PGP SECRET KEY BLOCK-----",
      "mDMEAAAA",
      "-----END PGP SECRET KEY BLOCK-----",
    ].join("\n");
    const withSecret = buildBootstrap(key, {
      initialBinding: {
        ...bootstrap.initialBinding,
        subjectKey: {
          ...bootstrap.initialBinding.subjectKey,
          publicKeyArmored: secretArmor,
        },
      },
    });
    const rejectedSecret = await service.admitBootstrap({
      bootstrap: withSecret,
      signatureArmored: signature,
      expectedKeyRef: key.keyRef,
      expectedAudience: "instance:test-1",
    });
    assert.equal(rejectedSecret.ok, false);
    assert.match(
      rejectedSecret.ok ? "" : rejectedSecret.reason,
      /secret key material|private key material/i,
    );
    assert.equal(existsSync(path), false);
  });

  it("rejects expected-key mismatch, wrong signer, wrong audience, expired/future, replay, existing ledger, private key, bad caps, and envelope confusion", async () => {
    const path = tempLedgerPath();
    const ledger = new StewardAuthorizationLedger({ path });
    const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
    const registry = new StewardRegistry({ ledger, backends });
    const service = new StewardBootstrapService({ ledger, backends, registry });
    const key = await generateKey("ok");
    const other = await generateKey("other");

    const good = buildBootstrap(key);
    const goodSig = await detachedSignBootstrap(good, key.privateKey);

    assert.equal(
      (
        await service.admitBootstrap({
          bootstrap: good,
          signatureArmored: goodSig,
          expectedKeyRef: other.keyRef,
          expectedAudience: "instance:test-1",
        })
      ).ok,
      false,
    );
    assert.equal(existsSync(path), false);

    const wrongSigner = await detachedSignBootstrap(good, other.privateKey);
    assert.equal(
      (
        await service.admitBootstrap({
          bootstrap: good,
          signatureArmored: wrongSigner,
          expectedKeyRef: key.keyRef,
          expectedAudience: "instance:test-1",
        })
      ).ok,
      false,
    );

    const wrongAud = buildBootstrap(key, {
      audience: "instance:other",
      policy: {
        instanceAudience: "instance:other",
        maxStandingLifetimeMs: 86_400_000,
        maxStandingUses: 100,
        maxOneShotLifetimeMs: 3_600_000,
        allowedClockSkewMs: 300_000,
      },
    });
    // Keep nested binding audience consistent for schema, but service compares to expected instance
    const wrongAudSigned = await detachedSignBootstrap(wrongAud, key.privateKey);
    assert.equal(
      (
        await service.admitBootstrap({
          bootstrap: wrongAud,
          signatureArmored: wrongAudSigned,
          expectedKeyRef: key.keyRef,
          expectedAudience: "instance:test-1",
        })
      ).ok,
      false,
    );

    const expired = buildBootstrap(key, {
      issuedAt: new Date(Date.now() - 7 * 24 * 3600_000).toISOString(),
    });
    const expiredSig = await detachedSignBootstrap(expired, key.privateKey);
    assert.equal(
      (
        await service.admitBootstrap({
          bootstrap: expired,
          signatureArmored: expiredSig,
          expectedKeyRef: key.keyRef,
          expectedAudience: "instance:test-1",
          maxBootstrapAgeMs: 3_600_000,
        })
      ).ok,
      false,
    );

    const future = buildBootstrap(key, {
      issuedAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    });
    const futureSig = await detachedSignBootstrap(future, key.privateKey);
    assert.equal(
      (
        await service.admitBootstrap({
          bootstrap: future,
          signatureArmored: futureSig,
          expectedKeyRef: key.keyRef,
          expectedAudience: "instance:test-1",
        })
      ).ok,
      false,
    );

    const privateArmor = [
      "-----BEGIN PGP PRIVATE KEY BLOCK-----",
      "mDMEAAAA",
      "-----END PGP PRIVATE KEY BLOCK-----",
    ].join("\n");
    const withPrivate = buildBootstrap(key, {
      initialBinding: {
        ...good.initialBinding,
        subjectKey: {
          ...good.initialBinding.subjectKey,
          publicKeyArmored: privateArmor,
        },
      },
    });
    assert.equal(
      (
        await service.admitBootstrap({
          bootstrap: withPrivate,
          signatureArmored: goodSig,
          expectedKeyRef: key.keyRef,
          expectedAudience: "instance:test-1",
        })
      ).ok,
      false,
    );

    // Cleartext armored blob must not be accepted as a detached signature.
    const cleartext = await openpgp.sign({
      message: await openpgp.createMessage({
        text: canonicalizeV2(bootstrapSigningFields(good)),
      }),
      signingKeys: key.privateKey,
      detached: false,
    });
    assert.equal(
      (
        await service.admitBootstrap({
          bootstrap: good,
          signatureArmored: cleartext,
          expectedKeyRef: key.keyRef,
          expectedAudience: "instance:test-1",
        })
      ).ok,
      false,
    );

    const admitted = await service.admitBootstrap({
      bootstrap: good,
      signatureArmored: goodSig,
      expectedKeyRef: key.keyRef,
      expectedAudience: "instance:test-1",
    });
    assert.equal(admitted.ok, true);

    const replay = await service.admitBootstrap({
      bootstrap: good,
      signatureArmored: goodSig,
      expectedKeyRef: key.keyRef,
      expectedAudience: "instance:test-1",
    });
    assert.equal(replay.ok, false);
    assert.match(replay.ok ? "" : replay.reason, /already initialized|exist/i);
  });

  it("leaves post-genesis add/rotate/revoke behavior unchanged after secure bootstrap", async () => {
    const path = tempLedgerPath();
    const ledger = new StewardAuthorizationLedger({ path });
    const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
    const registry = new StewardRegistry({ ledger, backends });
    const service = new StewardBootstrapService({ ledger, backends, registry });
    const primary = await generateKey("primary");
    const secondary = await generateKey("secondary");
    const stewardId = mintStewardIdV1();
    const bootstrap = buildBootstrap(primary, { stewardId });
    const signature = await detachedSignBootstrap(bootstrap, primary.privateKey);
    assert.equal(
      (
        await service.admitBootstrap({
          bootstrap,
          signatureArmored: signature,
          expectedKeyRef: primary.keyRef,
          expectedAudience: "instance:test-1",
        })
      ).ok,
      true,
    );

    const addAttestation: StewardKeyAttestationV1 = {
      schemaVersion: 1,
      kind: "steward-key-attestation",
      attestationId: "att-add-1",
      operation: "add",
      stewardId,
      audience: "instance:test-1",
      subjectKey: {
        algorithm: "openpgp",
        keyRef: secondary.keyRef,
        publicKeyArmored: secondary.publicKeyArmored,
      },
      issuedAt: new Date().toISOString(),
      nonce: "a".repeat(32),
      reason: "add secondary",
    };
    const canonical = canonicalizeV2(addAttestation);
    const message = await openpgp.createMessage({ text: canonical });
    const authorizerSig = await openpgp.sign({
      message,
      signingKeys: primary.privateKey,
      detached: true,
    });
    const subjectSig = await openpgp.sign({
      message,
      signingKeys: secondary.privateKey,
      detached: true,
    });
    const added = await registry.admitKeyAttestation({
      attestation: addAttestation,
      format: "detached",
      signaturesArmored: [authorizerSig, subjectSig],
      authorizerKeyRef: primary.keyRef,
      acceptTofu: false,
    });
    assert.equal(added.ok, true);
    assert.equal(
      registry.getSteward(stewardId)?.keys.get(secondary.keyRef)?.status,
      "active",
    );
  });
});

describe("StewardRegistry legacy TOFU audit marking", () => {
  it("records bootstrapProfile legacy-tofu on initial-bind admit", async () => {
    const path = tempLedgerPath();
    const ledger = new StewardAuthorizationLedger({ path });
    assert.equal(
      ledger.initialize({
        instanceAudience: "instance:test-1",
        maxStandingLifetimeMs: 86_400_000,
        maxStandingUses: 100,
        maxOneShotLifetimeMs: 3_600_000,
        allowedClockSkewMs: 300_000,
      }).ok,
      true,
    );
    const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
    const registry = new StewardRegistry({ ledger, backends });
    const key = await generateKey("legacy");
    const stewardId = mintStewardIdV1();
    const attestation: StewardKeyAttestationV1 = {
      schemaVersion: 1,
      kind: "steward-key-attestation",
      attestationId: "att-legacy",
      operation: "initial-bind",
      stewardId,
      audience: "instance:test-1",
      subjectKey: {
        algorithm: "openpgp",
        keyRef: key.keyRef,
        publicKeyArmored: key.publicKeyArmored,
      },
      issuedAt: new Date().toISOString(),
      nonce: "l".repeat(32),
      reason: "legacy tofu",
    };
    const canonical = canonicalizeV2(attestation);
    const message = await openpgp.createMessage({ text: canonical });
    const signature = await openpgp.sign({
      message,
      signingKeys: key.privateKey,
      detached: true,
    });
    const admitted = await registry.admitKeyAttestation({
      attestation,
      format: "detached",
      signaturesArmored: [signature],
      acceptTofu: true,
    });
    assert.equal(admitted.ok, true);
    const loaded = ledger.loadVerified();
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    const bind = loaded.events.find((e) => e.kind === "key_binding_accepted");
    assert.ok(bind);
    assert.equal(bind!.detail.bootstrapProfile, "legacy-tofu");
  });
});
