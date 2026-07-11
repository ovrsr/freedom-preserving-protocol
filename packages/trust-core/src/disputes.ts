/**
 * Append-only due-process ledger (Plan 5 DUE_PROCESS_AND_REHABILITATION).
 * Original evidence is never rewritten; status attaches via new records.
 */

import { canonicalize } from "@ovrsr/fpp-protocol-core";
import { createHash, randomBytes } from "node:crypto";
import type { AgentIdentity } from "./identity.js";
import { verifySignature } from "./identity.js";

export type DisputeVerb =
  | "challenge"
  | "evidence_request"
  | "counter_evidence"
  | "appeal"
  | "correction"
  | "remediation"
  | "rehabilitation"
  | "resolution";

export type DisputeStatus =
  | "open"
  | "stayed"
  | "under_appeal"
  | "corrected"
  | "rehabilitated"
  | "upheld"
  | "dismissed";

export type DisputeRecord = {
  verb: DisputeVerb;
  at: string;
  actorId: string;
  detail: string;
  publicKey: string;
  signature: string;
  counterEvidenceId?: string;
  interpretation?: string;
  scope?: { capability: string };
};

export type DisputeCase = {
  disputeId: string;
  originalEvidenceId: string;
  subjectId: string;
  claimantId: string;
  status: DisputeStatus;
  openedAt: string;
  respondBy: string;
  records: DisputeRecord[];
};

function signRecord(
  payload: Omit<DisputeRecord, "publicKey" | "signature">,
  signer: AgentIdentity,
): DisputeRecord {
  const body = canonicalize(payload);
  return {
    ...payload,
    publicKey: signer.publicKeyHex,
    signature: Buffer.from(
      signer.sign(new TextEncoder().encode(body)),
    ).toString("hex"),
  };
}

function verifyRecord(record: DisputeRecord): boolean {
  const { publicKey, signature, ...rest } = record;
  try {
    return verifySignature(
      new TextEncoder().encode(canonicalize(rest)),
      Buffer.from(signature, "hex"),
      Buffer.from(publicKey, "hex"),
    );
  } catch {
    return false;
  }
}

function newDisputeId(): string {
  return createHash("sha256")
    .update(randomBytes(16))
    .digest("hex")
    .slice(0, 16);
}

export class DisputeLedger {
  private cases = new Map<string, DisputeCase>();

  get(disputeId: string): DisputeCase | undefined {
    return this.cases.get(disputeId);
  }

  list(): DisputeCase[] {
    return [...this.cases.values()];
  }

  put(c: DisputeCase): void {
    this.cases.set(c.disputeId, c);
  }

  appendRecord(disputeId: string, record: DisputeRecord): DisputeCase {
    if (!verifyRecord(record)) {
      throw new Error("invalid dispute record signature");
    }
    const c = this.cases.get(disputeId);
    if (!c) throw new Error(`unknown dispute ${disputeId}`);
    c.records.push(record);
    return c;
  }
}

export function openChallenge(
  ledger: DisputeLedger,
  input: {
    evidenceId: string;
    subjectId: string;
    claimantId: string;
    reason: string;
    respondBy: string;
    signer: AgentIdentity;
  },
): DisputeCase {
  const disputeId = newDisputeId();
  const openedAt = new Date().toISOString();
  const record = signRecord(
    {
      verb: "challenge",
      at: openedAt,
      actorId: input.signer.agentId,
      detail: input.reason,
    },
    input.signer,
  );
  const c: DisputeCase = {
    disputeId,
    originalEvidenceId: input.evidenceId,
    subjectId: input.subjectId,
    claimantId: input.claimantId,
    status: "open",
    openedAt,
    respondBy: input.respondBy,
    records: [record],
  };
  ledger.put(c);
  return c;
}

export function requestEvidence(
  ledger: DisputeLedger,
  input: { disputeId: string; signer: AgentIdentity },
): DisputeCase {
  return ledger.appendRecord(
    input.disputeId,
    signRecord(
      {
        verb: "evidence_request",
        at: new Date().toISOString(),
        actorId: input.signer.agentId,
        detail: "evidence disclosure requested",
      },
      input.signer,
    ),
  );
}

