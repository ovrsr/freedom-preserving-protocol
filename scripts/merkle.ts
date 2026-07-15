#!/usr/bin/env tsx
/**
 * merkle.ts — re-exports from skill-lib (protocol-compatible Merkle helpers).
 */
export {
  computeMerkleRoot,
  createMerkleProof,
  verifyMerkleProof,
  type MerkleProof,
  type MerkleProofStep,
} from "./skill-lib/index.ts";
