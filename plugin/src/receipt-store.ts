/**
 * Bounded pending-receipt store for correlating before/after tool-call hooks.
 *
 * Correlation is host-authoritative via `toolCallId`. When that id is missing,
 * the store records an explicit reduced-confidence fallback key and never
 * silently joins ambiguous calls. Raw tool parameters are never retained —
 * only digests.
 */

import { DIGEST_DOMAINS, digest } from "@ovrsr/fpp-protocol-core";

export type CorrelationConfidence = "full" | "reduced";

export type ReceiptLifecycleStatus =
  | "pending_execution"
  | "pending_authorization"
  | "finalized"
  | "orphan"
  | "timed_out";

export type ReceiptDisposition =
  | "allow"
  | "deny"
  | "require_approval"
  | "abstain";

export type PendingReceiptRecord = {
  receiptId: string;
  toolCallId: string | null;
  fallbackCorrelationKey?: string | undefined;
  correlationConfidence: CorrelationConfidence;
  actionDigest: string;
  classification: string;
  disposition: ReceiptDisposition;
  decision: "block" | "approval" | "allow";
  agentId?: string | undefined;
  runId?: string | undefined;
  sessionKey?: string | undefined;
  proposedAt: string;
  authorization?: string | undefined;
  outcome?: string | undefined;
  status: ReceiptLifecycleStatus;
  finalizedAt?: string | undefined;
};

export type ProposeInput = {
  toolCallId?: string | undefined;
  toolName: string;
  paramsDigest: string;
  classification: string;
  decision: "block" | "approval" | "allow";
  agentId?: string | undefined;
  runId?: string | undefined;
  sessionKey?: string | undefined;
  nowIso: string;
};

export type ProposeResult = {
  record: PendingReceiptRecord;
  finalized: boolean;
  idempotent?: boolean | undefined;
};

export type FinalizeResult = PendingReceiptRecord & {
  idempotent?: boolean | undefined;
};

export type ReceiptStoreOptions = {
  maxPending?: number;
  pendingTtlMs?: number;
};

const DEFAULT_MAX_PENDING = 256;
const DEFAULT_PENDING_TTL_MS = 15 * 60_000;

export function digestActionParams(params: Record<string, unknown>): string {
  return digest({
    version: 2,
    domain: DIGEST_DOMAINS.receipt,
    value: { kind: "params", params },
  });
}

export function computeActionDigest(input: {
  toolName: string;
  paramsDigest: string;
  classification: string;
}): string {
  return digest({
    version: 2,
    domain: DIGEST_DOMAINS.receipt,
    value: {
      kind: "action",
      toolName: input.toolName,
      paramsDigest: input.paramsDigest,
      classification: input.classification,
    },
  });
}

function dispositionFor(
  decision: "block" | "approval" | "allow",
): ReceiptDisposition {
  if (decision === "block") return "deny";
  if (decision === "approval") return "require_approval";
  return "allow";
}

function fallbackKey(input: ProposeInput): string {
  return digest({
    version: 2,
    domain: DIGEST_DOMAINS.receipt,
    value: {
      kind: "fallback-correlation",
      toolName: input.toolName,
      paramsDigest: input.paramsDigest,
      classification: input.classification,
      agentId: input.agentId ?? null,
      runId: input.runId ?? null,
      sessionKey: input.sessionKey ?? null,
      proposedAt: input.nowIso,
    },
  });
}

export class ReceiptStore {
  private readonly maxPending: number;
  private readonly pendingTtlMs: number;
  private readonly pending = new Map<string, PendingReceiptRecord>();
  private readonly finalizedByKey = new Map<string, PendingReceiptRecord>();
  private readonly orphans: PendingReceiptRecord[] = [];
  private seq = 0;

