/**
 * Quorum session state machine: propose → second (ballot) → finalize.
 * On success emits a signed StandingMandateV1 into the shared mandate store.
 *
 * Quorum is local policy — not constitutional ratification.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  canonicalizeV2,
  computeQuorumEvidenceDigest,
  digest,
  DIGEST_DOMAINS,
  parseQuorumBallot,
  parseQuorumProposal,
  parseStandingMandate,
  validateBallotAgainstProposal,
  type QuorumBallotV1,
  type QuorumEvidencePackageV1,
  type QuorumProposalV1,
  type StandingMandateV1,
} from "@ovrsr/fpp-protocol-core";
import type { AgentIdentity } from "./identity.js";
import { verifySignature } from "./identity.js";
import {
  evaluateBallotEligibility,
  evaluateThreshold,
  type QuorumPolicyConfig,
} from "./quorum-policy.js";
import type { KeyLifecycleLedger } from "./key-lifecycle.js";
import type { TrustLevel } from "./trust-graph.js";

/**
 * Classification / capability tokens that claim nonparticipant consent.
 * Quorum cannot mint mandates for these — see CONSENT_AND_AUTHORIZATION.md.
 */
export const QUORUM_FORBIDDEN_SCOPE_TOKENS = [
  "affected-party-consent",
  "affected_party_consent",
  "data-subject-consent",
  "data_subject_consent",
  "nonparticipant-consent",
  "guardian-authorization",
] as const;

export function findForbiddenQuorumScopeTokens(
  scope: StandingMandateV1["scope"],
): string[] {
  const tokens = [
    ...(scope.classifications ?? []),
    ...(scope.capabilities ?? []),
  ].map((t) => t.trim().toLowerCase());
  const forbidden = new Set(
    QUORUM_FORBIDDEN_SCOPE_TOKENS.map((t) => t.toLowerCase()),
  );
  return tokens.filter((t) => forbidden.has(t));
}

export type IntendedMandateBody = {
  scope: StandingMandateV1["scope"];
  budgets: StandingMandateV1["budgets"];
  mandateValidFrom: string;
  mandateValidTo: string;
};

export type QuorumSessionRecord = {
  proposal: QuorumProposalV1;
  ballots: QuorumBallotV1[];
  status: "open" | "finalized" | "expired";
  mandateId?: string | undefined;
  evidenceDigest?: string | undefined;
};

export type QuorumStateFile = {
  schemaVersion: 1;
  sessions: Record<string, QuorumSessionRecord>;
};

export type MandateStoreFile = {
  schemaVersion: 1;
  mandates: StandingMandateV1[];
};

export type QuorumSessionManagerOptions = {
  policy: QuorumPolicyConfig;
  ledger: KeyLifecycleLedger;
  mandateStorePath: string;
  statePath: string;
  basePath?: string | undefined;
  nowMs?: (() => number) | undefined;
  /** Optional standing lookup for ballot eligibility. */
  standingFor?:
    | ((voterId: string) => TrustLevel | undefined)
    | undefined;
};

export type QuorumOpResult<T = void> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export type FinalizeResult = QuorumOpResult<{
  mandate: StandingMandateV1;
  idempotent: boolean;
  evidenceDigest: string;
}>;

function signPayload(
  unsigned: Record<string, unknown>,
  identity: AgentIdentity,
): { publicKey: string; signature: string } {
  const message = Buffer.from(canonicalizeV2(unsigned), "utf8");
  const signature = Buffer.from(identity.sign(message)).toString("hex");
  return { publicKey: identity.publicKeyHex, signature };
}

function verifySignedPayload(
  unsigned: Record<string, unknown>,
  publicKeyHex: string,
  signatureHex: string,
): boolean {
  try {
    const message = Buffer.from(canonicalizeV2(unsigned), "utf8");
    const sig = Buffer.from(signatureHex, "hex");
    const pub = Buffer.from(publicKeyHex, "hex");
    if (sig.length !== 64 || pub.length !== 32) return false;
    return verifySignature(message, sig, pub);
  } catch {
    return false;
  }
}

