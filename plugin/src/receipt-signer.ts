/**
 * Receipt signing for the enforcement plugin.
 *
 * Uses the same 32-byte Ed25519 seed format as the trust plugin so either
 * plugin can load/create the shared agent identity. Signing covers the
 * canonical v2 receipt payload (excluding signature/publicKey fields).
 * When signing is disabled, receipts are labeled unsigned-degraded and
 * must not elevate trust.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  DIGEST_DOMAINS,
  KEY_ALGORITHM,
  canonicalizeV2,
  deriveAgentIdV2,
  digest,
  fingerprintPublicKey,
  publicKeyMatchesAgentId,
  signMessage,
  verifySignature,
  type ConformanceReceiptV1,
} from "@ovrsr/fpp-protocol-core";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export const RECEIPT_CANONICALIZATION_VERSION = 2 as const;

export type ReceiptSignPayload = ConformanceReceiptV1 & Record<string, unknown>;

export type ReceiptSigner =
  | {
      mode: "signed";
      agentId: string;
      publicKeyHex: string;
      keyFingerprint: string;
      keyAlgorithm: typeof KEY_ALGORITHM;
      sign: (message: Uint8Array) => Uint8Array;
    }
  | {
      mode: "unsigned-degraded";
      agentId: "unsigned";
      publicKeyHex?: undefined;
      keyFingerprint?: undefined;
      keyAlgorithm?: undefined;
      sign?: undefined;
    };

export type SignedReceipt = ReceiptSignPayload & {
  signingStatus: "signed" | "unsigned-degraded";
  trustElevating: boolean;
  canonicalizationVersion: typeof RECEIPT_CANONICALIZATION_VERSION;
  keyAlgorithm?: typeof KEY_ALGORITHM | undefined;
  agentId?: string | undefined;
  publicKey?: string | undefined;
  keyFingerprint?: string | undefined;
  signature?: string | undefined;
  /** Domain-separated digest of the unsigned payload (for ledger chaining). */
  payloadDigest: string;
};

export type ReceiptVerifyResult = {
  valid: boolean;
  reason: string;
};

export type LoadReceiptSignerOptions = {
  keyPath: string;
  enabled: boolean;
  basePath?: string | undefined;
};

/**
 * Load or create a 32-byte Ed25519 seed at `keyPath` — identical on-disk
 * format to `plugin-trust/src/identity.ts::loadOrCreateIdentity`.
 */
export function loadReceiptSigner(
  options: LoadReceiptSignerOptions,
): ReceiptSigner {
  if (!options.enabled) {
    return { mode: "unsigned-degraded", agentId: "unsigned" };
  }
  const resolved = resolve(options.basePath ?? process.cwd(), options.keyPath);
  let seed: Uint8Array;
  if (existsSync(resolved)) {
    const raw = readFileSync(resolved);
    if (raw.length !== 32) {
      throw new Error(
        `FPP identity key at ${resolved} is malformed (expected 32 bytes, got ${raw.length})`,
      );
    }
    seed = new Uint8Array(raw);
  } else {
    seed = ed.utils.randomPrivateKey();
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, Buffer.from(seed), { mode: 0o600 });
  }
  const publicKey = ed.getPublicKey(seed);
  const publicKeyHex = Buffer.from(publicKey).toString("hex");
  return {
    mode: "signed",
    agentId: deriveAgentIdV2(publicKeyHex),
    publicKeyHex,
    keyFingerprint: fingerprintPublicKey(publicKeyHex),
    keyAlgorithm: KEY_ALGORITHM,
    sign: (message: Uint8Array) => signMessage(message, seed),
  };
}

function unsignedFields(payload: Record<string, unknown>): Record<string, unknown> {
  const {
    signature: _s,
    publicKey: _p,
    payloadDigest: _d,
    ...rest
  } = payload;
  void _s;
  void _p;
  void _d;
  return rest;
}

export function computeReceiptPayloadDigest(
  payload: Record<string, unknown>,
): string {
  return digest({
    version: 2,
    domain: DIGEST_DOMAINS.receipt,
    value: unsignedFields(payload),
  });
}

/**
 * Sign a finalized receipt payload. Call only after the receipt lifecycle
 * has reached a terminal outcome.
 */
export function signReceiptPayload(
  payload: ReceiptSignPayload,
  signer: ReceiptSigner,
): SignedReceipt {
  if (signer.mode === "unsigned-degraded") {
    const degraded: SignedReceipt = {
      ...payload,
      signingStatus: "unsigned-degraded",
      trustElevating: false,
      canonicalizationVersion: RECEIPT_CANONICALIZATION_VERSION,
      agentId: "unsigned",
      payloadDigest: "",
    };
    degraded.payloadDigest = computeReceiptPayloadDigest(degraded);
    return degraded;
  }

  const toSign: SignedReceipt = {
    ...payload,
    signingStatus: "signed",
    trustElevating: true,
    canonicalizationVersion: RECEIPT_CANONICALIZATION_VERSION,
    keyAlgorithm: signer.keyAlgorithm,
    agentId: signer.agentId,
    keyFingerprint: signer.keyFingerprint,
    payloadDigest: "",
  };
  toSign.payloadDigest = computeReceiptPayloadDigest(toSign);
  const message = new TextEncoder().encode(
    canonicalizeV2(unsignedFields(toSign)),
  );
  const sig = signer.sign(message);
  toSign.publicKey = signer.publicKeyHex;
  toSign.signature = Buffer.from(sig).toString("hex");
  return toSign;
}

export function verifyReceiptSignature(
  receipt: SignedReceipt,
): ReceiptVerifyResult {
  if (receipt.signingStatus === "unsigned-degraded" || !receipt.signature) {
    return {
      valid: false,
      reason: "unsigned-degraded receipt is not trust-elevating",
    };
  }
  if (!receipt.publicKey || !receipt.agentId) {
    return { valid: false, reason: "missing publicKey or agentId" };
  }
  if (!publicKeyMatchesAgentId(receipt.agentId, receipt.publicKey)) {
    return { valid: false, reason: "agentId does not match publicKey fingerprint" };
  }
  if (
    receipt.keyAlgorithm !== undefined &&
    receipt.keyAlgorithm !== KEY_ALGORITHM
  ) {
    return { valid: false, reason: "unsupported keyAlgorithm" };
  }

  let pubBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    pubBytes = Buffer.from(receipt.publicKey, "hex");
    sigBytes = Buffer.from(receipt.signature, "hex");
  } catch {
    return { valid: false, reason: "publicKey or signature is not valid hex" };
  }
  if (pubBytes.length !== 32) {
    return { valid: false, reason: "publicKey must be 32 bytes" };
  }
  if (sigBytes.length !== 64) {
    return { valid: false, reason: "signature must be 64 bytes" };
  }

  const message = new TextEncoder().encode(
    canonicalizeV2(unsignedFields(receipt as Record<string, unknown>)),
  );
  const ok = verifySignature(message, sigBytes, pubBytes);
  return ok
    ? { valid: true, reason: "signature verified" }
    : { valid: false, reason: "signature does not match receipt content" };
}
