/**
 * Merkle bridge for the FPP trust plugin.
 *
 * Reads the constitution audit JSONL log and provides Merkle root computation
 * and proof generation/verification. Used during handshakes so agents can
 * prove they are actually running their constitutional audit checks.
 *
 * Implementation mirrors scripts/merkle.ts from the parent skill package
 * but uses node:crypto SHA-256 (consistent with trust-graph.ts) and is
 * self-contained — no cross-package dependency.
 *
 * Fallback: when the primary audit log (constitution-audit.jsonl) has zero
 * entries, the bridge optionally falls back to a secondary path (e.g. the
 * enforcement plugin's fpp-plugin-audit.jsonl). This allows the trust
 * handshake to bootstrap from enforcement audit entries when no heartbeat/
 * adoption entries exist yet.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hashPair(a: string, b: string): string {
  return sha256Hex(a + b);
}

export function computeMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return "0".repeat(64);
  if (leaves.length === 1) return leaves[0]!;

  const level: string[] = [];
  for (let i = 0; i < leaves.length; i += 2) {
    const left = leaves[i]!;
    const right = leaves[i + 1] ?? left;
    level.push(hashPair(left, right));
  }
  return computeMerkleRoot(level);
}

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

export function createMerkleProof(
  leaves: string[],
  index: number,
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

export function verifyMerkleProof(proof: MerkleProof): boolean {
  let current = proof.leaf;
  for (const step of proof.path) {
    current =
      step.position === "left"
        ? hashPair(step.hash, current)
        : hashPair(current, step.hash);
  }
  return current === proof.root;
}

/**
 * Reads the audit JSONL log and collects per-entry hashes (the `hash` field
 * on each line). Returns empty array if the file does not exist.
 */
function collectLeafHashes(logPath: string): string[] {
  if (!existsSync(logPath)) return [];
  const content = readFileSync(logPath, "utf-8").trim();
  if (!content) return [];

  const hashes: string[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (typeof entry.hash === "string") hashes.push(entry.hash);
    } catch {
      /* skip malformed lines */
    }
  }
  return hashes;
}

export class MerkleBridge {
  private auditLogPath: string;
  private fallbackLogPath: string | null;

  /**
   * @param auditLogPath - Primary audit log (e.g. constitution-audit.jsonl)
   * @param basePath - Working directory for relative paths
   * @param fallbackLogPath - Optional secondary log (e.g. fpp-plugin-audit.jsonl).
   *   When the primary log has zero entries, the fallback is used. This bridges
   *   the enforcement plugin's audit trail into the trust handshake.
   */
  constructor(auditLogPath: string, basePath: string = process.cwd(), fallbackLogPath?: string | null) {
    this.auditLogPath = resolve(basePath, auditLogPath);
    this.fallbackLogPath = fallbackLogPath != null ? resolve(basePath, fallbackLogPath) : null;
  }

  private getActiveLeaves(): string[] {
    const primary = collectLeafHashes(this.auditLogPath);
    if (primary.length > 0) return primary;
    if (this.fallbackLogPath) {
      const fallback = collectLeafHashes(this.fallbackLogPath);
      if (fallback.length > 0) return fallback;
    }
    return primary;
  }

  getCurrentRoot(): { root: string; entryCount: number } {
    const leaves = this.getActiveLeaves();
    return { root: computeMerkleRoot(leaves), entryCount: leaves.length };
  }

  getRecentLeafHashes(n: number): string[] {
    const leaves = this.getActiveLeaves();
    return leaves.slice(-n);
  }

  createProofForIndex(index: number): MerkleProof | null {
    const leaves = this.getActiveLeaves();
    return createMerkleProof(leaves, index);
  }

  createProofForLeaf(leafHash: string): MerkleProof | null {
    const leaves = this.getActiveLeaves();
    const index = leaves.indexOf(leafHash);
    if (index === -1) return null;
    return createMerkleProof(leaves, index);
  }

  verifyProofAgainstRoot(proof: MerkleProof, expectedRoot: string): boolean {
    return verifyMerkleProof(proof) && proof.root === expectedRoot;
  }
}
