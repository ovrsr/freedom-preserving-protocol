/**
 * Typed append-only conformance receipt ledger.
 *
 * Separate from the legacy enforcement audit log (`kind: "enforcement"`).
 * Entries are `kind: "conformance-receipt"` with signed receipt payloads,
 * hash-chained via protocol-core digests. Corruption fails closed — never
 * restarts the chain from the zero hash.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DIGEST_DOMAINS,
  computeMerkleRootV2,
  createMerkleProofV2,
  digest,
  parseConformanceReceipt,
  parseReceiptInclusionEvidence,
  type MerkleProof,
  type ReceiptInclusionEvidenceV1,
} from "@ovrsr/fpp-protocol-core";
import {
  verifyReceiptSignature,
  type SignedReceipt,
} from "./receipt-signer.js";

export const RECEIPT_LOG_KIND = "conformance-receipt" as const;
const ZERO = "0".repeat(64);

export class ReceiptLogCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptLogCorruptionError";
  }
}

export type ReceiptLogEntry = {
  previousHash: string;
  timestamp: string;
  kind: typeof RECEIPT_LOG_KIND;
  receipt: SignedReceipt;
  hash: string;
};

export type ReceiptLogVerifyReport = {
  ok: boolean;
  entries: number;
  errors: string[];
  logKind: typeof RECEIPT_LOG_KIND;
  signatureFailures: number;
  lastHash?: string | undefined;
  merkleRoot?: string | undefined;
};

function readPreviousHash(logPath: string): string {
  if (!existsSync(logPath)) return ZERO;
  const content = readFileSync(logPath, "utf-8").trim();
  if (!content) return ZERO;
  // Fail closed: never trust the tail hash alone — verify the full chain.
  const report = verifyReceiptLog(logPath);
  if (!report.ok) {
    throw new ReceiptLogCorruptionError(
      `receipt log corruption: existing chain is invalid at ${logPath}: ${report.errors.join("; ")}`,
    );
  }
  if (typeof report.lastHash === "string" && /^[0-9a-f]{64}$/.test(report.lastHash)) {
    return report.lastHash;
  }
  throw new ReceiptLogCorruptionError(
    `receipt log corruption: verified chain missing valid terminal hash at ${logPath}`,
  );
}

function hashReceiptEntry(entry: Record<string, unknown>): string {
  return digest({
    version: 2,
    domain: DIGEST_DOMAINS.entry,
    value: entry,
  });
}

export function appendSignedReceipt(
  logPath: string,
  receipt: SignedReceipt,
): { hash: string; previousHash: string } {
  const resolved = resolve(logPath);
  mkdirSync(dirname(resolved), { recursive: true });
  const previousHash = readPreviousHash(resolved);

  const entry: Record<string, unknown> = {
    previousHash,
    timestamp: new Date().toISOString(),
    kind: RECEIPT_LOG_KIND,
    receipt,
  };
  const hash = hashReceiptEntry(entry);
  entry.hash = hash;

  appendFileSync(resolved, JSON.stringify(entry) + "\n");
  return { hash, previousHash };
}

export function verifyReceiptLog(logPath: string): ReceiptLogVerifyReport {
  const report: ReceiptLogVerifyReport = {
    ok: true,
    entries: 0,
    errors: [],
    logKind: RECEIPT_LOG_KIND,
    signatureFailures: 0,
  };

  if (!existsSync(logPath)) {
    report.ok = false;
    report.errors.push(`receipt log not found: ${logPath}`);
    return report;
  }

  const content = readFileSync(logPath, "utf-8").trim();
  if (!content) return report;

  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  let prevHash = ZERO;
  const leafHashes: string[] = [];
  const seenHashes = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(lines[i]!) as Record<string, unknown>;
    } catch (e) {
      report.ok = false;
      report.errors.push(`line ${i + 1}: invalid JSON: ${(e as Error).message}`);
      return report;
    }

    if (entry.kind !== RECEIPT_LOG_KIND) {
      report.ok = false;
      report.errors.push(
        `line ${i + 1}: unexpected log kind ${String(entry.kind)} (expected ${RECEIPT_LOG_KIND} receipt log)`,
      );
      return report;
    }

    if (
      typeof entry.previousHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(entry.previousHash)
    ) {
      report.ok = false;
      report.errors.push(
        `line ${i + 1}: previousHash must be 64 lowercase hex characters`,
      );
    }
    if (entry.previousHash !== prevHash) {
      report.ok = false;
      report.errors.push(
        `line ${i + 1}: previousHash mismatch (expected ${prevHash.slice(0, 16)}..., got ${String(entry.previousHash).slice(0, 16)}...)`,
      );
    }

    const { hash: claimed, ...rest } = entry;
    if (typeof claimed !== "string" || !/^[0-9a-f]{64}$/.test(claimed)) {
      report.ok = false;
      report.errors.push(
        `line ${i + 1}: hash must be 64 lowercase hex characters`,
      );
    } else if (seenHashes.has(claimed)) {
      report.ok = false;
      report.errors.push(`line ${i + 1}: duplicate entry hash ${claimed}`);
    }
    const recomputed = hashReceiptEntry(rest);
    if (claimed !== recomputed) {
      report.ok = false;
      report.errors.push(
        `line ${i + 1}: hash mismatch (claimed ${String(claimed).slice(0, 16)}..., recomputed ${recomputed.slice(0, 16)}...)`,
      );
    }
    if (
      typeof entry.timestamp !== "string" ||
      !Number.isFinite(Date.parse(entry.timestamp)) ||
      new Date(Date.parse(entry.timestamp)).toISOString() !== entry.timestamp
    ) {
      report.ok = false;
      report.errors.push(
        `line ${i + 1}: timestamp must be canonical ISO-8601`,
      );
    }

    const receipt = entry.receipt as SignedReceipt | undefined;
    if (!receipt || typeof receipt !== "object") {
      report.ok = false;
      report.errors.push(`line ${i + 1}: missing receipt payload`);
    } else {
      const parsedReceipt = parseConformanceReceipt(receipt);
      if (!parsedReceipt.ok) {
        report.ok = false;
        report.errors.push(
          `line ${i + 1}: invalid receipt: ${parsedReceipt.error}`,
        );
      }
      if (receipt.signingStatus === "signed") {
        const sig = verifyReceiptSignature(receipt);
        if (!sig.valid) {
          report.ok = false;
          report.signatureFailures += 1;
          report.errors.push(`line ${i + 1}: signature failure: ${sig.reason}`);
        }
      } else if (receipt.signingStatus === "unsigned-degraded") {
        // Structurally valid but non-trust-elevating.
      } else {
        report.ok = false;
        report.errors.push(`line ${i + 1}: missing signingStatus on receipt`);
      }
    }

    prevHash = String(claimed);
    leafHashes.push(prevHash);
    if (typeof claimed === "string") seenHashes.add(claimed);
    report.entries += 1;
  }

  report.lastHash = prevHash;
  report.merkleRoot = computeMerkleRootV2(leafHashes);
  return report;
}

export function collectReceiptLeaves(logPath: string): string[] {
  const verification = verifyReceiptLog(logPath);
  if (!verification.ok) {
    throw new ReceiptLogCorruptionError(
      `receipt log validation failed: ${verification.errors.join("; ")}`,
    );
  }
  const content = readFileSync(logPath, "utf-8").trim();
  if (!content) return [];
  const leaves: string[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry.kind !== RECEIPT_LOG_KIND) continue;
      if (typeof entry.hash === "string") leaves.push(entry.hash);
    } catch {
      /* skip */
    }
  }
  return leaves;
}

export type ReceiptMerkleProof = MerkleProof & {
  logKind: typeof RECEIPT_LOG_KIND;
};

export function createReceiptProof(
  logPath: string,
  index: number,
): ReceiptMerkleProof | null {
  const leaves = collectReceiptLeaves(logPath);
  const proof = createMerkleProofV2(leaves, index);
  if (!proof) return null;
  return { ...proof, logKind: RECEIPT_LOG_KIND };
}

export function createReceiptInclusionEvidence(
  logPath: string,
  index: number,
): ReceiptInclusionEvidenceV1 | null {
  const proof = createReceiptProof(logPath, index);
  if (!proof) return null;

  const content = readFileSync(logPath, "utf-8").trim();
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  const line = lines[index];
  if (!line) return null;

  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  const candidate = {
    evidenceVersion: 1 as const,
    logKind: RECEIPT_LOG_KIND,
    entry,
    proof: {
      leaf: proof.leaf,
      index: proof.index,
      path: proof.path,
      root: proof.root,
    },
  };
  const parsed = parseReceiptInclusionEvidence(candidate);
  return parsed.ok ? parsed.evidence : null;
}
