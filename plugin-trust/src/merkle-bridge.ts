/**
 * Merkle bridge for the FPP trust plugin.
 *
 * Reads the constitution audit JSONL log and provides Merkle root computation
 * and proof generation/verification. Merkle primitives live in
 * `@ovrsr/fpp-protocol-core`; this module retains file selection and leaf
 * extraction only.
 *
 * Fallback: when the primary audit log (constitution-audit.jsonl) has zero
 * entries, the bridge optionally falls back to a secondary path (e.g. the
 * enforcement plugin's fpp-plugin-audit.jsonl).
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeMerkleRoot,
  createMerkleProof,
  verifyMerkleProof,
  type MerkleProof,
  type MerkleProofStep,
} from "@ovrsr/fpp-protocol-core";

export {
  computeMerkleRoot,
  createMerkleProof,
  verifyMerkleProof,
  type MerkleProof,
  type MerkleProofStep,
};

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
  constructor(
    auditLogPath: string,
    basePath: string = process.cwd(),
    fallbackLogPath?: string | null,
  ) {
    this.auditLogPath = resolve(basePath, auditLogPath);
    this.fallbackLogPath =
      fallbackLogPath != null ? resolve(basePath, fallbackLogPath) : null;
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
