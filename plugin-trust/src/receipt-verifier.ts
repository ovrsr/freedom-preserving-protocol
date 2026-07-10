/**
 * Independent conformance-receipt verification for the trust plugin.
 *
 * Does not import the enforcement plugin. Uses protocol-core schemas and
 * crypto primitives only. Claim/evidence classes and confidence ceilings
 * are explicit — signatures prove attribution, not behavioral compliance.
 */

import { existsSync, readFileSync } from "node:fs";
import {
  DIGEST_DOMAINS,
  KEY_ALGORITHM,
  canonicalizeV2,
  computeMerkleRootV2,
  createMerkleProofV2,
  digest,
  parseConformanceReceipt,
  publicKeyMatchesAgentId,
  verifyMerkleProofV2,
  verifySignature,
  type MerkleProof,
} from "@ovrsr/fpp-protocol-core";
import {
  EVIDENCE_CLASS_CEILINGS,
  type EvidenceClass,
} from "./evidence-classes.js";

export const RECEIPT_LOG_KIND = "conformance-receipt" as const;

export type ReceiptEvidenceReport = {
  valid: boolean;
  claimClass: "event";
  evidenceClass: EvidenceClass;
  confidenceCeiling: number;
  verified: {
    schema: boolean;
    signature: boolean;
    chain: boolean;
    inclusion: boolean;
    policyHash?: boolean | undefined;
  };
  reasons: string[];
  whatWasVerified: string[];
  whatWasNotProven: string[];
};

export type SignedReceiptLike = {
  schemaVersion?: number;
  receiptClass?: string;
  actionDigest?: string;
  policyId?: string;
  policyVersion?: string;
  implementationVersion?: string;
  disposition?: string;
  authorization?: string;
  outcome?: string;
  issuedAt?: string;
  signingStatus?: string;
  trustElevating?: boolean;
  publicKey?: string;
  signature?: string;
  agentId?: string;
  keyAlgorithm?: string;
  classifierRulesetHash?: string;
  effectiveConfigHash?: string;
  [key: string]: unknown;
};

function unsignedFields(payload: Record<string, unknown>): Record<string, unknown> {
  const { signature: _s, publicKey: _p, payloadDigest: _d, ...rest } = payload;
  void _s;
  void _p;
  void _d;
  return rest;
}

export function verifyReceiptSignatureLocal(
  receipt: SignedReceiptLike,
): { valid: boolean; reason: string } {
  if (
    receipt.signingStatus === "unsigned-degraded" ||
    !receipt.signature ||
    receipt.trustElevating === false
  ) {
    return {
      valid: false,
      reason: "unsigned-degraded receipt is not trust-elevating",
    };
  }
  if (!receipt.publicKey || !receipt.agentId) {
    return { valid: false, reason: "missing publicKey or agentId" };
  }
  if (!publicKeyMatchesAgentId(receipt.agentId, receipt.publicKey)) {
    return { valid: false, reason: "agentId does not match publicKey" };
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
    return { valid: false, reason: "invalid hex" };
  }
  if (pubBytes.length !== 32 || sigBytes.length !== 64) {
    return { valid: false, reason: "invalid key/signature length" };
  }
  const message = new TextEncoder().encode(
    canonicalizeV2(unsignedFields(receipt as Record<string, unknown>)),
  );
  const ok = verifySignature(message, sigBytes, pubBytes);
  return ok
    ? { valid: true, reason: "signature verified" }
    : { valid: false, reason: "signature mismatch" };
}

export function collectTypedReceiptLeaves(logPath: string): string[] {
  if (!existsSync(logPath)) return [];
  const content = readFileSync(logPath, "utf-8").trim();
  if (!content) return [];
  const leaves: string[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry.kind !== RECEIPT_LOG_KIND) continue;
      if (typeof entry.hash === "string") leaves.push(entry.hash);
    } catch {
      /* skip */
    }
  }
  return leaves;
}

