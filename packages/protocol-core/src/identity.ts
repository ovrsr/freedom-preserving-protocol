/**
 * Key-bound agent identity primitives.
 *
 * V2 agent IDs are full key fingerprints: `fpp:ed25519:<sha256(pubkey)>`.
 * Legacy truncated aliases (`fpp-<16 hex>`) remain parseable for display and
 * migration but are never independent proof of identity.
 */

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export const KEY_ALGORITHM = "ed25519" as const;

export type ParsedAgentId =
  | { kind: "v2"; algorithm: typeof KEY_ALGORITHM; fingerprint: string; raw: string }
  | { kind: "legacy-alias"; fingerprintPrefix: string; raw: string }
  | { kind: "unknown"; raw: string };

function decodePublicKeyHex(publicKeyHex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(publicKeyHex)) {
    throw new Error("public key must be hex");
  }
  if (publicKeyHex.length !== 64) {
    throw new Error("public key must be 32 bytes (64 hex chars)");
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(publicKeyHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** SHA-256 fingerprint of the raw public key bytes (64 hex chars). */
export function fingerprintPublicKey(publicKeyHex: string): string {
  const bytes = decodePublicKeyHex(publicKeyHex);
  return bytesToHex(sha256(bytes));
}

/** V2 agent identifier bound to the full public-key fingerprint. */
export function deriveAgentIdV2(publicKeyHex: string): string {
  return `fpp:${KEY_ALGORITHM}:${fingerprintPublicKey(publicKeyHex)}`;
}

/**
 * Historical truncated alias: `fpp-` + first 16 hex chars of SHA-256(pubkey).
 * Labeled for migration/display only — not independent identity proof.
 */
export function deriveLegacyAlias(publicKeyHex: string): string {
  return "fpp-" + fingerprintPublicKey(publicKeyHex).slice(0, 16);
}

export function isLegacyAgentAlias(agentId: string): boolean {
  return /^fpp-[0-9a-f]{16}$/i.test(agentId);
}

export function parseAgentId(agentId: string): ParsedAgentId {
  const v2 = /^fpp:(ed25519):([0-9a-f]{64})$/i.exec(agentId);
  if (v2) {
    return {
      kind: "v2",
      algorithm: KEY_ALGORITHM,
      fingerprint: v2[2]!.toLowerCase(),
      raw: agentId,
    };
  }
  const legacy = /^fpp-([0-9a-f]{16})$/i.exec(agentId);
  if (legacy) {
    return {
      kind: "legacy-alias",
      fingerprintPrefix: legacy[1]!.toLowerCase(),
      raw: agentId,
    };
  }
  return { kind: "unknown", raw: agentId };
}

/**
 * Recompute the expected identifier from the public key and compare.
 * Legacy aliases match only when `allowLegacyAlias` is explicitly set.
 */
export function publicKeyMatchesAgentId(
  agentId: string,
  publicKeyHex: string,
  options: { allowLegacyAlias?: boolean } = {},
): boolean {
  const expectedV2 = deriveAgentIdV2(publicKeyHex);
  if (agentId === expectedV2) return true;
  if (options.allowLegacyAlias === true) {
    return agentId === deriveLegacyAlias(publicKeyHex);
  }
  return false;
}

export function verifySignature(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ed.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

export function signMessage(
  message: Uint8Array,
  privateKey: Uint8Array,
): Uint8Array {
  return ed.sign(message, privateKey);
}

export function publicKeyFromSeed(seed: Uint8Array): Uint8Array {
  return ed.getPublicKey(seed);
}
