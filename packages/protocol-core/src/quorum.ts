/**
 * Quorum proposal, ballot, and evidence-package schemas.
 * Quorum finalization produces StandingMandateV1 with evidenceRef
 * pointing at the evidence digest — not constitutional ratification.
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { digest, DIGEST_DOMAINS } from "./digest.js";

export const QUORUM_CLASSES = ["peer-quorum", "steward-quorum"] as const;
export type QuorumClass = (typeof QUORUM_CLASSES)[number];

export const QUORUM_VOTES = ["aye", "nay", "abstain"] as const;
export type QuorumVote = (typeof QUORUM_VOTES)[number];

const ScopeSchema = Type.Object(
  {
    classifications: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    capabilities: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { additionalProperties: false },
);

const BudgetsSchema = Type.Object(
  {
    maxActions: Type.Optional(Type.Integer({ minimum: 0 })),
    remainingActions: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const QuorumProposalV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    proposalId: Type.String({ minLength: 1 }),
    quorumClass: Type.Union([
      Type.Literal("peer-quorum"),
      Type.Literal("steward-quorum"),
    ]),
    proposerId: Type.String({ minLength: 1 }),
    /** Digest of the intended unsigned mandate payload. */
    mandateDigest: Type.String({ minLength: 1 }),
    scope: ScopeSchema,
    budgets: BudgetsSchema,
    mandateValidFrom: Type.String({ minLength: 1 }),
    mandateValidTo: Type.String({ minLength: 1 }),
    proposedAt: Type.String({ minLength: 1 }),
    expiresAt: Type.String({ minLength: 1 }),
    publicKey: Type.String({ minLength: 1 }),
    signature: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type QuorumProposalV1 = Static<typeof QuorumProposalV1Schema>;

export const QuorumBallotV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    ballotId: Type.String({ minLength: 1 }),
    proposalId: Type.String({ minLength: 1 }),
    voterId: Type.String({ minLength: 1 }),
    vote: Type.Union([
      Type.Literal("aye"),
      Type.Literal("nay"),
      Type.Literal("abstain"),
    ]),
    /** Must match the proposal's mandateDigest. */
    mandateDigest: Type.String({ minLength: 1 }),
    castAt: Type.String({ minLength: 1 }),
    publicKey: Type.String({ minLength: 1 }),
    signature: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type QuorumBallotV1 = Static<typeof QuorumBallotV1Schema>;

export const QuorumEvidencePackageV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    proposal: QuorumProposalV1Schema,
    ballots: Type.Array(QuorumBallotV1Schema, { minItems: 1 }),
    finalizedAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type QuorumEvidencePackageV1 = Static<
  typeof QuorumEvidencePackageV1Schema
>;

export type QuorumParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type QuorumProposalParseResult =
  | { ok: true; proposal: QuorumProposalV1 }
  | { ok: false; error: string };

export type QuorumBallotParseResult =
  | { ok: true; ballot: QuorumBallotV1 }
  | { ok: false; error: string };

export type QuorumEvidenceParseResult =
  | { ok: true; package: QuorumEvidencePackageV1 }
  | { ok: false; error: string };

export type BallotMatchResult =
  | { ok: true }
  | { ok: false; error: string };

function firstSchemaError(schema: unknown, input: unknown): string {
  const errors = [...Value.Errors(schema as never, input)];
  return errors[0] !== undefined
    ? `${errors[0].path}: ${errors[0].message}`
    : "invalid input";
}

export function parseQuorumProposal(input: unknown): QuorumProposalParseResult {
  if (!Value.Check(QuorumProposalV1Schema, input)) {
    return {
      ok: false,
      error: firstSchemaError(QuorumProposalV1Schema, input),
    };
  }
  return { ok: true, proposal: input };
}

export function parseQuorumBallot(input: unknown): QuorumBallotParseResult {
  if (!Value.Check(QuorumBallotV1Schema, input)) {
    return {
      ok: false,
      error: firstSchemaError(QuorumBallotV1Schema, input),
    };
  }
  return { ok: true, ballot: input };
}

export function parseQuorumEvidencePackage(
  input: unknown,
): QuorumEvidenceParseResult {
  if (!Value.Check(QuorumEvidencePackageV1Schema, input)) {
    return {
      ok: false,
      error: firstSchemaError(QuorumEvidencePackageV1Schema, input),
    };
  }
  return { ok: true, package: input };
}

/**
 * Ballot must reference the same proposal and mandateDigest.
 * Signature cryptographic verification is left to the plugin layer.
 */
export function validateBallotAgainstProposal(
  ballot: QuorumBallotV1,
  proposal: QuorumProposalV1,
): BallotMatchResult {
  if (ballot.proposalId !== proposal.proposalId) {
    return {
      ok: false,
      error: `proposalId mismatch: ballot=${ballot.proposalId} proposal=${proposal.proposalId}`,
    };
  }
  if (ballot.mandateDigest !== proposal.mandateDigest) {
    return {
      ok: false,
      error: "mandateDigest mismatch between ballot and proposal",
    };
  }
  return { ok: true };
}

/**
 * Stable digest of a quorum evidence package for StandingMandateV1.evidenceRef.
 * Domain-separated so it cannot be confused with claim/receipt digests.
 */
export function computeQuorumEvidenceDigest(
  pkg: QuorumEvidencePackageV1,
): string {
  return digest({
    version: 2,
    domain: DIGEST_DOMAINS.quorum,
    value: {
      schemaVersion: pkg.schemaVersion,
      proposal: pkg.proposal,
      ballots: pkg.ballots,
      finalizedAt: pkg.finalizedAt,
    },
  });
}
