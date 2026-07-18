/**
 * Signature backend registry — algorithm-qualified verification without
 * coupling callers to a specific OpenPGP implementation.
 */

export type SignatureVerifyOk = {
  ok: true;
  /** Primary certificate key refs that produced accepted signatures. */
  signingKeyRefs: string[];
  /** Lowercase primary fingerprints corresponding to signingKeyRefs. */
  primaryFingerprints: string[];
};

export type SignatureVerifyErr = {
  ok: false;
  reason: string;
};

export type SignatureVerifyResult = SignatureVerifyOk | SignatureVerifyErr;

export type ParsePublicKeyResult =
  | {
      ok: true;
      keyRef: string;
      fingerprint: string;
      publicKeyArmored: string;
    }
  | { ok: false; reason: string };

export type VerifyDetachedInput = {
  /** Exact canonical payload bytes that were signed (no trailing newline). */
  canonicalPayload: string;
  signaturesArmored: string[];
  publicKeysArmored: string[];
  /** Every listed key ref must contribute a valid signature. */
  expectedKeyRefs: string[];
  issuedAt: string;
  nowMs: number;
  allowedClockSkewMs: number;
};

export type VerifyCleartextInput = {
  cleartextArmored: string;
  /** Extracted cleartext must equal this canonical payload exactly. */
  expectedCanonicalPayload: string;
  publicKeysArmored: string[];
  expectedKeyRefs: string[];
  issuedAt: string;
  nowMs: number;
  allowedClockSkewMs: number;
};

export interface SignatureBackend {
  readonly algorithm: string;
  parsePublicKey(armored: string): Promise<ParsePublicKeyResult>;
  verifyDetached(input: VerifyDetachedInput): Promise<SignatureVerifyResult>;
  verifyCleartext(input: VerifyCleartextInput): Promise<SignatureVerifyResult>;
}

export class SignatureBackendRegistry {
  private readonly backends = new Map<string, SignatureBackend>();

  register(backend: SignatureBackend): void {
    this.backends.set(backend.algorithm, backend);
  }

  get(algorithm: string): SignatureBackend | undefined {
    return this.backends.get(algorithm);
  }

  require(algorithm: string): SignatureBackend {
    const backend = this.backends.get(algorithm);
    if (!backend) {
      throw new Error(`unsupported signature backend: ${algorithm}`);
    }
    return backend;
  }

  algorithms(): string[] {
    return [...this.backends.keys()].sort();
  }
}

export function createDefaultBackendRegistry(
  backends: SignatureBackend[] = [],
): SignatureBackendRegistry {
  const registry = new SignatureBackendRegistry();
  for (const backend of backends) {
    registry.register(backend);
  }
  return registry;
}
