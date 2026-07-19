/**
 * Steward operator-authorization coverage seam for the disposition ladder.
 */

import { existsSync } from "node:fs";
import { AUTHZ } from "@ovrsr/fpp-protocol-core";
import {
  AuthorizationService,
  StewardAuthorizationLedger,
  StewardRegistry,
  createDefaultBackendRegistry,
  createOpenPgpBackend,
  type ActionDescriptor,
  type CandidateResult,
  type ConsumeResult,
} from "@ovrsr/fpp-steward-auth-core";
import type { LiveMandateCoverage } from "./disposition-engine.js";
import {
  buildActionDescriptor,
  type ToolCallLike,
} from "./action-descriptor.js";

export type StewardCoverageEvidence = {
  stewardId: string;
  authorizationId: string;
  signingKeyRef: string;
  stewardLedgerEventHash: string;
};

export type StewardCoverageLookup = {
  liveMandate: LiveMandateCoverage | null;
  action: ActionDescriptor;
  candidate: CandidateResult;
  evidence: StewardCoverageEvidence | null;
};

function createServices(ledgerPath: string): {
  service: AuthorizationService;
  registry: StewardRegistry;
} | null {
  if (!existsSync(ledgerPath)) {
    return null;
  }
  const ledger = new StewardAuthorizationLedger({ path: ledgerPath });
  const loaded = ledger.loadVerified();
  if (!loaded.ok || !loaded.policy) {
    return null;
  }
  const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
  const registry = new StewardRegistry({ ledger, backends });
  if (!registry.isValid()) {
    return null;
  }
  const service = new AuthorizationService({ ledger, backends, registry });
  return { service, registry };
}

export function lookupStewardOperatorCoverage(input: {
  ledgerPath: string;
  event: ToolCallLike;
  classification: string;
  workspaceRoot: string;
  knownCustomTools?: readonly string[];
  outOfWorkspacePaths?: Readonly<Record<string, string>>;
  nowMs?: number;
}): StewardCoverageLookup {
  const options: {
    knownCustomTools?: readonly string[];
    outOfWorkspacePaths?: Readonly<Record<string, string>>;
  } = {};
  if (input.knownCustomTools !== undefined) {
    options.knownCustomTools = input.knownCustomTools;
  }
  if (input.outOfWorkspacePaths !== undefined) {
    options.outOfWorkspacePaths = input.outOfWorkspacePaths;
  }
  const action = buildActionDescriptor(
    input.event,
    input.classification,
    input.workspaceRoot,
    Object.keys(options).length > 0 ? options : undefined,
  );

  const services = createServices(input.ledgerPath);
  if (!services) {
    return {
      liveMandate: null,
      action,
      candidate: { ok: false, reason: "ledger-unavailable" },
      evidence: null,
    };
  }

  const candidate = services.service.findCandidate(action, input.nowMs);
  if (!candidate.ok) {
    return { liveMandate: null, action, candidate, evidence: null };
  }

  return {
    liveMandate: {
      mandateId: candidate.mandateId,
      issuerClass: "operator",
      authorization: AUTHZ.mandate,
    },
    action,
    candidate,
    evidence: {
      stewardId: candidate.stewardId,
      authorizationId: candidate.authorizationId,
      signingKeyRef: candidate.signingKeyRef,
      stewardLedgerEventHash: candidate.eventHash,
    },
  };
}

export function consumeStewardOperatorCoverage(input: {
  ledgerPath: string;
  authorizationId: string;
  action: ActionDescriptor;
  nowMs?: number;
}): ConsumeResult {
  const services = createServices(input.ledgerPath);
  if (!services) {
    return { ok: false, reason: "ledger-unavailable" };
  }
  return services.service.consumeIfValid(
    input.authorizationId,
    input.action,
    input.nowMs,
  );
}

export function isOperatorMandateId(mandateId: string | undefined): boolean {
  return typeof mandateId === "string" && mandateId.startsWith("operator:");
}

export function operatorAuthorizationIdFromMandateId(
  mandateId: string,
): string {
  return mandateId.slice("operator:".length);
}
