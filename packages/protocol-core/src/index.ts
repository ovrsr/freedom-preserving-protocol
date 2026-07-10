/**
 * @ovrsr/fpp-protocol-core — shared schemas and cryptographic contracts
 * for the Freedom Preserving Protocol.
 *
 * Package version and protocol schema version are independent:
 * this package release carries schema version 2.
 */

export const PACKAGE_NAME = "@ovrsr/fpp-protocol-core" as const;
export const PACKAGE_VERSION = "1.0.0" as const;
/** Protocol schema version carried by this package release. */
export const SCHEMA_VERSION = 2 as const;

export {
  canonicalize,
  canonicalizeV1,
  canonicalizeV2,
} from "./canonical-json.js";

export {
  DIGEST_DOMAINS,
  digest,
  hashEntryV1,
  type DigestDomain,
  type DigestInput,
} from "./digest.js";

export {
  computeMerkleRoot,
  computeMerkleRootV1,
  computeMerkleRootV2,
  createMerkleProof,
  createMerkleProofV1,
  createMerkleProofV2,
  hashPairV1,
  hashPairV2,
  verifyMerkleProof,
  verifyMerkleProofV1,
  verifyMerkleProofV2,
  type MerkleProof,
  type MerkleProofStep,
} from "./merkle.js";

export {
  KEY_ALGORITHM,
  deriveAgentIdV2,
  deriveLegacyAlias,
  fingerprintPublicKey,
  isLegacyAgentAlias,
  parseAgentId,
  publicKeyFromSeed,
  publicKeyMatchesAgentId,
  signMessage,
  verifySignature,
  type ParsedAgentId,
} from "./identity.js";

export {
  CLAIM_CLASSES,
  ConstitutionalClaimV2Schema,
  LegacyConstitutionalClaimV1Schema,
  parseClaim,
  type ClaimClass,
  type ClaimParseResult,
  type ConstitutionalClaimV2,
  type LegacyConstitutionalClaimV1,
} from "./claims.js";

export {
  FreshnessEnvelopeSchema,
  buildReplayKey,
  parseFreshnessEnvelope,
  validateFreshness,
  type FreshnessEnvelope,
  type FreshnessParseResult,
  type FreshnessPolicy,
  type FreshnessValidation,
} from "./freshness.js";

export {
  ConformanceReceiptV1Schema,
  parseConformanceReceipt,
  type ConformanceReceiptV1,
  type ReceiptParseResult,
} from "./receipts.js";

export {
  TrustStateCapsuleV2Schema,
  parseTrustStateCapsule,
  type CapsuleParseResult,
  type TrustStateCapsuleV2,
} from "./capsules.js";

export {
  ADOPTION_STATES,
  AdoptionStateRecordV1Schema,
  parseAdoptionStateRecord,
  type AdoptionParseResult,
  type AdoptionState,
  type AdoptionStateRecordV1,
} from "./adoption.js";

export {
  EvidenceEnvelopeV1Schema,
  parseEvidenceEnvelope,
  type EvidenceEnvelopeV1,
  type EvidenceParseResult,
} from "./evidence.js";
