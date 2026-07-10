/**
 * Signed constitutional claims for the FPP trust plugin.
 *
 * A ConstitutionalClaim is canonicalized (sorted-key JSON), then signed
 * with the agent's Ed25519 identity key. Peers verify by checking the
 * signature against the embedded publicKey and that agentId matches the key.
 */

import {
  KEY_ALGORITHM,
  canonicalize,
  publicKeyMatchesAgentId,
} from "@ovrsr/fpp-protocol-core";
import type { AgentIdentity } from "./identity.js";
import { verifySignature } from "./identity.js";
import type { ConstitutionalClaim } from "./handshake.js";

export { canonicalize };

export interface SignedClaim extends ConstitutionalClaim {
  publicKey: string;
  signature: string;
  keyAlgorithm?: string;
}

/**
 * Produce a signed claim from raw claim fields + identity.
 * The signature covers the canonical JSON of all claim fields except
 * `signature` and `publicKey` themselves. The v2 agentId and key algorithm
 * are bound into the signed payload.
 */
export function signClaim(
  claim: ConstitutionalClaim,
  identity: AgentIdentity,
): SignedClaim {
  const toSign: ConstitutionalClaim & { keyAlgorithm: string } = {
    ...claim,
    agentId: identity.agentId,
    keyAlgorithm: identity.keyAlgorithm,
  };
  const { keyAlgorithm, ...claimFields } = toSign;
  const payload = canonicalize({ ...claimFields, keyAlgorithm });
  const sig = identity.sign(new TextEncoder().encode(payload));
  return {
    ...claimFields,
    keyAlgorithm,
    publicKey: identity.publicKeyHex,
    signature: Buffer.from(sig).toString("hex"),
  };
}

export interface ClaimVerification {
  valid: boolean;
  reason: string;
}

/**
 * Verify that a signed claim's agentId matches its publicKey and that the
 * signature covers the canonical claim content.
 */
export function verifyClaim(claim: SignedClaim): ClaimVerification {
  if (!claim.publicKey || !claim.signature) {
    return { valid: false, reason: "missing publicKey or signature" };
  }

  let pubBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    pubBytes = Buffer.from(claim.publicKey, "hex");
    sigBytes = Buffer.from(claim.signature, "hex");
  } catch {
    return { valid: false, reason: "publicKey or signature is not valid hex" };
  }

  if (pubBytes.length !== 32) {
    return { valid: false, reason: "publicKey must be 32 bytes (64 hex chars)" };
  }
  if (sigBytes.length !== 64) {
    return { valid: false, reason: "signature must be 64 bytes (128 hex chars)" };
  }

  if (!publicKeyMatchesAgentId(claim.agentId, claim.publicKey)) {
    return {
      valid: false,
      reason: "agentId does not match publicKey fingerprint",
    };
  }

  if (
    claim.keyAlgorithm !== undefined &&
    claim.keyAlgorithm !== KEY_ALGORITHM
  ) {
    return { valid: false, reason: "unsupported keyAlgorithm" };
  }

  const { publicKey: _pk, signature: _sig, ...rest } = claim;
  void _pk;
  void _sig;
  const payload = canonicalize(rest);
  const ok = verifySignature(
    new TextEncoder().encode(payload),
    sigBytes,
    pubBytes,
  );

  return ok
    ? { valid: true, reason: "signature verified" }
    : { valid: false, reason: "signature does not match claim content" };
}
