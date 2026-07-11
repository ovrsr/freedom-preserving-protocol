/**
 * Fresh signed TrustStateCapsuleV2 builder/validator.
 *
 * Capsules are challenge-bound, scoped, and versioned. They carry evidence
 * roots and coverage — not raw private logs. Legacy ConstitutionalClaim
 * payloads cannot masquerade as capsules (schemaVersion + required fields).
 */

import {
  KEY_ALGORITHM,
  canonicalizeV2,
  parseTrustStateCapsule,
  validateFreshness,
  buildReplayKey,
  type FreshnessEnvelope,
  type FreshnessPolicy,
  type TrustStateCapsuleV2,
} from "@ovrsr/fpp-protocol-core";
import type { AgentIdentity } from "./identity.js";
import { verifySignature } from "./identity.js";
import type {
  EvidenceViewSummary,
  ViewDivergence,
} from "./trust-views.js";

export type CapsuleView = "self" | "peer-summary";

export type CapsuleCoverageMetrics = {
  metricVersion: number;
  finalizedReceipts: number;
  completeness: "none" | "partial" | "full" | "unknown";
};

export type CapsuleViewSummaries = {
  self: EvidenceViewSummary;
  peer: EvidenceViewSummary;
  propagated: EvidenceViewSummary;
  divergence: ViewDivergence;
};

export type CapsuleBuildInput = {
  identity: AgentIdentity;
  runtimeId: string;
  implementationVersion: string;
  evidenceRoot: string;
  receiptRoot?: string | undefined;
  coverageMetrics: CapsuleCoverageMetrics;
  freshness: FreshnessEnvelope;
  view: CapsuleView;
  lineageRef?: string | undefined;
  selectiveProofRefs?: string[] | undefined;
  viewSummaries?: CapsuleViewSummaries | undefined;
};

export type BuiltCapsule = TrustStateCapsuleV2 & {
  view: CapsuleView;
  receiptRoot?: string | undefined;
  lineageRef?: string | undefined;
  selectiveProofRefs?: string[] | undefined;
  coverageMetricVersion: number;
  viewSummaries?: CapsuleViewSummaries | undefined;
};

function toCapsuleCoverage(metrics: CapsuleCoverageMetrics): {
  claims: number;
  receipts: number;
  completeness: "none" | "partial" | "full";
} {
  return {
    claims: 0,
    receipts: metrics.finalizedReceipts,
    completeness:
      metrics.completeness === "unknown" ? "partial" : metrics.completeness,
  };
}

function unsignedCapsuleFields(
  capsule: Record<string, unknown>,
): Record<string, unknown> {
  const { signature: _s, publicKey: _p, ...rest } = capsule;
  void _s;
  void _p;
  return rest;
}

export function buildTrustStateCapsule(input: CapsuleBuildInput): BuiltCapsule {
  const coverage = toCapsuleCoverage(input.coverageMetrics);
  const capsule: BuiltCapsule = {
    schemaVersion: 2,
    runtimeId: input.runtimeId,
    implementationVersion: input.implementationVersion,
    evidenceRoot: input.evidenceRoot,
    coverage,
    freshness: input.freshness,
    agentId: input.identity.agentId,
    publicKey: input.identity.publicKeyHex,
    signature: "",
    keyAlgorithm: KEY_ALGORITHM,
    view: input.view,
    coverageMetricVersion: input.coverageMetrics.metricVersion,
  };
  if (input.receiptRoot) capsule.receiptRoot = input.receiptRoot;
  if (input.lineageRef) capsule.lineageRef = input.lineageRef;
  if (input.selectiveProofRefs) {
    capsule.selectiveProofRefs = input.selectiveProofRefs;
  }
  if (input.viewSummaries) {
    capsule.viewSummaries = input.viewSummaries;
  }

  const payload = canonicalizeV2(unsignedCapsuleFields(capsule));
  const sig = input.identity.sign(new TextEncoder().encode(payload));
  capsule.signature = Buffer.from(sig).toString("hex");
  return capsule;
}

export type CapsuleValidation = {
  valid: boolean;
  reasons: string[];
  parseOk: boolean;
  freshnessOk: boolean;
  signatureOk: boolean;
  replayKey?: string | undefined;
  view?: CapsuleView | undefined;
};

export function validateTrustStateCapsule(
  input: unknown,
  policy: FreshnessPolicy,
): CapsuleValidation {
  const reasons: string[] = [];
  const parsed = parseTrustStateCapsule(input);
  if (!parsed.ok) {
    return {
      valid: false,
      reasons: [parsed.error],
      parseOk: false,
      freshnessOk: false,
      signatureOk: false,
    };
  }
  const capsule = parsed.capsule as BuiltCapsule;
  const fresh = validateFreshness(capsule.freshness, policy);
  if (!fresh.valid) reasons.push(fresh.reason);

  let signatureOk = false;
  try {
    const pub = Buffer.from(capsule.publicKey, "hex");
    const sig = Buffer.from(capsule.signature, "hex");
    const message = new TextEncoder().encode(
      canonicalizeV2(unsignedCapsuleFields(capsule as unknown as Record<string, unknown>)),
    );
    signatureOk = verifySignature(message, sig, pub);
    if (!signatureOk) reasons.push("capsule signature invalid");
  } catch {
    reasons.push("capsule signature encoding invalid");
  }

  if (capsule.agentId && capsule.publicKey) {
    // agentId binding checked via signature payload inclusion
  }

  const view = (capsule as BuiltCapsule).view;
  return {
    valid: reasons.length === 0 && signatureOk && fresh.valid,
    reasons,
    parseOk: true,
    freshnessOk: fresh.valid,
    signatureOk,
    replayKey: buildReplayKey(capsule.freshness),
    view,
  };
}

/** Reject legacy claim shapes that try to pass as capsules. */
export function isLegacyClaimMasquerading(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const obj = input as Record<string, unknown>;
  if (obj.schemaVersion === 2 && obj.evidenceRoot && obj.freshness) return false;
  return (
    typeof obj.constitutionHash === "string" &&
    typeof obj.agentId === "string" &&
    obj.schemaVersion !== 2
  );
}