/** Digest voters agree on before signatures exist on the mandate. */
export function computeIntendedMandateDigest(
  body: IntendedMandateBody,
): string {
  return digest({
    version: 2,
    domain: DIGEST_DOMAINS.mandate,
    value: {
      scope: body.scope,
      budgets: body.budgets,
      mandateValidFrom: body.mandateValidFrom,
      mandateValidTo: body.mandateValidTo,
    },
  });
}

export function signQuorumProposal(
  fields: Omit<QuorumProposalV1, "publicKey" | "signature">,
  identity: AgentIdentity,
): QuorumProposalV1 {
  const { publicKey, signature } = signPayload(
    fields as unknown as Record<string, unknown>,
    identity,
  );
  return { ...fields, publicKey, signature };
}

export function signQuorumBallot(
  fields: Omit<QuorumBallotV1, "publicKey" | "signature">,
  identity: AgentIdentity,
): QuorumBallotV1 {
  const { publicKey, signature } = signPayload(
    fields as unknown as Record<string, unknown>,
    identity,
  );
  return { ...fields, publicKey, signature };
}

function stripSig<T extends { publicKey: string; signature: string }>(
  signed: T,
): Omit<T, "publicKey" | "signature"> {
  const { publicKey: _p, signature: _s, ...rest } = signed;
  void _p;
  void _s;
  return rest;
}

export class QuorumSessionManager {
  private readonly policy: QuorumPolicyConfig;
  private readonly ledger: KeyLifecycleLedger;
  private readonly mandateStorePath: string;
  private readonly statePath: string;
  private readonly nowMs: () => number;
  private readonly standingFor?:
    | ((voterId: string) => TrustLevel | undefined)
    | undefined;
  private sessions: Record<string, QuorumSessionRecord> = {};

  constructor(options: QuorumSessionManagerOptions) {
    this.policy = options.policy;
    this.ledger = options.ledger;
    const base = options.basePath ?? process.cwd();
    this.mandateStorePath = resolve(base, options.mandateStorePath);
    this.statePath = resolve(base, options.statePath);
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.standingFor = options.standingFor;
    this.reload();
  }

  reload(): void {
    if (!existsSync(this.statePath)) {
      this.sessions = {};
      return;
    }
    const raw = JSON.parse(readFileSync(this.statePath, "utf8")) as QuorumStateFile;
    if (raw.schemaVersion !== 1 || typeof raw.sessions !== "object") {
      throw new Error(`invalid quorum state at ${this.statePath}`);
    }
    this.sessions = raw.sessions;
  }

  private persist(): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    const file: QuorumStateFile = {
      schemaVersion: 1,
      sessions: this.sessions,
    };
    writeFileSync(this.statePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }

  getSession(proposalId: string): QuorumSessionRecord | undefined {
    return this.sessions[proposalId];
  }

  listSessions(): QuorumSessionRecord[] {
    return Object.values(this.sessions);
  }

  private expireIfNeeded(session: QuorumSessionRecord): QuorumSessionRecord {
    if (session.status !== "open") return session;
    const expires = Date.parse(session.proposal.expiresAt);
    if (!Number.isNaN(expires) && this.nowMs() > expires) {
      const updated: QuorumSessionRecord = { ...session, status: "expired" };
      this.sessions[session.proposal.proposalId] = updated;
      this.persist();
      return updated;
    }
    return session;
  }

  propose(proposal: QuorumProposalV1): QuorumOpResult<{ proposalId: string }> {
    const parsed = parseQuorumProposal(proposal);
    if (!parsed.ok) return { ok: false, error: parsed.error };

    if (
      !verifySignedPayload(
        stripSig(parsed.proposal) as unknown as Record<string, unknown>,
        parsed.proposal.publicKey,
        parsed.proposal.signature,
      )
    ) {
      return { ok: false, error: "proposal signature verification failed" };
    }

    const expected = computeIntendedMandateDigest({
      scope: parsed.proposal.scope,
      budgets: parsed.proposal.budgets,
      mandateValidFrom: parsed.proposal.mandateValidFrom,
      mandateValidTo: parsed.proposal.mandateValidTo,
    });
    if (parsed.proposal.mandateDigest !== expected) {
      return { ok: false, error: "proposal mandateDigest does not match scope/budgets" };
    }

    const eligibility = evaluateBallotEligibility(this.policy, this.ledger, {
      voterId: parsed.proposal.proposerId,
      publicKeyHex: parsed.proposal.publicKey,
      quorumClass: parsed.proposal.quorumClass,
      nowMs: this.nowMs(),
      standingLevel: this.standingFor?.(parsed.proposal.proposerId),
    });
    if (!eligibility.ok) {
      return { ok: false, error: `proposer ineligible: ${eligibility.reason}` };
    }

    const existing = this.sessions[parsed.proposal.proposalId];
    if (existing) {
      return { ok: false, error: `proposal ${parsed.proposal.proposalId} already exists` };
    }

    this.sessions[parsed.proposal.proposalId] = {
      proposal: parsed.proposal,
      ballots: [],
      status: "open",
    };
    this.persist();
    return { ok: true, proposalId: parsed.proposal.proposalId };
  }

