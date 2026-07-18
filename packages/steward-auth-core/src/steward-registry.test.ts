import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import * as openpgp from "openpgp";
import {
  canonicalizeV2,
  mintStewardIdV1,
  type StewardKeyAttestationV1,
} from "@ovrsr/fpp-protocol-core";
import { StewardAuthorizationLedger } from "./ledger.js";
import { createOpenPgpBackend } from "./openpgp-backend.js";
import { createDefaultBackendRegistry } from "./signature-backend.js";
import { StewardRegistry } from "./steward-registry.js";

const dirs: string[] = [];

function tempLedgerPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "fpp-steward-reg-"));
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

async function detachedSign(
  payload: StewardKeyAttestationV1,
  keys: openpgp.PrivateKey[],
): Promise<{ canonical: string; signatures: string[] }> {
  const canonical = canonicalizeV2(payload);
  const message = await openpgp.createMessage({ text: canonical });
  const signatures: string[] = [];
  for (const signingKey of keys) {
    signatures.push(
      await openpgp.sign({
        message,
        signingKeys: signingKey,
        detached: true,
      }),
    );
  }
  return { canonical, signatures };
}

function baseAttestation(
  overrides: Partial<StewardKeyAttestationV1> &
    Pick<
      StewardKeyAttestationV1,
      "attestationId" | "operation" | "stewardId" | "subjectKey" | "nonce"
    >,
): StewardKeyAttestationV1 {
  return {
    schemaVersion: 1,
    kind: "steward-key-attestation",
    audience: "instance:test-1",
    issuedAt: new Date().toISOString(),
    reason: "test",
    ...overrides,
  };
}

const POLICY = {
  instanceAudience: "instance:test-1",
  maxStandingLifetimeMs: 86_400_000,
  maxStandingUses: 100,
  maxOneShotLifetimeMs: 3_600_000,
  allowedClockSkewMs: 300_000,
} as const;

function createRegistry(path: string): StewardRegistry {
  const ledger = new StewardAuthorizationLedger({ path });
  assert.equal(ledger.initialize({ ...POLICY }).ok, true);
  return new StewardRegistry({
    ledger,
    backends: createDefaultBackendRegistry([createOpenPgpBackend()]),
  });
}

