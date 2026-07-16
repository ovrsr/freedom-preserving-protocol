/**
 * @ovrsr/fpp-trust-core — harness-agnostic trust graph and handshake stack
 * for the Freedom Preserving Protocol.
 */

export const PACKAGE_NAME = "@ovrsr/fpp-trust-core" as const;
export const PACKAGE_VERSION = "1.0.1" as const;

export { resolveVerificationPolicy } from "./verification-policy.js";
export type {
  VerificationPolicy,
  ResolvedVerificationPolicy,
} from "./verification-policy.js";
export { VERIFICATION_POLICIES } from "./verification-policy.js";

export { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";
export type {
  TrustNode,
  TrustRelationship,
  TrustEvidence,
  TrustPropagation,
  TrustGraphStats,
  ReputationMetrics,
  PropagationPolicy,
  TrustUpdateEvent,
  LegacyObservationRef,
  KeyRotationProof,
} from "./trust-graph.js";

export { ConstitutionalHandshake, HandshakeState } from "./handshake.js";
export type {
  ConstitutionalClaim,
  HandshakeSession,
  HandshakeResult,
  HandshakeEvidence,
  HandshakeOptions,
} from "./handshake.js";

export { loadOrCreateIdentity, verifySignature } from "./identity.js";
export type { AgentIdentity } from "./identity.js";

export { signClaim, verifyClaim, canonicalize } from "./claims.js";
export type { SignedClaim, ClaimVerification } from "./claims.js";

export { ReplayCache } from "./replay-cache.js";
export type { ReplayCacheOptions } from "./replay-cache.js";

export {
  MerkleBridge,
  computeMerkleRoot,
  createMerkleProof,
  verifyMerkleProof,
} from "./merkle-bridge.js";
export type {
  MerkleProof,
  MerkleProofStep,
  AuditLogKind,
  TypedLogSource,
} from "./merkle-bridge.js";

export {
  StrictModeManager,
  CONSERVATIVE_STRICT_APPROVAL_ON,
  STRICT_MODE_SCHEMA_VERSION,
  VALID_STRICT_CLASSIFICATIONS,
} from "./strict-mode.js";
export type {
  StrictSessionEntry,
  StrictModeState,
  StrictModeDiagnostic,
  StrictModeDiagnosticCode,
  StrictClassificationId,
  StrictModeDiagnosticHandler,
} from "./strict-mode.js";

export { GroupContextManager } from "./group-context.js";
export type {
  ClusterMember,
  TrustCluster,
  ClusterTrustState,
  HandshakeRequiredCallback,
  SensitivityCheckResult,
} from "./group-context.js";

export {
  TrustEventLedger,
  appendTrustEvent,
  verifyTrustEvent,
  computeEventRoot,
  computeEventId,
  signTrustEventPayload,
  buildSnapshotFromEvents,
  signSnapshot,
  verifySnapshot,
  extractLegacy,
  legacyObservationsFromV1,
  LEGACY_CONFIDENCE_CEILING,
} from "./trust-events.js";
export type {
  TrustEventKind,
  SignedTrustEvent,
  TrustSnapshotV2,
  LegacyObservation,
  TrustEventPayload,
  EventVerification,
} from "./trust-events.js";

export {
  loadTrustGraph,
  saveTrustGraph,
  saveTrustGraphSync,
  migrateV1ToV2,
  eventsPathFor,
} from "./persistence.js";
export type {
  LoadTrustGraphOptions,
  SaveTrustGraphOptions,
} from "./persistence.js";

export {
  TrustViewStore,
  computeViewDivergence,
  PROPAGATED_WEIGHT_CEILING,
  SELF_WEIGHT_CEILING,
} from "./trust-views.js";
export type {
  EvidenceViewSummary,
  ViewDivergence,
  EvidenceChannel,
  ViewEvidenceRecord,
} from "./trust-views.js";

export {
  DisputeLedger,
  openChallenge,
  requestEvidence,
  submitCounterEvidence,
  fileAppeal,
  recordCorrection,
  recordRemediation,
  recordRehabilitation,
  resolveDispute,
  disputeStatusForPolicy,
} from "./disputes.js";
export type {
  DisputeVerb,
  DisputeStatus,
  DisputeRecord,
  DisputeCase,
} from "./disputes.js";

export {
  buildTrustStateCapsule,
  validateTrustStateCapsule,
  isLegacyClaimMasquerading,
} from "./capsule.js";
export type {
  CapsuleView,
  CapsuleCoverageMetrics,
  CapsuleViewSummaries,
  CapsuleBuildInput,
  BuiltCapsule,
  CapsuleValidation,
} from "./capsule.js";

export {
  KeyLifecycleLedger,
  isKeyValidAt,
  evidenceAffectedByCompromise,
  applyRotation,
  applyRevocation,
  applyRecovery,
} from "./key-lifecycle.js";
export type {
  KeyLifecycleKind,
  KeyLifecycleEvent,
  KeyValidityInterval,
} from "./key-lifecycle.js";

export {
  parseQuorumPolicyConfig,
  thresholdFor,
  evaluateThreshold,
  evaluateBallotEligibility,
  DEFAULT_QUORUM_POLICY,
} from "./quorum-policy.js";
export type {
  QuorumVoterRole,
  QuorumPolicyConfig,
  BallotEligibilityInput,
  BallotEligibilityResult,
  ThresholdCheckInput,
  ThresholdCheckResult,
} from "./quorum-policy.js";

export {
  QuorumSessionManager,
  computeIntendedMandateDigest,
  signQuorumProposal,
  signQuorumBallot,
  findForbiddenQuorumScopeTokens,
  QUORUM_FORBIDDEN_SCOPE_TOKENS,
} from "./quorum-session.js";
export type {
  IntendedMandateBody,
  QuorumSessionRecord,
  QuorumStateFile,
  MandateStoreFile,
  QuorumSessionManagerOptions,
  QuorumOpResult,
  FinalizeResult,
} from "./quorum-session.js";

export {
  verifyReceiptSignatureLocal,
  collectTypedReceiptLeaves,
  getReceiptRoot,
  createTypedReceiptProof,
  verifyReceiptEvidence,
  digestReceiptSelective,
  RECEIPT_LOG_KIND,
} from "./receipt-verifier.js";
export type {
  ReceiptEvidenceReport,
  SignedReceiptLike,
} from "./receipt-verifier.js";

export { evaluateTrustPolicy, TRUST_POLICY_VERSION } from "./trust-policy.js";
export type {
  PolicySeverity,
  PolicyPolarity,
  PolicyEvidenceEvent,
  PolicyInput,
  PolicyResult,
} from "./trust-policy.js";

export {
  ScopedTrustStore,
  scopesCompatible,
  isAssessmentValidAt,
  DEFAULT_SCOPE,
} from "./trust-scope.js";
export type {
  TrustScope,
  ScopedAssessment,
  EvaluateOptions,
} from "./trust-scope.js";

export {
  EVIDENCE_CLASSES,
  EVIDENCE_CLASS_CEILINGS,
  SELF_ASSERTED_CONFIGURATION_CEILING,
  trustLevelCeilingFromConfidence,
} from "./evidence-classes.js";
export type { EvidenceClass } from "./evidence-classes.js";

export {
  dedupeEvidence,
  assessEvidenceQuality,
} from "./evidence-quality.js";
export type {
  ObservationType,
  CoverageLabel,
  QualityEvidenceItem,
  EvidenceQualityResult,
} from "./evidence-quality.js";

export {
  createTrustStack,
  mergeTrustConfig,
  type TrustStack,
  type FppTrustConfig,
  type TrustConfigDiagnostic,
} from "./create-trust-stack.js";

export {
  createTempWorkspace,
  createFakeClock,
  createHookCapture,
  createFakeApprovalResolver,
  type TempWorkspace,
  type FakeClock,
  type CapturedHook,
  type HookCapture,
  type ApprovalDecision,
  type FakeApprovalResolver,
} from "./test-helpers.js";
