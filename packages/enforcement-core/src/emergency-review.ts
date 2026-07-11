/**
 * Append-only mandatory-review ledger for emergency allow-minimal decisions.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type EmergencyReviewRecord = {
  schemaVersion: 1;
  toolCallId: string;
  classification: string;
  actionDigest: string;
  reason: string;
  recordedAt: string;
  status: "mandatory_review_pending";
  reviewed: false;
};

export type RequireReviewInput = {
  toolCallId: string;
  classification: string;
  actionDigest: string;
  reason: string;
  nowIso: string;
};

export class EmergencyReviewLedger {
  readonly path: string;

  constructor(ledgerPath: string, basePath?: string) {
    this.path = resolve(basePath ?? process.cwd(), ledgerPath);
  }

  requireReview(input: RequireReviewInput): EmergencyReviewRecord {
    const record: EmergencyReviewRecord = {
      schemaVersion: 1,
      toolCallId: input.toolCallId,
      classification: input.classification,
      actionDigest: input.actionDigest,
      reason: input.reason,
      recordedAt: input.nowIso,
      status: "mandatory_review_pending",
      reviewed: false,
    };
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }
}
