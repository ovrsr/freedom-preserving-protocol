/**
 * Versioned digests with optional domain separation.
 *
 * V1 entry hashes omit domain prefixes so historical audit chains verify.
 * V2 digests always include a domain label to prevent cross-type reuse.
 */

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { canonicalizeV1, canonicalizeV2 } from "./canonical-json.js";

/** Well-known digest domains for v2 payloads. */
export const DIGEST_DOMAINS = {
  entry: "fpp:v2:entry",
  claim: "fpp:v2:claim",
  leaf: "fpp:v2:merkle-leaf",
  node: "fpp:v2:merkle-node",
  receipt: "fpp:v2:receipt",
  capsule: "fpp:v2:capsule",
  evidence: "fpp:v2:evidence",
  adoption: "fpp:v2:adoption",
} as const;

export type DigestDomain =
  (typeof DIGEST_DOMAINS)[keyof typeof DIGEST_DOMAINS] | (string & {});

function sha256Hex(data: string): string {
  return bytesToHex(sha256(utf8ToBytes(data)));
}

/**
 * Historical v1 entry digest: SHA-256 of canonicalizeV1(entry without hash).
 */
export function hashEntryV1(entry: Record<string, unknown>): string {
  const { hash: _ignored, ...rest } = entry;
  void _ignored;
  return sha256Hex(canonicalizeV1(rest));
}

export type DigestInput =
  | { version: 1; value: unknown; domain?: never }
  | { version: 2; value: unknown; domain: DigestDomain };

/**
 * Compute a versioned digest. Version 2 requires a domain separator.
 */
export function digest(input: DigestInput): string {
  if (input.version === 1) {
    if (input.value !== null && typeof input.value === "object" && !Array.isArray(input.value)) {
      return hashEntryV1(input.value as Record<string, unknown>);
    }
    return sha256Hex(canonicalizeV1(input.value));
  }
  if (input.version === 2) {
    if (!input.domain || typeof input.domain !== "string") {
      throw new Error("digest version 2 requires a domain separator");
    }
    return sha256Hex(input.domain + "\0" + canonicalizeV2(input.value));
  }
  throw new Error(`unsupported digest version: ${(input as { version: unknown }).version}`);
}
