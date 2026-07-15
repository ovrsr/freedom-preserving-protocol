/**
 * Skill-portable protocol helpers used by adopt / revoke / audit scripts.
 * Keep hashEntryV1 and merkle pairing bit-compatible with @ovrsr/fpp-protocol-core.
 */
export {
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
  createMerkleProof,
  verifyMerkleProof,
  type MerkleProof,
  type MerkleProofStep,
} from "./merkle.js";
export {
  workspaceFile,
  resolveWorkspaceRoot,
  absolutizeWorkspacePath,
  DEFAULT_WORKSPACE_PROFILE,
  type WorkspaceProfileId,
  type ResolveWorkspaceOptions,
  type AbsolutizeWorkspaceOptions,
} from "./workspace.js";
export {
  ADOPTION_STATES,
  ADOPTION_OVERLAY_FLAGS,
  ENFORCEMENT_GRADES,
  parseAdoptionStateRecord,
  type AdoptionState,
  type AdoptionOverlayFlag,
  type EnforcementGrade,
  type AdoptionStateRecord,
  type AdoptionStateRecordV1,
  type AdoptionStateRecordV2,
  type AdoptionParseResult,
} from "./adoption.js";
