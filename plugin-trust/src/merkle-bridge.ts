/**
 * Typed Merkle bridge — primary and optional secondary logs are labeled by
 * evidence/log kind so receipt roots cannot be confused with heartbeat roots.
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

export type AuditLogKind = "heartbeat" | "enforcement" | "conformance-receipt" | "unknown";

export type TypedLogSource = {
  path: string;
  logKind: AuditLogKind;
};

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
      /* skip */
    }
  }
  return hashes;
}

function inferLogKind(logPath: string): AuditLogKind {
  if (!existsSync(logPath)) return "unknown";
  const content = readFileSync(logPath, "utf-8").trim();
  if (!content) return "unknown";
  const first = content.split("\n").find((l) => l.trim());
  if (!first) return "unknown";
  try {
    const entry = JSON.parse(first) as Record<string, unknown>;
    if (entry.kind === "conformance-receipt") return "conformance-receipt";
    if (entry.kind === "enforcement") return "enforcement";
    if (entry.kind === "heartbeat" || entry.kind === "adoption" || entry.kind === "revocation") {
      return "heartbeat";
    }
  } catch {
    return "unknown";
  }
  return "unknown";
}

export class MerkleBridge {
  private primary: TypedLogSource;
  private fallback: TypedLogSource | null;

  constructor(
    auditLogPath: string,
    basePath: string = process.cwd(),
    fallbackLogPath?: string | null,
  ) {
    this.primary = {
      path: resolve(basePath, auditLogPath),
      logKind: "heartbeat",
    };
    this.fallback =
      fallbackLogPath != null
        ? {
            path: resolve(basePath, fallbackLogPath),
            logKind: "enforcement",
          }
        : null;
  }

  private getActiveSource(): { leaves: string[]; source: TypedLogSource } {
    const primaryLeaves = collectLeafHashes(this.primary.path);
    if (primaryLeaves.length > 0) {
      return {
        leaves: primaryLeaves,
        source: {
          ...this.primary,
          logKind: inferLogKind(this.primary.path) || this.primary.logKind,
        },
      };
    }
    if (this.fallback) {
      const fallbackLeaves = collectLeafHashes(this.fallback.path);
      if (fallbackLeaves.length > 0) {
        return {
          leaves: fallbackLeaves,
          source: {
            ...this.fallback,
            logKind: inferLogKind(this.fallback.path) || this.fallback.logKind,
          },
        };
      }
    }
    return { leaves: primaryLeaves, source: this.primary };
  }

  getCurrentRoot(): {
    root: string;
    entryCount: number;
    logKind: AuditLogKind;
  } {
    const { leaves, source } = this.getActiveSource();
    return {
      root: computeMerkleRoot(leaves),
      entryCount: leaves.length,
      logKind: source.logKind,
    };
  }

  /** Explicit typed root — never silently substitutes a different log kind. */
  getRootForKind(kind: AuditLogKind): {
    root: string;
    entryCount: number;
    logKind: AuditLogKind;
    matched: boolean;
  } {
    const { leaves, source } = this.getActiveSource();
    if (source.logKind !== kind) {
      return { root: "0".repeat(64), entryCount: 0, logKind: kind, matched: false };
    }
    return {
      root: computeMerkleRoot(leaves),
      entryCount: leaves.length,
      logKind: source.logKind,
      matched: true,
    };
  }

  getRecentLeafHashes(n: number): string[] {
    const { leaves } = this.getActiveSource();
    return leaves.slice(-n);
  }

  createProofForIndex(index: number): (MerkleProof & { logKind: AuditLogKind }) | null {
    const { leaves, source } = this.getActiveSource();
    const proof = createMerkleProof(leaves, index);
    if (!proof) return null;
    return { ...proof, logKind: source.logKind };
  }

  createProofForLeaf(leafHash: string): (MerkleProof & { logKind: AuditLogKind }) | null {
    const { leaves, source } = this.getActiveSource();
    const index = leaves.indexOf(leafHash);
    if (index === -1) return null;
    const proof = createMerkleProof(leaves, index);
    if (!proof) return null;
    return { ...proof, logKind: source.logKind };
  }

  verifyProofAgainstRoot(proof: MerkleProof, expectedRoot: string): boolean {
    return this.evaluateInclusion(proof, expectedRoot).valid;
  }

  evaluateInclusion(
    proof: MerkleProof & { logKind?: string },
    claimedRoot: string,
    expectedLogKind?: AuditLogKind,
  ): {
    valid: boolean;
    semantics: "inclusion-under-claimed-root";
    rootMatch: boolean;
    proofValid: boolean;
    rootAnchored: false;
    logKindMatch: boolean;
  } {
    const proofValid = verifyMerkleProof(proof);
    const rootMatch = proof.root === claimedRoot;
    const logKindMatch =
      expectedLogKind === undefined ||
      proof.logKind === undefined ||
      proof.logKind === expectedLogKind;
    return {
      valid: proofValid && rootMatch && logKindMatch,
      semantics: "inclusion-under-claimed-root",
      rootMatch,
      proofValid,
      rootAnchored: false,
      logKindMatch,
    };
  }
}