describe("StewardRegistry", () => {
  it("mints a stable steward id independent of keys", () => {
    const a = mintStewardIdV1();
    const b = mintStewardIdV1();
    assert.match(a, /^fpp:steward:v1:[a-z2-7]{26}$/);
    assert.notEqual(a, b);
  });

  it("admits initial self-signed binding only with explicit TOFU acknowledgement", async () => {
    const path = tempLedgerPath();
    const registry = createRegistry(path);
    const key = await generateKey("tofu");
    const stewardId = mintStewardIdV1();
    const attestation = baseAttestation({
      attestationId: "att-initial",
      operation: "initial-bind",
      stewardId,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: key.keyRef,
        publicKeyArmored: key.publicKeyArmored,
      },
      nonce: "n".repeat(32),
    });
    const signed = await detachedSign(attestation, [key.privateKey]);

    const withoutTofu = await registry.admitKeyAttestation({
      attestation,
      format: "detached",
      signaturesArmored: signed.signatures,
      acceptTofu: false,
    });
    assert.equal(withoutTofu.ok, false);

    const withTofu = await registry.admitKeyAttestation({
      attestation,
      format: "detached",
      signaturesArmored: signed.signatures,
      acceptTofu: true,
    });
    assert.equal(withTofu.ok, true);
    const state = registry.getSteward(stewardId);
    assert.ok(state);
    assert.equal(state!.keys.get(key.keyRef)?.status, "active");
  });

  it("rejects wrong fingerprint, wrong audience, and replayed attestation", async () => {
    const path = tempLedgerPath();
    const registry = createRegistry(path);
    const key = await generateKey("wrong");
    const other = await generateKey("other");
    const stewardId = mintStewardIdV1();

    const wrongFp = baseAttestation({
      attestationId: "att-wrong-fp",
      operation: "initial-bind",
      stewardId,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: other.keyRef,
        publicKeyArmored: key.publicKeyArmored,
      },
      nonce: "a".repeat(32),
    });
    const signedWrong = await detachedSign(wrongFp, [key.privateKey]);
    assert.equal(
      (
        await registry.admitKeyAttestation({
          attestation: wrongFp,
          format: "detached",
          signaturesArmored: signedWrong.signatures,
          acceptTofu: true,
        })
      ).ok,
      false,
    );

    const wrongAud = baseAttestation({
      attestationId: "att-wrong-aud",
      operation: "initial-bind",
      stewardId,
      audience: "instance:other",
      subjectKey: {
        algorithm: "openpgp",
        keyRef: key.keyRef,
        publicKeyArmored: key.publicKeyArmored,
      },
      nonce: "b".repeat(32),
    });
    const signedAud = await detachedSign(wrongAud, [key.privateKey]);
    assert.equal(
      (
        await registry.admitKeyAttestation({
          attestation: wrongAud,
          format: "detached",
          signaturesArmored: signedAud.signatures,
          acceptTofu: true,
        })
      ).ok,
      false,
    );

    const okAtt = baseAttestation({
      attestationId: "att-ok",
      operation: "initial-bind",
      stewardId,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: key.keyRef,
        publicKeyArmored: key.publicKeyArmored,
      },
      nonce: "c".repeat(32),
    });
    const signedOk = await detachedSign(okAtt, [key.privateKey]);
    assert.equal(
      (
        await registry.admitKeyAttestation({
          attestation: okAtt,
          format: "detached",
          signaturesArmored: signedOk.signatures,
          acceptTofu: true,
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await registry.admitKeyAttestation({
          attestation: okAtt,
          format: "detached",
          signaturesArmored: signedOk.signatures,
          acceptTofu: true,
        })
      ).ok,
      false,
    );
  });

  it("supports dual-signed add, rotation retirement, and revocation", async () => {
    const path = tempLedgerPath();
    const registry = createRegistry(path);
    const primary = await generateKey("primary");
    const secondary = await generateKey("secondary");
    const rotated = await generateKey("rotated");
    const stewardId = mintStewardIdV1();

    const initial = baseAttestation({
      attestationId: "att-init",
      operation: "initial-bind",
      stewardId,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: primary.keyRef,
        publicKeyArmored: primary.publicKeyArmored,
      },
      nonce: "d".repeat(32),
    });
    assert.equal(
      (
        await registry.admitKeyAttestation({
          attestation: initial,
          format: "detached",
          signaturesArmored: (
            await detachedSign(initial, [primary.privateKey])
          ).signatures,
          acceptTofu: true,
        })
      ).ok,
      true,
    );

    const add = baseAttestation({
      attestationId: "att-add",
      operation: "add",
      stewardId,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: secondary.keyRef,
        publicKeyArmored: secondary.publicKeyArmored,
      },
      nonce: "e".repeat(32),
    });
    assert.equal(
      (
        await registry.admitKeyAttestation({
          attestation: add,
          format: "detached",
          signaturesArmored: (
            await detachedSign(add, [
              primary.privateKey,
              secondary.privateKey,
            ])
          ).signatures,
          authorizerKeyRef: primary.keyRef,
          acceptTofu: false,
        })
      ).ok,
      true,
    );
    assert.equal(registry.getSteward(stewardId)!.keys.size, 2);

    const rotate = baseAttestation({
      attestationId: "att-rotate",
      operation: "rotate",
      stewardId,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: rotated.keyRef,
        publicKeyArmored: rotated.publicKeyArmored,
      },
      replacesKeyRef: primary.keyRef,
      nonce: "f".repeat(32),
    });
    assert.equal(
      (
        await registry.admitKeyAttestation({
          attestation: rotate,
          format: "detached",
          signaturesArmored: (
            await detachedSign(rotate, [
              secondary.privateKey,
              rotated.privateKey,
            ])
          ).signatures,
          authorizerKeyRef: secondary.keyRef,
          acceptTofu: false,
        })
      ).ok,
      true,
    );
    assert.equal(
      registry.getSteward(stewardId)!.keys.get(primary.keyRef)?.status,
      "retired",
    );
    assert.equal(
      registry.getSteward(stewardId)!.keys.get(rotated.keyRef)?.status,
      "active",
    );

    const revoke = baseAttestation({
      attestationId: "att-revoke",
      operation: "revoke",
      stewardId,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: secondary.keyRef,
        publicKeyArmored: secondary.publicKeyArmored,
      },
      nonce: "g".repeat(32),
      reason: "retire secondary",
    });
    assert.equal(
      (
        await registry.admitKeyAttestation({
          attestation: revoke,
          format: "detached",
          signaturesArmored: (
            await detachedSign(revoke, [rotated.privateKey])
          ).signatures,
          authorizerKeyRef: rotated.keyRef,
          acceptTofu: false,
        })
      ).ok,
      true,
    );
    assert.equal(
      registry.getSteward(stewardId)!.keys.get(secondary.keyRef)?.status,
      "revoked",
    );
  });

  it("rejects revoked authorizer and fails closed with no active keys", async () => {
    const path = tempLedgerPath();
    const registry = createRegistry(path);
    const key = await generateKey("solo");
    const stewardId = mintStewardIdV1();
    const initial = baseAttestation({
      attestationId: "att-solo",
      operation: "initial-bind",
      stewardId,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: key.keyRef,
        publicKeyArmored: key.publicKeyArmored,
      },
      nonce: "h".repeat(32),
    });
    assert.equal(
      (
        await registry.admitKeyAttestation({
          attestation: initial,
          format: "detached",
          signaturesArmored: (await detachedSign(initial, [key.privateKey]))
            .signatures,
          acceptTofu: true,
        })
      ).ok,
      true,
    );

    const revokeSelf = baseAttestation({
      attestationId: "att-revoke-self",
      operation: "revoke",
      stewardId,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: key.keyRef,
        publicKeyArmored: key.publicKeyArmored,
      },
      nonce: "i".repeat(32),
    });
    assert.equal(
      (
        await registry.admitKeyAttestation({
          attestation: revokeSelf,
          format: "detached",
          signaturesArmored: (
            await detachedSign(revokeSelf, [key.privateKey])
          ).signatures,
          authorizerKeyRef: key.keyRef,
          acceptTofu: false,
        })
      ).ok,
      true,
    );
    assert.equal(registry.hasActiveKey(stewardId), false);

    const other = await generateKey("too-late");
    const add = baseAttestation({
      attestationId: "att-too-late",
      operation: "add",
      stewardId,
      subjectKey: {
        algorithm: "openpgp",
        keyRef: other.keyRef,
        publicKeyArmored: other.publicKeyArmored,
      },
      nonce: "j".repeat(32),
    });
    assert.equal(
      (
        await registry.admitKeyAttestation({
          attestation: add,
          format: "detached",
          signaturesArmored: (
            await detachedSign(add, [key.privateKey, other.privateKey])
          ).signatures,
          authorizerKeyRef: key.keyRef,
          acceptTofu: false,
        })
      ).ok,
      false,
    );
  });
});