  second(ballot: QuorumBallotV1): QuorumOpResult<{ ayeCount: number }> {
    const parsed = parseQuorumBallot(ballot);
    if (!parsed.ok) return { ok: false, error: parsed.error };

    if (
      !verifySignedPayload(
        stripSig(parsed.ballot) as unknown as Record<string, unknown>,
        parsed.ballot.publicKey,
        parsed.ballot.signature,
      )
    ) {
      return { ok: false, error: "ballot signature verification failed" };
    }

    let session = this.sessions[parsed.ballot.proposalId];
    if (!session) {
      return { ok: false, error: `unknown proposal ${parsed.ballot.proposalId}` };
    }
    session = this.expireIfNeeded(session);
    if (session.status === "expired") {
      return { ok: false, error: "proposal expired" };
    }
    if (session.status === "finalized") {
      return { ok: false, error: "proposal already finalized" };
    }

    const match = validateBallotAgainstProposal(parsed.ballot, session.proposal);
    if (!match.ok) return { ok: false, error: match.error };

    const eligibility = evaluateBallotEligibility(this.policy, this.ledger, {
      voterId: parsed.ballot.voterId,
      publicKeyHex: parsed.ballot.publicKey,
      quorumClass: session.proposal.quorumClass,
      nowMs: this.nowMs(),
      standingLevel: this.standingFor?.(parsed.ballot.voterId),
    });
    if (!eligibility.ok) {
      return { ok: false, error: eligibility.reason };
    }

    if (session.ballots.some((b) => b.ballotId === parsed.ballot.ballotId)) {
      return { ok: false, error: "duplicate ballotId (replay)" };
    }
    if (session.ballots.some((b) => b.voterId === parsed.ballot.voterId)) {
      return { ok: false, error: "voter already cast a ballot on this proposal" };
    }

    session.ballots.push(parsed.ballot);
    this.sessions[session.proposal.proposalId] = session;
    this.persist();

    const ayeCount = session.ballots.filter((b) => b.vote === "aye").length;
    return { ok: true, ayeCount };
  }