export function submitCounterEvidence(
  ledger: DisputeLedger,
  input: {
    disputeId: string;
    counterEvidenceId: string;
    signer: AgentIdentity;
  },
): DisputeCase {
  return ledger.appendRecord(
    input.disputeId,
    signRecord(
      {
        verb: "counter_evidence",
        at: new Date().toISOString(),
        actorId: input.signer.agentId,
        detail: "counter-evidence attached",
        counterEvidenceId: input.counterEvidenceId,
      },
      input.signer,
    ),
  );
}

export function fileAppeal(
  ledger: DisputeLedger,
  input: { disputeId: string; reason: string; signer: AgentIdentity },
): DisputeCase {
  const c = ledger.appendRecord(
    input.disputeId,
    signRecord(
      {
        verb: "appeal",
        at: new Date().toISOString(),
        actorId: input.signer.agentId,
        detail: input.reason,
      },
      input.signer,
    ),
  );
  c.status = "under_appeal";
  return c;
}

export function recordCorrection(
  ledger: DisputeLedger,
  input: {
    disputeId: string;
    interpretation: string;
    signer: AgentIdentity;
    authorized: boolean;
  },
): DisputeCase {
  if (!input.authorized) throw new Error("unauthorized correction");
  const c = ledger.appendRecord(
    input.disputeId,
    signRecord(
      {
        verb: "correction",
        at: new Date().toISOString(),
        actorId: input.signer.agentId,
        detail: "correction annotation",
        interpretation: input.interpretation,
      },
      input.signer,
    ),
  );
  c.status = "corrected";
  return c;
}

export function recordRemediation(
  ledger: DisputeLedger,
  input: { disputeId: string; actions: string; signer: AgentIdentity },
): DisputeCase {
  return ledger.appendRecord(
    input.disputeId,
    signRecord(
      {
        verb: "remediation",
        at: new Date().toISOString(),
        actorId: input.signer.agentId,
        detail: input.actions,
      },
      input.signer,
    ),
  );
}

export function recordRehabilitation(
  ledger: DisputeLedger,
  input: {
    disputeId: string;
    scope: { capability: string };
    signer: AgentIdentity;
    authorized: boolean;
  },
): DisputeCase {
  if (!input.authorized) throw new Error("unauthorized rehabilitation");
  return ledger.appendRecord(
    input.disputeId,
    signRecord(
      {
        verb: "rehabilitation",
        at: new Date().toISOString(),
        actorId: input.signer.agentId,
        detail: "bounded rehabilitation",
        scope: input.scope,
      },
      input.signer,
    ),
  );
}

export function resolveDispute(
  ledger: DisputeLedger,
  input: {
    disputeId: string;
    outcome: Extract<
      DisputeStatus,
      "upheld" | "dismissed" | "rehabilitated" | "corrected"
    >;
    signer: AgentIdentity;
    authorized: boolean;
  },
): DisputeCase {
  if (!input.authorized) {
    throw new Error("unauthorized dispute resolution");
  }
  const c = ledger.appendRecord(
    input.disputeId,
    signRecord(
      {
        verb: "resolution",
        at: new Date().toISOString(),
        actorId: input.signer.agentId,
        detail: `resolved:${input.outcome}`,
      },
      input.signer,
    ),
  );
  c.status = input.outcome;
  return c;
}

/** Map dispute case status to policy disputeStatus factor. */
export function disputeStatusForPolicy(
  status: DisputeStatus,
): "none" | "challenged" | "under_appeal" | "corrected" | "rejected_source" {
  switch (status) {
    case "open":
    case "stayed":
      return "challenged";
    case "under_appeal":
      return "under_appeal";
    case "corrected":
    case "rehabilitated":
    case "dismissed":
      return "corrected";
    case "upheld":
      return "none";
    default:
      return "none";
  }
}
