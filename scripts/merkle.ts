#!/usr/bin/env tsx
/**
 * merkle.ts — compatibility re-exports from @ovrsr/fpp-protocol-core.
 *
 * Prefer importing from `@ovrsr/fpp-protocol-core` directly in new code.
 * These aliases preserve historical script import paths.
 */

export {
  computeMerkleRoot,
  createMerkleProof,
  verifyMerkleProof,
  type MerkleProof,
  type MerkleProofStep,
} from "@ovrsr/fpp-protocol-core";
