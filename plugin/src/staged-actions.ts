/**
 * File-backed ledger for staged-allow undo/review obligations.
 * Host rollback is not guaranteed — this records the obligation + audit trail.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export type StagedActionStatus = "open" | "undone" | "expired_without_undo";

export type StagedActionRecord = {
  schemaVersion: 1;
  toolCallId: string;
  classification: string;
  actionDigest: string;
  registeredAt: string;
  undoExpiresAt: string;
  status: StagedActionStatus;
};

export type RegisterStagedInput = {
  toolCallId: string;
  classification: string;
  actionDigest: string;
  undoWindowMs: number;
  nowMs: number;
};

export class StagedActionLedger {
  readonly path: string;

  constructor(ledgerPath: string, basePath?: string) {
    this.path = resolve(basePath ?? process.cwd(), ledgerPath);
  }

  private append(record: StagedActionRecord): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }

  private readAll(): StagedActionRecord[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as StagedActionRecord);
  }

  register(input: RegisterStagedInput): StagedActionRecord {
    const record: StagedActionRecord = {
      schemaVersion: 1,
      toolCallId: input.toolCallId,
      classification: input.classification,
      actionDigest: input.actionDigest,
      registeredAt: new Date(input.nowMs).toISOString(),
      undoExpiresAt: new Date(input.nowMs + input.undoWindowMs).toISOString(),
      status: "open",
    };
    this.append(record);
    return record;
  }

  /** Mark open windows past undoExpiresAt as expired_without_undo (auditable). */
  sweepExpired(nowMs: number): StagedActionRecord[] {
    const all = this.readAll();
    const expired: StagedActionRecord[] = [];
    const rewritten: StagedActionRecord[] = [];
    for (const record of all) {
      if (
        record.status === "open" &&
        Date.parse(record.undoExpiresAt) < nowMs
      ) {
        const next: StagedActionRecord = {
          ...record,
          status: "expired_without_undo",
        };
        expired.push(next);
        rewritten.push(next);
        this.append(next);
      } else {
        rewritten.push(record);
      }
    }
    void rewritten;
    return expired;
  }
}
