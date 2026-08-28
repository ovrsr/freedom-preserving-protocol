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
  parseReceiptInclusionEvidence,
  publicKeyMatchesAgentId,
  verifyMerkleProofV2,
  verifySignature,
  type GovernanceMode,
  type MerkleProof,
  type ReceiptInclusionEvidenceV1,
} from "@ovrsr/fpp-protocol-core";
import {
  EVIDENCE_CLASS_CEILINGS,
  type EvidenceClass,
} from "./evidence-classes.js";

export const RECEIPT_LOG_KIND = "conformance-receipt" as const;

export const INSTRUMENTED_BOUNDARY_DISPOSITION =
  "instrumented-boundary-disposition" as const;

const ZERO_HASH = "0".repeat(64);
const DIGEST_HEX = /^[0-9a-f]{64}$/;

export class ReceiptLogValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptLogValidationError";
  }
}

export type InstrumentedBoundaryDispositionAttestation = {
  kind: typeof INSTRUMENTED_BOUNDARY_DISPOSITION;
  claimClass: "event";
  /** Cryptographic validity under stated assumptions. Reserved: boundary_attested. */
  uncertaintyLabel: "proven_under_assumptions" | "boundary_attested";
  actionDigest: string;
  disposition: string;
  authorization: string;
  policyId: string;
  policyVersion: string;
  implementationVersion: string;
  constitutionHash?: string | undefined;
  classifierRulesetHash?: string | undefined;
  effectiveConfigHash?: string | undefined;
  governanceEpoch?: number | undefined;
  governanceMode?: GovernanceMode | undefined;
  agentId?: string | undefined;
  signatureValid: boolean;
  policyHashMatched?: boolean | undefined;
  inclusionVerified: boolean;
  maximumConclusion: string;
  assumptions: string[];
  limitations: string[];
};

export type ReceiptExpectedField =
  | "actionDigest"
  | "agentId"
  | "policyId"
  | "policyVersion"
  | "implementationVersion"
  | "constitutionHash"
  | "classifierRulesetHash"
  | "effectiveConfigHash";

export type ReceiptFieldComparison = {
  expected?: string | undefined;
  actual?: string | undefined;
  matched: boolean;
  status: ReceiptComparisonStatus;
};

export type ReceiptExpectedComparisons = Partial<
  Record<ReceiptExpectedField, ReceiptFieldComparison>
>;

export type ReceiptComparisonStatus =
  | "unrequested"
  | "missing"
  | "matched"
  | "mismatched";

export type TrustedContextComparison = {
  status: ReceiptComparisonStatus;
  expected?: string | undefined;
  actual?: string | undefined;
};

export type TrustedReceiptVerificationContext = {
  constitutionHash: TrustedContextComparison;
  policyId: TrustedContextComparison;
  policyVersion: TrustedContextComparison;
  anchored: boolean;
};

export type ReceiptAttestationEligibility = {
  eligible: boolean;
  requiredTrustedContext: readonly [
    "constitutionHash",
    "policyId",
    "policyVersion",
  ];
  reasons: string[];
};

export type ReceiptSignerVerification = {
  signatureValid: boolean;
  selfCertifiedKeyIdentifier: boolean;
  expectedIdentifier: TrustedContextComparison;
  trustedKeyProvenance: false;
  legalIdentityEstablished: false;
};

export type ReceiptInclusionVerification = {
  requested: boolean;
  exactEntryBound: boolean;
  proofValidUnderClaimedRoot: boolean;
  expectedRootStatus: ReceiptComparisonStatus;
  rootAnchored: boolean;
  inclusionVerified: boolean;
  claimedRoot?: string | undefined;
  expectedRoot?: string | undefined;
};

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
  expectedComparisons: ReceiptExpectedComparisons;
  trustedVerificationContext: TrustedReceiptVerificationContext;
  attestationEligibility: ReceiptAttestationEligibility;
  signerVerification: ReceiptSignerVerification;
  inclusionVerification: ReceiptInclusionVerification;
  reasons: string[];
  whatWasVerified: string[];
  whatWasNotProven: string[];
  /** Present only when receipt evidence is valid and trusted context is anchored. */
  attestation?: InstrumentedBoundaryDispositionAttestation | undefined;
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
  constitutionHash?: string;
  classifierRulesetHash?: string;
  effectiveConfigHash?: string;
  governanceEpoch?: number;
  governanceMode?: GovernanceMode;
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