export function getReceiptRoot(logPath: string): {
  root: string;
  entryCount: number;
  logKind: typeof RECEIPT_LOG_KIND;
} {
  const leaves = collectTypedReceiptLeaves(logPath);
  return {
    root: computeMerkleRootV2(leaves),
    entryCount: leaves.length,
    logKind: RECEIPT_LOG_KIND,
  };
}

export function createTypedReceiptProof(
  logPath: string,
  index: number,
): (MerkleProof & { logKind: typeof RECEIPT_LOG_KIND }) | null {
  const leaves = collectTypedReceiptLeaves(logPath);
  const proof = createMerkleProofV2(leaves, index);
  if (!proof) return null;
  return { ...proof, logKind: RECEIPT_LOG_KIND };
}

export function verifyReceiptEvidence(input: {
  receipt: unknown;
  expectedPolicyVersion?: string | undefined;
  expectedClassifierRulesetHash?: string | undefined;
  inclusionProof?: (MerkleProof & { logKind?: string }) | undefined;
  expectedRoot?: string | undefined;
}): ReceiptEvidenceReport {
  const reasons: string[] = [];
  const whatWasVerified: string[] = [];
  const whatWasNotProven = [
    "behavioral compliance with Laws 1–5",
    "completeness of all actions in the interval",
    "that the runtime was uncompromised",
    "that classification was morally correct",
  ];

  const parsed = parseConformanceReceipt(input.receipt);
  const schemaOk = parsed.ok;
  if (!schemaOk) reasons.push(parsed.error);
  else whatWasVerified.push("ConformanceReceiptV1 schema");

  const receipt = (input.receipt ?? {}) as SignedReceiptLike;
  const sig = verifyReceiptSignatureLocal(receipt);
  if (sig.valid) whatWasVerified.push("Ed25519 receipt signature / agent identity");
  else reasons.push(sig.reason);

  let policyOk: boolean | undefined;
  if (input.expectedPolicyVersion !== undefined) {
    policyOk = receipt.policyVersion === input.expectedPolicyVersion;
    if (policyOk) whatWasVerified.push("policyVersion match");
    else reasons.push("policyVersion mismatch");
  }
  if (input.expectedClassifierRulesetHash !== undefined) {
    const hashOk =
      receipt.classifierRulesetHash === input.expectedClassifierRulesetHash;
    policyOk = (policyOk ?? true) && hashOk;
    if (hashOk) whatWasVerified.push("classifierRulesetHash match");
    else reasons.push("classifierRulesetHash mismatch");
  }

  let inclusionOk = false;
  if (input.inclusionProof) {
    if (input.inclusionProof.logKind && input.inclusionProof.logKind !== RECEIPT_LOG_KIND) {
      reasons.push(
        `inclusion proof logKind confusion: ${input.inclusionProof.logKind} (expected ${RECEIPT_LOG_KIND})`,
      );
    } else {
      const proofValid = verifyMerkleProofV2(input.inclusionProof);
      const rootMatch =
        input.expectedRoot === undefined ||
        input.inclusionProof.root === input.expectedRoot;
      inclusionOk = proofValid && rootMatch;
      if (inclusionOk) {
        whatWasVerified.push(
          "Merkle inclusion under claimed receipt root (not completeness)",
        );
      } else {
        reasons.push("inclusion proof invalid or root mismatch");
      }
    }
  }

  const evidenceClass: EvidenceClass = sig.valid ? "event" : "configuration";
  const valid =
    schemaOk &&
    sig.valid &&
    (policyOk ?? true) &&
    (input.inclusionProof ? inclusionOk : true);

  return {
    valid,
    claimClass: "event",
    evidenceClass,
    confidenceCeiling: EVIDENCE_CLASS_CEILINGS[evidenceClass],
    verified: {
      schema: schemaOk,
      signature: sig.valid,
      chain: false,
      inclusion: inclusionOk,
      policyHash: policyOk,
    },
    reasons,
    whatWasVerified,
    whatWasNotProven,
  };
}

/** Domain-separated digest helper for selective disclosure payloads. */
export function digestReceiptSelective(value: unknown): string {
  return digest({
    version: 2,
    domain: DIGEST_DOMAINS.receipt,
    value,
  });
}
