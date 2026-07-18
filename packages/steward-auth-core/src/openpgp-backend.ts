/**
 * OpenPGP signature backend using the official `openpgp` package.
 * Does not enable insecure reformatted-key verification.
 */

import * as openpgp from "openpgp";
import type {
  ParsePublicKeyResult,
  SignatureBackend,
  SignatureVerifyResult,
  VerifyCleartextInput,
  VerifyDetachedInput,
} from "./signature-backend.js";

const PRIVATE_KEY_MARKERS = [
  "-----BEGIN PGP PRIVATE KEY BLOCK-----",
  "-----BEGIN PGP SECRET KEY BLOCK-----",
];

function isPrivateKeyArmor(armored: string): boolean {
  const upper = armored.toUpperCase();
  return PRIVATE_KEY_MARKERS.some((m) => upper.includes(m));
}

function toKeyRef(fingerprint: string): string {
  return `openpgp:${fingerprint.toLowerCase()}`;
}

function fail(reason: string): SignatureVerifyResult {
  return { ok: false, reason };
}

async function loadPublicKeys(
  armoredKeys: string[],
): Promise<
  | { ok: true; keys: openpgp.Key[]; byRef: Map<string, openpgp.Key> }
  | { ok: false; reason: string }
> {
  const keys: openpgp.Key[] = [];
  const byRef = new Map<string, openpgp.Key>();
  for (const armored of armoredKeys) {
    if (isPrivateKeyArmor(armored)) {
      return { ok: false, reason: "private key material is not accepted" };
    }
    let key: openpgp.Key;
    try {
      key = await openpgp.readKey({ armoredKey: armored });
    } catch (err) {
      return {
        ok: false,
        reason: `failed to parse public key: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (key.isPrivate()) {
      return { ok: false, reason: "private key material is not accepted" };
    }
    const fingerprint = key.getFingerprint().toLowerCase();
    const keyRef = toKeyRef(fingerprint);
    keys.push(key);
    byRef.set(keyRef, key);
  }
  return { ok: true, keys, byRef };
}

function resolvePrimaryKeyRef(
  signingKeyId: openpgp.KeyID,
  boundKeys: openpgp.Key[],
): string | undefined {
  for (const key of boundKeys) {
    try {
      const signer = key.getKeyIDs().some((id) => id.equals(signingKeyId))
        ? key
        : undefined;
      if (signer) {
        return toKeyRef(key.getFingerprint());
      }
      // Subkey may sign; resolve through the primary certificate.
      const subkeys = key.getSubkeys();
      for (const sub of subkeys) {
        if (sub.getKeyID().equals(signingKeyId)) {
          return toKeyRef(key.getFingerprint());
        }
      }
    } catch {
      // continue
    }
  }
  return undefined;
}

async function checkSignatureTime(
  signaturePacket: { created?: Date | null } | undefined,
  issuedAt: string,
  allowedClockSkewMs: number,
): Promise<string | undefined> {
  const issuedMs = Date.parse(issuedAt);
  if (Number.isNaN(issuedMs)) {
    return "issuedAt must be ISO-8601";
  }
  const created = signaturePacket?.created;
  if (!(created instanceof Date) || Number.isNaN(created.getTime())) {
    return "signature missing creation time";
  }
  const delta = Math.abs(created.getTime() - issuedMs);
  if (delta > allowedClockSkewMs) {
    return "signature creation time exceeds issuedAt clock skew";
  }
  return undefined;
}

type OpenPgpVerificationSignature = Awaited<
  ReturnType<typeof openpgp.verify>
>["signatures"][number];

async function collectVerifiedKeyRefs(
  signatures: OpenPgpVerificationSignature[],
  boundKeys: openpgp.Key[],
  expectedKeyRefs: string[],
  issuedAt: string,
  allowedClockSkewMs: number,
): Promise<SignatureVerifyResult> {
  const verifiedRefs = new Set<string>();
  for (const sig of signatures) {
    try {
      await sig.verified;
    } catch (err) {
      return fail(
        `signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const primaryRef = resolvePrimaryKeyRef(sig.keyID, boundKeys);
    if (!primaryRef) {
      return fail("signing key could not be resolved to a bound primary certificate");
    }
    const resolvedSig = await sig.signature;
    const packet = resolvedSig.packets[0] as
      | { created?: Date | null }
      | undefined;
    const timeErr = await checkSignatureTime(
      packet,
      issuedAt,
      allowedClockSkewMs,
    );
    if (timeErr) {
      return fail(timeErr);
    }
    verifiedRefs.add(primaryRef);
  }

  for (const expected of expectedKeyRefs) {
    if (!verifiedRefs.has(expected.toLowerCase())) {
      return fail(`missing required signature from ${expected}`);
    }
  }

  const signingKeyRefs = expectedKeyRefs.map((r) => r.toLowerCase());
  return {
    ok: true,
    signingKeyRefs,
    primaryFingerprints: signingKeyRefs.map((r) => r.slice("openpgp:".length)),
  };
}

export function createOpenPgpBackend(): SignatureBackend {
  return {
    algorithm: "openpgp",

    async parsePublicKey(armored: string): Promise<ParsePublicKeyResult> {
      if (isPrivateKeyArmor(armored)) {
        return { ok: false, reason: "private key material is not accepted" };
      }
      try {
        const key = await openpgp.readKey({ armoredKey: armored });
        if (key.isPrivate()) {
          return { ok: false, reason: "private key material is not accepted" };
        }
        const fingerprint = key.getFingerprint().toLowerCase();
        return {
          ok: true,
          keyRef: toKeyRef(fingerprint),
          fingerprint,
          publicKeyArmored: key.armor(),
        };
      } catch (err) {
        return {
          ok: false,
          reason: `failed to parse public key: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },

    async verifyDetached(
      input: VerifyDetachedInput,
    ): Promise<SignatureVerifyResult> {
      if (input.expectedKeyRefs.length === 0) {
        return fail("expectedKeyRefs must be non-empty");
      }
      if (input.signaturesArmored.length === 0) {
        return fail("signaturesArmored must be non-empty");
      }
      const loaded = await loadPublicKeys(input.publicKeysArmored);
      if (!loaded.ok) return fail(loaded.reason);

      for (const ref of input.expectedKeyRefs) {
        if (!loaded.byRef.has(ref.toLowerCase())) {
          return fail(`expected key ref not present in publicKeysArmored: ${ref}`);
        }
      }

      const message = await openpgp.createMessage({
        text: input.canonicalPayload,
      });

      const allResults: OpenPgpVerificationSignature[] = [];
      for (const armoredSignature of input.signaturesArmored) {
        let signature: openpgp.Signature;
        try {
          signature = await openpgp.readSignature({ armoredSignature });
        } catch (err) {
          return fail(
            `failed to parse signature: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        const verificationResult = await openpgp.verify({
          message,
          signature,
          verificationKeys: loaded.keys,
          // Do not enable allowInsecureVerificationWithReformattedKeys.
          config: {
            allowInsecureVerificationWithReformattedKeys: false,
          },
        });
        allResults.push(...verificationResult.signatures);
      }

      return collectVerifiedKeyRefs(
        allResults,
        loaded.keys,
        input.expectedKeyRefs,
        input.issuedAt,
        input.allowedClockSkewMs,
      );
    },

    async verifyCleartext(
      input: VerifyCleartextInput,
    ): Promise<SignatureVerifyResult> {
      if (input.expectedKeyRefs.length === 0) {
        return fail("expectedKeyRefs must be non-empty");
      }
      const loaded = await loadPublicKeys(input.publicKeysArmored);
      if (!loaded.ok) return fail(loaded.reason);

      for (const ref of input.expectedKeyRefs) {
        if (!loaded.byRef.has(ref.toLowerCase())) {
          return fail(`expected key ref not present in publicKeysArmored: ${ref}`);
        }
      }

      let signedMessage: openpgp.CleartextMessage;
      try {
        signedMessage = await openpgp.readCleartextMessage({
          cleartextMessage: input.cleartextArmored,
        });
      } catch (err) {
        return fail(
          `failed to parse cleartext message: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const extracted = signedMessage.getText();
      if (extracted !== input.expectedCanonicalPayload) {
        return fail(
          "cleartext payload does not exactly equal expected canonical JSON",
        );
      }

      const verificationResult = await openpgp.verify({
        message: signedMessage,
        verificationKeys: loaded.keys,
        config: {
          allowInsecureVerificationWithReformattedKeys: false,
        },
      });

      return collectVerifiedKeyRefs(
        verificationResult.signatures,
        loaded.keys,
        input.expectedKeyRefs,
        input.issuedAt,
        input.allowedClockSkewMs,
      );
    },
  };
}