function parseStrictTypedReceiptLog(logPath: string): {
  entries: Array<Record<string, unknown>>;
  leaves: string[];
} {
  if (!existsSync(logPath)) {
    throw new ReceiptLogValidationError(`receipt log not found: ${logPath}`);
  }
  const content = readFileSync(logPath, "utf-8").trim();
  if (!content) return { entries: [], leaves: [] };

  const entries: Array<Record<string, unknown>> = [];
  const leaves: string[] = [];
  const seenHashes = new Set<string>();
  let previousHash = ZERO_HASH;
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    const lineNumber = index + 1;
    let entry: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error("entry must be a JSON object");
      }
      entry = parsed as Record<string, unknown>;
    } catch (error) {
      throw new ReceiptLogValidationError(
        `line ${lineNumber}: invalid JSON: ${(error as Error).message}`,
      );
    }

    if (entry.kind !== RECEIPT_LOG_KIND) {
      throw new ReceiptLogValidationError(
        `line ${lineNumber}: unexpected log kind ${String(entry.kind)} (expected ${RECEIPT_LOG_KIND})`,
      );
    }
    if (
      typeof entry.previousHash !== "string" ||
      !DIGEST_HEX.test(entry.previousHash) ||
      entry.previousHash !== previousHash
    ) {
      throw new ReceiptLogValidationError(
        `line ${lineNumber}: previousHash mismatch (expected ${previousHash}, got ${String(entry.previousHash)})`,
      );
    }
    if (
      typeof entry.timestamp !== "string" ||
      !Number.isFinite(Date.parse(entry.timestamp)) ||
      new Date(Date.parse(entry.timestamp)).toISOString() !== entry.timestamp
    ) {
      throw new ReceiptLogValidationError(
        `line ${lineNumber}: timestamp must be canonical ISO-8601`,
      );
    }
    const parsedReceipt = parseConformanceReceipt(entry.receipt);
    if (!parsedReceipt.ok) {
      throw new ReceiptLogValidationError(
        `line ${lineNumber}: invalid receipt: ${parsedReceipt.error}`,
      );
    }
    const signature = verifyReceiptSignatureLocal(
      entry.receipt as SignedReceiptLike,
    );
    const receipt = parsedReceipt.receipt as SignedReceiptLike;
    const allowedUnsignedDegraded =
      receipt.signingStatus === "unsigned-degraded" &&
      receipt.trustElevating === false &&
      receipt.signature === undefined &&
      receipt.publicKey === undefined;
    if (!signature.valid && !allowedUnsignedDegraded) {
      throw new ReceiptLogValidationError(
        `line ${lineNumber}: signature failure: ${signature.reason}`,
      );
    }
    if (typeof entry.hash !== "string" || !DIGEST_HEX.test(entry.hash)) {
      throw new ReceiptLogValidationError(
        `line ${lineNumber}: hash must be 64 lowercase hex characters`,
      );
    }
    if (seenHashes.has(entry.hash)) {
      throw new ReceiptLogValidationError(
        `line ${lineNumber}: duplicate entry hash ${entry.hash}`,
      );
    }
    const { hash: claimedHash, ...preimage } = entry;
    const recomputedHash = digest({
      version: 2,
      domain: DIGEST_DOMAINS.entry,
      value: preimage,
    });
    if (claimedHash !== recomputedHash) {
      throw new ReceiptLogValidationError(
        `line ${lineNumber}: hash mismatch (claimed ${String(claimedHash)}, recomputed ${recomputedHash})`,
      );
    }

    seenHashes.add(entry.hash);
    entries.push(entry);
    leaves.push(entry.hash);
    previousHash = entry.hash;
  }

  return { entries, leaves };
}

export function collectTypedReceiptLeaves(logPath: string): string[] {
  return parseStrictTypedReceiptLog(logPath).leaves;
}