  finalize(
    proposalId: string,
    issuer: AgentIdentity,
  ): FinalizeResult {
    let session = this.sessions[proposalId];
    if (!session) {
      return { ok: false, error: `unknown proposal ${proposalId}` };
    }

    if (session.status === "finalized" && session.mandateId) {
      const existing = this.readMandate(session.mandateId);
      if (existing) {
        return {
          ok: true,
          mandate: existing,
          idempotent: true,
          evidenceDigest: session.evidenceDigest ?? existing.evidenceRef,
        };
      }
    }

    session = this.expireIfNeeded(session);
    if (session.status === "expired") {
      return { ok: false, error: "proposal expired" };
    }
    if (session.status === "finalized") {
      return { ok: false, error: "proposal finalized but mandate missing" };
    }

    const forbidden = findForbiddenQuorumScopeTokens(session.proposal.scope);
    if (forbidden.length > 0) {
      return {
        ok: false,
        error:
          `quorum cannot mint nonparticipant consent scopes: ${forbidden.join(", ")} ` +
          `(affected-party/data-subject consent required — not agent majority)`,
      };
    }

    const ayeCount = session.ballots.filter((b) => b.vote === "aye").length;
    const threshold = evaluateThreshold(this.policy, {
      quorumClass: session.proposal.quorumClass,
      ayeCount,
    });
    if (!threshold.ok) {
      return { ok: false, error: threshold.reason };
    }

    const finalizedAt = new Date(this.nowMs()).toISOString();
    const evidencePkg: QuorumEvidencePackageV1 = {
      schemaVersion: 1,
      proposal: session.proposal,
      ballots: session.ballots,
      finalizedAt,
    };
    const evidenceDigest = computeQuorumEvidenceDigest(evidencePkg);
    const mandateId = `quorum:${proposalId}`;

    const unsignedBody: Omit<StandingMandateV1, "publicKey" | "signature"> = {
      schemaVersion: 1,
      mandateId,
      issuerClass: session.proposal.quorumClass,
      issuerId: `quorum:${session.proposal.quorumClass}:${proposalId}`,
      scope: session.proposal.scope,
      budgets: session.proposal.budgets,
      validFrom: session.proposal.mandateValidFrom,
      validTo: session.proposal.mandateValidTo,
      revocable: true,
      evidenceRef: evidenceDigest,
      quorumRef: proposalId,
    };

    // MandateStore verifies canonicalizeV2({...fields, publicKey}) — publicKey
    // is part of the signed payload; only signature is stripped.
    const toSign: Omit<StandingMandateV1, "signature"> = {
      ...unsignedBody,
      publicKey: issuer.publicKeyHex,
    };
    const message = Buffer.from(canonicalizeV2(toSign), "utf8");
    const signature = Buffer.from(issuer.sign(message)).toString("hex");
    const mandate: StandingMandateV1 = {
      ...toSign,
      signature,
    };
    const parsed = parseStandingMandate(mandate);
    if (!parsed.ok) {
      return { ok: false, error: `issued mandate invalid: ${parsed.error}` };
    }

    this.writeMandate(parsed.mandate);
    this.sessions[proposalId] = {
      ...session,
      status: "finalized",
      mandateId,
      evidenceDigest,
    };
    this.persist();

    return {
      ok: true,
      mandate: parsed.mandate,
      idempotent: false,
      evidenceDigest,
    };
  }

  /** Mark a quorum-issued mandate revoked in the store + session. */
  revokeMandate(
    mandateId: string,
    reason: string,
  ): QuorumOpResult<{ mandateId: string; reason: string }> {
    const store = this.readStore();
    const idx = store.mandates.findIndex((m) => m.mandateId === mandateId);
    if (idx < 0) {
      return { ok: false, error: `mandate ${mandateId} not found` };
    }
    const current = store.mandates[idx]!;
    if (current.revocable !== true) {
      return { ok: false, error: "mandate is not revocable" };
    }
    store.mandates[idx] = { ...current, revoked: true };
    this.writeStore(store);

    for (const [id, session] of Object.entries(this.sessions)) {
      if (session.mandateId === mandateId) {
        this.sessions[id] = { ...session };
      }
    }
    this.persist();
    return { ok: true, mandateId, reason };
  }

  private readStore(): MandateStoreFile {
    if (!existsSync(this.mandateStorePath)) {
      return { schemaVersion: 1, mandates: [] };
    }
    const raw = JSON.parse(
      readFileSync(this.mandateStorePath, "utf8"),
    ) as MandateStoreFile;
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.mandates)) {
      throw new Error(`invalid mandate store at ${this.mandateStorePath}`);
    }
    return raw;
  }

  private writeStore(store: MandateStoreFile): void {
    mkdirSync(dirname(this.mandateStorePath), { recursive: true });
    writeFileSync(
      this.mandateStorePath,
      `${JSON.stringify(store, null, 2)}\n`,
      "utf8",
    );
  }

  private writeMandate(mandate: StandingMandateV1): void {
    const store = this.readStore();
    const idx = store.mandates.findIndex((m) => m.mandateId === mandate.mandateId);
    if (idx >= 0) {
      store.mandates[idx] = mandate;
    } else {
      store.mandates.push(mandate);
    }
    this.writeStore(store);
  }

  private readMandate(mandateId: string): StandingMandateV1 | null {
    const store = this.readStore();
    return store.mandates.find((m) => m.mandateId === mandateId) ?? null;
  }
}
