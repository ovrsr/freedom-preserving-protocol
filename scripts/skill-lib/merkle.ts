/**
 * Merkle v1 helpers used by skill audit scripts (skill-portable).
 */
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { DIGEST_DOMAINS } from "./digest.js";

export type MerkleProofStep = {
  hash: string;
  position: "left" | "right";
};

export type MerkleProof = {
  leaf: string;
  index: number;
  path: MerkleProofStep[];
  root: string;
};

function sha256Hex(data: string): string {
  return bytesToHex(sha256(utf8ToBytes(data)));
}

export function hashPairV1(a: string, b: string): string {
  return sha256Hex(a + b);
}

export function hashPairV2(a: string, b: string): string {
  return sha256Hex(DIGEST_DOMAINS.node + "\0" + a + "\0" + b);
}

function computeRoot(
  leaves: string[],
  hashPair: (a: string, b: string) => string,
): string {
  if (leaves.length === 0) return "0".repeat(64);
  if (leaves.length === 1) return leaves[0]!;

  const level: string[] = [];
  for (let i = 0; i < leaves.length; i += 2) {
    const left = leaves[i]!;
    const right = leaves[i + 1] ?? left;
    level.push(hashPair(left, right));
  }
  return computeRoot(level, hashPair);
}

function createProof(
  leaves: string[],
  index: number,
  hashPair: (a: string, b: string) => string,
): MerkleProof | null {
  if (index < 0 || index >= leaves.length || leaves.length === 0) return null;

  const path: MerkleProofStep[] = [];
  let currentLevel = [...leaves];
  let idx = index;

  while (currentLevel.length > 1) {
    if (currentLevel.length % 2 === 1) {
      currentLevel.push(currentLevel[currentLevel.length - 1]!);
    }
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    path.push({
      hash: currentLevel[siblingIdx]!,
      position: idx % 2 === 0 ? "right" : "left",
    });

    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      nextLevel.push(hashPair(currentLevel[i]!, currentLevel[i + 1]!));
    }
    currentLevel = nextLevel;
    idx = Math.floor(idx / 2);
  }

  return {
    leaf: leaves[index]!,
    index,
    path,
    root: currentLevel[0]!,
  };
}

function verifyProof(
  proof: MerkleProof,
  hashPair: (a: string, b: string) => string,
): boolean {
  let current = proof.leaf;
  for (const step of proof.path) {
    current =
      step.position === "left"
        ? hashPair(step.hash, current)
        : hashPair(current, step.hash);
  }
  return current === proof.root;
}

export function computeMerkleRootV1(leaves: string[]): string {
  return computeRoot(leaves, hashPairV1);
}

export function createMerkleProofV1(
  leaves: string[],
  index: number,
): MerkleProof | null {
  return createProof(leaves, index, hashPairV1);
}

export function verifyMerkleProofV1(proof: MerkleProof): boolean {
  return verifyProof(proof, hashPairV1);
}

export const computeMerkleRoot = computeMerkleRootV1;
export const createMerkleProof = createMerkleProofV1;
export const verifyMerkleProof = verifyMerkleProofV1;