  constructor(options: ReceiptStoreOptions = {}) {
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
    this.pendingTtlMs = options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  finalizedCount(): number {
    return this.finalizedByKey.size;
  }

  getPending(toolCallId: string): PendingReceiptRecord | undefined {
    return this.pending.get(toolCallId);
  }

  getFinalized(toolCallId: string): PendingReceiptRecord | undefined {
    return this.finalizedByKey.get(toolCallId);
  }

  drainOrphans(): PendingReceiptRecord[] {
    return this.orphans.splice(0, this.orphans.length);
  }

  propose(input: ProposeInput): ProposeResult {
    const key = this.correlationKey(input);
    const existingFinal = this.finalizedByKey.get(key);
    if (existingFinal) {
      return { record: existingFinal, finalized: true, idempotent: true };
    }
    const existingPending = this.pending.get(key);
    if (existingPending) {
      return {
        record: existingPending,
        finalized: false,
        idempotent: true,
      };
    }

    const correlationConfidence: CorrelationConfidence =
      input.toolCallId && input.toolCallId.length > 0 ? "full" : "reduced";
    const record: PendingReceiptRecord = {
      receiptId: `rcpt-${++this.seq}`,
      toolCallId: input.toolCallId && input.toolCallId.length > 0 ? input.toolCallId : null,
      correlationConfidence,
      actionDigest: computeActionDigest(input),
      classification: input.classification,
      disposition: dispositionFor(input.decision),
      decision: input.decision,
      agentId: input.agentId,
      runId: input.runId,
      sessionKey: input.sessionKey,
      proposedAt: input.nowIso,
      status:
        input.decision === "block"
          ? "finalized"
          : input.decision === "approval"
            ? "pending_authorization"
            : "pending_execution",
    };
    if (correlationConfidence === "reduced") {
      record.fallbackCorrelationKey = `fallback:${fallbackKey(input)}`;
    }

    if (input.decision === "block") {
      record.authorization = "policy-block";
      record.outcome = "blocked";
      record.finalizedAt = input.nowIso;
      this.finalizedByKey.set(key, record);
      return { record, finalized: true };
    }

    this.evictOldestIfNeeded();
    this.pending.set(key, record);
    return { record, finalized: false };
  }

  recordAuthorization(
    toolCallId: string,
    authorization: string,
    nowIso: string,
  ): PendingReceiptRecord | undefined {
    const record = this.pending.get(toolCallId);
    if (!record) {
      const done = this.finalizedByKey.get(toolCallId);
      return done;
    }
    record.authorization = authorization;
    if (authorization === "approved" || authorization === "allow-once" || authorization === "allow-always") {
      record.status = "pending_execution";
    } else {
      // deny / timeout / cancelled are terminal authorization outcomes
      record.outcome = authorization;
      record.status = "finalized";
      record.finalizedAt = nowIso;
      this.pending.delete(toolCallId);
      this.finalizedByKey.set(toolCallId, record);
    }
    return record;
  }

  finalizeExecution(
    toolCallId: string,
    outcome: string,
    nowIso: string,
  ): FinalizeResult | undefined {
    const done = this.finalizedByKey.get(toolCallId);
    if (done) {
      return { ...done, idempotent: true };
    }
    const record = this.pending.get(toolCallId);
    if (!record) return undefined;
    record.outcome = outcome;
    if (!record.authorization) {
      record.authorization =
        record.disposition === "allow" ? "policy-match" : "unresolved";
    }
    record.status = "finalized";
    record.finalizedAt = nowIso;
    this.pending.delete(toolCallId);
    this.finalizedByKey.set(toolCallId, record);
    return record;
  }

  sweepExpired(nowIso: string): PendingReceiptRecord[] {
    const now = Date.parse(nowIso);
    const expired: PendingReceiptRecord[] = [];
    for (const [key, record] of this.pending) {
      const proposed = Date.parse(record.proposedAt);
      if (Number.isNaN(now) || Number.isNaN(proposed)) continue;
      if (now - proposed < this.pendingTtlMs) continue;
      record.status = "timed_out";
      record.outcome = "audit_gap_timeout";
      record.finalizedAt = nowIso;
      this.pending.delete(key);
      this.orphans.push(record);
      expired.push(record);
    }
    return expired;
  }

  /** Mark all remaining pending entries as orphans (shutdown/restart). */
  orphanAllPending(nowIso: string, reason = "audit_gap_orphan"): PendingReceiptRecord[] {
    const out: PendingReceiptRecord[] = [];
    for (const [key, record] of this.pending) {
      record.status = "orphan";
      record.outcome = reason;
      record.finalizedAt = nowIso;
      this.pending.delete(key);
      this.orphans.push(record);
      out.push(record);
    }
    return out;
  }

  private correlationKey(input: ProposeInput): string {
    if (input.toolCallId && input.toolCallId.length > 0) return input.toolCallId;
    return `fallback:${fallbackKey(input)}`;
  }

  private evictOldestIfNeeded(): void {
    if (this.pending.size < this.maxPending) return;
    let oldestKey: string | undefined;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [key, record] of this.pending) {
      const ts = Date.parse(record.proposedAt);
      if (ts < oldestTs) {
        oldestTs = ts;
        oldestKey = key;
      }
    }
    if (!oldestKey) return;
    const victim = this.pending.get(oldestKey);
    if (!victim) return;
    this.pending.delete(oldestKey);
    victim.status = "orphan";
    victim.outcome = "audit_gap_overflow";
    victim.finalizedAt = new Date().toISOString();
    this.orphans.push(victim);
  }
}