export function getReceiptRoot(logPath: string): {
  root: string;
  entryCount: number;
  logKind: typeof RECEIPT_LOG_KIND;
  rootAuthority: "locally-calculated";
  trustedCheckpoint: false;
} {
  const leaves = collectTypedReceiptLeaves(logPath);
  return {
    root: computeMerkleRootV2(leaves),
    entryCount: leaves.length,
    logKind: RECEIPT_LOG_KIND,
    rootAuthority: "locally-calculated",
    trustedCheckpoint: false,
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

export function createTypedReceiptInclusionEvidence(
  logPath: string,
  index: number,
): ReceiptInclusionEvidenceV1 | null {
  const parsedLog = parseStrictTypedReceiptLog(logPath);
  const proof = createMerkleProofV2(parsedLog.leaves, index);
  if (!proof) return null;
  const entry = parsedLog.entries[index];
  if (!entry) return null;
  const parsed = parseReceiptInclusionEvidence({
    evidenceVersion: 1,
    logKind: RECEIPT_LOG_KIND,
    entry,
    proof: {
      leaf: proof.leaf,
      index: proof.index,
      path: proof.path,
      root: proof.root,
    },
  });
  return parsed.ok ? parsed.evidence : null;
}

function buildMaximumConclusion(fields: {
  agentId?: string | undefined;
  expectedAgentIdMatched: boolean;
  disposition: string;
  authorization: string;
  actionDigest: string;
  policyId: string;
  policyVersion: string;
  implementationVersion: string;
  constitutionHash?: string | undefined;
  classifierRulesetHash?: string | undefined;
  effectiveConfigHash?: string | undefined;
  governanceEpoch?: number | undefined;
  governanceMode?: GovernanceMode | undefined;
}): string {
  const signer = fields.agentId
    ? fields.expectedAgentIdMatched
      ? `signer identifier ${fields.agentId} (matched the verifier-supplied identifier)`
      : `self-certified signer key/identifier ${fields.agentId}`
    : "the receipt signer";
  const context = [
    `policy ${fields.policyId}@${fields.policyVersion}`,
    `implementation ${fields.implementationVersion}`,
  ];
  if (fields.constitutionHash) {
    context.push(`constitution hash ${fields.constitutionHash}`);
  }
  if (fields.classifierRulesetHash) {
    context.push(`classifier ruleset hash ${fields.classifierRulesetHash}`);
  }
  if (fields.effectiveConfigHash) {
    context.push(`effective configuration hash ${fields.effectiveConfigHash}`);
  }
  if (
    fields.governanceEpoch !== undefined &&
    fields.governanceMode !== undefined
  ) {
    context.push(
      `governance mode ${fields.governanceMode} at epoch ${fields.governanceEpoch}`,
    );
  }
  return (
    `For this receipt, ${signer} recorded disposition ${fields.disposition} ` +
    `and authorization ${fields.authorization} against action digest ${fields.actionDigest} ` +
    `under ${context.join(", ")}; the signed receipt identifies this as an FPP ` +
    `instrumented-boundary record.`
  );
}

const RECEIPT_ASSUMPTIONS = [
  "The verifier trusts the Ed25519 signature verification result and self-certified key-to-identifier binding",
  "A matched supplied signer identifier does not establish trusted key provenance or legal/person identity",
  "The self-presented receipt truthfully identifies the signer's instrumented-boundary recording context",
  "The action digest represents parameters observed by that recording context",
  "The independently supplied constitution hash, policy ID, and policy version identify the intended evaluation context",
  "Other signed classifier and configuration identifiers accurately name the evaluation context",
];

const RECEIPT_LIMITATIONS = [
  "Does not prove exact downstream parameter equality after the instrumented boundary",
  "Does not prove the action was the only route to the side effect (uninstrumented or bypass paths)",
  "Does not prove completeness of all actions in the interval",
  "Does not prove the runtime was uncompromised",
  "Does not prove behavioral compliance with Laws 1–5",
];

export function verifyReceiptEvidence(input: {
  receipt: unknown;
  expectedActionDigest?: string | undefined;
  expectedAgentId?: string | undefined;
  expectedPolicyId?: string | undefined;
  expectedPolicyVersion?: string | undefined;
  expectedImplementationVersion?: string | undefined;
  expectedConstitutionHash?: string | undefined;
  expectedClassifierRulesetHash?: string | undefined;
  expectedEffectiveConfigHash?: string | undefined;
  inclusionEvidence?: unknown;
  /** @deprecated Standalone proofs cannot establish receipt-bound inclusion. */
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
    "exact downstream parameter equality after the instrumented boundary",
    "absence of uninstrumented or bypass paths to the same side effect",
  ];

  const parsed = parseConformanceReceipt(input.receipt);
  const schemaOk = parsed.ok;
  if (!schemaOk) reasons.push(parsed.error);
  else whatWasVerified.push("ConformanceReceiptV1 schema");

  const receipt = (input.receipt ?? {}) as SignedReceiptLike;
  const sig = verifyReceiptSignatureLocal(receipt);
  if (sig.valid) {
    whatWasVerified.push(
      "Ed25519 receipt signature and self-certified signer key/identifier binding",
    );
  }
  else reasons.push(sig.reason);

  const expectedComparisons: ReceiptExpectedComparisons = {};
  const comparisonFor = (
    expected: string | undefined,
    actual: unknown,
  ): TrustedContextComparison => {
    const actualString = typeof actual === "string" ? actual : undefined;
    if (expected === undefined) {
      return { status: "unrequested", actual: actualString };
    }
    if (actualString === undefined) {
      return { status: "missing", expected };
    }
    if (actualString === expected) {
      return { status: "matched", expected, actual: actualString };
    }
    return {
      status: "mismatched",
      expected,
      actual: actualString,
    };
  };
  const compareExpected = (
    field: ReceiptExpectedField,
    expected: string | undefined,
    actual: unknown,
  ): void => {
    if (expected === undefined) return;
    const actualString = typeof actual === "string" ? actual : undefined;
    const matched = actualString === expected;
    const status: ReceiptComparisonStatus =
      actualString === undefined ? "missing" : matched ? "matched" : "mismatched";
    expectedComparisons[field] = {
      expected,
      actual: actualString,
      matched,
      status,
    };
    if (matched) {
      whatWasVerified.push(
        field === "agentId" ? "supplied signer identifier matched" : `${field} match`,
      );
    }
    else reasons.push(`${field} mismatch`);
  };
  compareExpected("actionDigest", input.expectedActionDigest, receipt.actionDigest);
  compareExpected("agentId", input.expectedAgentId, receipt.agentId);
  compareExpected("policyId", input.expectedPolicyId, receipt.policyId);
  compareExpected(
    "policyVersion",
    input.expectedPolicyVersion,
    receipt.policyVersion,
  );
  compareExpected(
    "implementationVersion",
    input.expectedImplementationVersion,
    receipt.implementationVersion,
  );
  compareExpected(
    "constitutionHash",
    input.expectedConstitutionHash,
    receipt.constitutionHash,
  );
  compareExpected(
    "classifierRulesetHash",
    input.expectedClassifierRulesetHash,
    receipt.classifierRulesetHash,
  );
  compareExpected(
    "effectiveConfigHash",
    input.expectedEffectiveConfigHash,
    receipt.effectiveConfigHash,
  );
  const expectedValuesOk = Object.values(expectedComparisons).every(
    (comparison) => comparison.matched,
  );
  const trustedVerificationContext: TrustedReceiptVerificationContext = {
    constitutionHash: comparisonFor(
      input.expectedConstitutionHash,
      receipt.constitutionHash,
    ),
    policyId: comparisonFor(input.expectedPolicyId, receipt.policyId),
    policyVersion: comparisonFor(
      input.expectedPolicyVersion,
      receipt.policyVersion,
    ),
    anchored: false,
  };
  trustedVerificationContext.anchored = [
    trustedVerificationContext.constitutionHash,
    trustedVerificationContext.policyId,
    trustedVerificationContext.policyVersion,
  ].every((comparison) => comparison.status === "matched");
  const signerVerification: ReceiptSignerVerification = {
    signatureValid: sig.valid,
    selfCertifiedKeyIdentifier:
      sig.valid &&
      typeof receipt.agentId === "string" &&
      typeof receipt.publicKey === "string" &&
      publicKeyMatchesAgentId(receipt.agentId, receipt.publicKey),
    expectedIdentifier: comparisonFor(
      input.expectedAgentId,
      receipt.agentId,
    ),
    trustedKeyProvenance: false,
    legalIdentityEstablished: false,
  };
  const policyOk =
    input.expectedPolicyVersion === undefined &&
    input.expectedClassifierRulesetHash === undefined
      ? undefined
      : [
          expectedComparisons.policyVersion,
          expectedComparisons.classifierRulesetHash,
        ]
          .filter(
            (comparison): comparison is ReceiptFieldComparison =>
              comparison !== undefined,
          )
          .every((comparison) => comparison.matched);

  const inclusionRequested =
    input.inclusionProof !== undefined || input.inclusionEvidence !== undefined;
  let inclusionOk = false;
  const inclusionVerification: ReceiptInclusionVerification = {
    requested: inclusionRequested,
    exactEntryBound: false,
    proofValidUnderClaimedRoot: false,
    expectedRootStatus:
      input.expectedRoot === undefined ? "unrequested" : "missing",
    rootAnchored: false,
    inclusionVerified: false,
    expectedRoot: input.expectedRoot,
  };
  if (input.inclusionProof) {
    const kindNote =
      input.inclusionProof.logKind !== undefined &&
      input.inclusionProof.logKind !== RECEIPT_LOG_KIND
        ? `; logKind confusion: ${input.inclusionProof.logKind} (expected ${RECEIPT_LOG_KIND})`
        : "";
    reasons.push(
      `standalone inclusion proof is insufficient legacy evidence${kindNote}`,
    );
  } else if (input.inclusionEvidence !== undefined) {
    const parsedEvidence = parseReceiptInclusionEvidence(
      input.inclusionEvidence,
    );
    if (!parsedEvidence.ok) {
      reasons.push(parsedEvidence.error);
    } else {
      const evidence = parsedEvidence.evidence;
      const entryPreimage = {
        previousHash: evidence.entry.previousHash,
        timestamp: evidence.entry.timestamp,
        kind: evidence.entry.kind,
        receipt: evidence.entry.receipt,
      };
      const recomputedHash = digest({
        version: 2,
        domain: DIGEST_DOMAINS.entry,
        value: entryPreimage,
      });
      let receiptMatches = false;
      try {
        receiptMatches =
          canonicalizeV2(evidence.entry.receipt) ===
          canonicalizeV2(input.receipt);
      } catch {
        receiptMatches = false;
      }
      const entryHashMatches = evidence.entry.hash === recomputedHash;
      const proofLeafMatches = evidence.proof.leaf === recomputedHash;
      const proofValid = verifyMerkleProofV2(evidence.proof);
      const exactEntryBound =
        receiptMatches && entryHashMatches && proofLeafMatches;
      const expectedRootMatches =
        input.expectedRoot !== undefined &&
        evidence.proof.root === input.expectedRoot;
      inclusionVerification.exactEntryBound = exactEntryBound;
      inclusionVerification.proofValidUnderClaimedRoot = proofValid;
      inclusionVerification.claimedRoot = evidence.proof.root;
      inclusionVerification.expectedRootStatus =
        input.expectedRoot === undefined
          ? "unrequested"
          : expectedRootMatches
            ? "matched"
            : "mismatched";
      inclusionVerification.rootAnchored = expectedRootMatches;
      inclusionOk =
        exactEntryBound &&
        proofValid &&
        expectedRootMatches;
      inclusionVerification.inclusionVerified = inclusionOk;
      if (!receiptMatches) reasons.push("inclusion entry receipt mismatch");
      if (!entryHashMatches) reasons.push("inclusion entry hash mismatch");
      if (!proofLeafMatches) {
        reasons.push("inclusion proof leaf does not match recomputed entry hash");
      }
      if (!proofValid) reasons.push("inclusion proof path invalid");
      else {
        whatWasVerified.push(
          "exact-entry proof valid under the claimed root (root trust evaluated separately)",
        );
      }
      if (!expectedRootMatches) {
        reasons.push(
          input.expectedRoot === undefined
            ? "independent expected receipt root is required for anchored inclusion"
            : "inclusion proof root does not match the independent expected root",
        );
      }
      if (inclusionOk) {
        whatWasVerified.push(
          "independently anchored inclusion of the exact receipt-log entry (not completeness)",
        );
      }
    }
  }

  const evidenceClass: EvidenceClass = sig.valid ? "event" : "configuration";
  const valid =
    schemaOk &&
    sig.valid &&
    expectedValuesOk &&
    (inclusionRequested ? inclusionOk : true);
  const eligibilityReasons: string[] = [];
  if (!valid) {
    eligibilityReasons.push("receipt evidence is invalid");
  }
  if (!trustedVerificationContext.anchored) {
    eligibilityReasons.push(
      "independent constitution hash, policy ID, and policy version must all be supplied and matched",
    );
  }
  const attestationEligibility: ReceiptAttestationEligibility = {
    eligible: valid && trustedVerificationContext.anchored,
    requiredTrustedContext: [
      "constitutionHash",
      "policyId",
      "policyVersion",
    ],
    reasons: eligibilityReasons,
  };
  if (valid && !attestationEligibility.eligible) {
    reasons.push(...eligibilityReasons);
  }

  let attestation: InstrumentedBoundaryDispositionAttestation | undefined;
  if (attestationEligibility.eligible && parsed.ok) {
    const r = parsed.receipt;
    const actionDigest = r.actionDigest;
    const disposition = r.disposition;
    const authorization = r.authorization;
    attestation = {
      kind: INSTRUMENTED_BOUNDARY_DISPOSITION,
      claimClass: "event",
      uncertaintyLabel: "proven_under_assumptions",
      actionDigest,
      disposition,
      authorization,
      policyId: r.policyId,
      policyVersion: r.policyVersion,
      implementationVersion: r.implementationVersion,
      constitutionHash: r.constitutionHash,
      classifierRulesetHash: r.classifierRulesetHash,
      effectiveConfigHash: r.effectiveConfigHash,
      governanceEpoch: r.governanceEpoch,
      governanceMode: r.governanceMode,
      agentId: typeof receipt.agentId === "string" ? receipt.agentId : undefined,
      signatureValid: sig.valid,
      policyHashMatched: policyOk,
      inclusionVerified: inclusionOk,
      maximumConclusion: buildMaximumConclusion({
        expectedAgentIdMatched:
          signerVerification.expectedIdentifier.status === "matched",
        disposition,
        authorization,
        actionDigest,
        policyId: r.policyId,
        policyVersion: r.policyVersion,
        implementationVersion: r.implementationVersion,
        constitutionHash: r.constitutionHash,
        classifierRulesetHash: r.classifierRulesetHash,
        effectiveConfigHash: r.effectiveConfigHash,
        governanceEpoch: r.governanceEpoch,
        governanceMode: r.governanceMode,
        agentId:
          typeof receipt.agentId === "string" ? receipt.agentId : undefined,
      }),
      assumptions: [...RECEIPT_ASSUMPTIONS],
      limitations: [...RECEIPT_LIMITATIONS],
    };
  }

  return {
    valid,
    claimClass: "event",
    evidenceClass: attestationEligibility.eligible
      ? "event"
      : sig.valid
        ? "identity"
        : evidenceClass,
    confidenceCeiling: valid
      ? EVIDENCE_CLASS_CEILINGS[
          attestationEligibility.eligible ? "event" : sig.valid ? "identity" : evidenceClass
        ]
      : 0,
    verified: {
      schema: schemaOk,
      signature: sig.valid,
      chain: false,
      inclusion: inclusionOk,
      policyHash: policyOk,
    },
    expectedComparisons,
    trustedVerificationContext,
    attestationEligibility,
    signerVerification,
    inclusionVerification,
    reasons,
    whatWasVerified,
    whatWasNotProven,
    attestation,
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
