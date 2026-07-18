/**
 * Harness-neutral enforcement runtime adapter.
 *
 * OpenClaw (and future Cursor/Claude/Codex adapters) implement
 * `FppRuntimeAdapter` and call `createEnforcementRuntime` — core never
 * imports harness SDKs.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DIGEST_DOMAINS, digest } from "@ovrsr/fpp-protocol-core";
import {
  CONSERVATIVE_STRICT_APPROVAL_ON,
  mergeConfig,
  type FppPluginConfig,
} from "./config.js";
import { classifyToolCall, type ClassificationResult } from "./risk-classifier.js";
import {
  resolveDisposition,
  type DispositionResult,
} from "./disposition-engine.js";
import { MandateStore } from "./mandate-store.js";
import { EmergencyOverrideStore } from "./emergency-override-store.js";
import {
  appendEnforcementEntry,
  appendMandateIntegrityDiagnostic,
  type EnforcementEvent,
  type EnforcementOutcome,
} from "./audit-log.js";
import {
  ReceiptStore,
  digestActionParams,
  type PendingReceiptRecord,
} from "./receipt-store.js";
import {
  loadReceiptSigner,
  signReceiptPayload,
  type ReceiptSigner,
  type SignedReceipt,
} from "./receipt-signer.js";
import {
  appendSignedReceipt,
  ReceiptLogCorruptionError,
} from "./receipt-log.js";
import { buildRuntimeManifest, type PackageBuildInput } from "./runtime-manifest.js";
import { isReversibleClassification } from "./reversibility.js";
import { StagedActionLedger } from "./staged-actions.js";
import { EmergencyReviewLedger } from "./emergency-review.js";
import type { DispositionDecision } from "@ovrsr/fpp-protocol-core";
import {
  consumeStewardOperatorCoverage,
  isOperatorMandateId,
  lookupStewardOperatorCoverage,
  operatorAuthorizationIdFromMandateId,
  type StewardCoverageEvidence,
} from "./steward-coverage.js";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export type FppWorkspacePaths = {
  workspaceRoot: string;
};

export type FppToolCallEvent = {
  toolName: string;
  params?: Record<string, unknown> | undefined;
  runId?: string | undefined;
  toolCallId?: string | undefined;
  result?: unknown;
  error?: string | undefined;
  durationMs?: number | undefined;
};

export type FppToolCallContext = {
  agentId?: string | undefined;
  runId?: string | undefined;
  sessionKey?: string | undefined;
  toolCallId?: string | undefined;
};

export type FppApprovalDecision =
  | "allow-once"
  | "allow-always"
  | "deny"
  | "timeout"
  | "cancelled";

export type FppApprovalRequest = {
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
  timeoutMs: number;
  timeoutBehavior: "allow" | "deny";
  classification: ClassificationResult;
  toolName: string;
};

export type FppBeforeToolCallResult =
  | { action: "block"; blockReason: string }
  | {
      action: "require_approval";
      title: string;
      description: string;
      severity: "critical" | "warning" | "info";
      timeoutMs: number;
      timeoutBehavior: "allow" | "deny";
      onResolution: (decision: FppApprovalDecision) => Promise<void>;
    }
  | { action: "allow"; disposition: DispositionResult };

/**
 * Harness-facing adapter surface. Core calls these; adapters never call into
 * OpenClaw/Cursor SDKs from inside enforcement-core.
 */
export type FppRuntimeAdapter = {
  harnessId: string;
  getWorkspacePaths: () => FppWorkspacePaths;
  /** Only invoked by adapters in operator-present flows that need UI approval. */
  requestApproval?:
    | ((request: FppApprovalRequest) => Promise<FppApprovalDecision>)
    | undefined;
  registerTools?: ((tools: unknown[]) => void) | undefined;
};

export type EnforcementRuntimeOptions = {
  packageBuild?: PackageBuildInput | undefined;
  approvalTitle?:
    | ((c: ClassificationResult) => string)
    | undefined;
  approvalDescription?:
    | ((c: ClassificationResult, toolName: string) => string)
    | undefined;
};

export type EnforcementRuntime = {
  adapter: FppRuntimeAdapter;
  getConfig: () => FppPluginConfig;
  onBeforeToolCall: (
    event: FppToolCallEvent,
    ctx: FppToolCallContext,
  ) => Promise<FppBeforeToolCallResult>;
  onAfterToolCall: (
    event: FppToolCallEvent,
    ctx: FppToolCallContext,
  ) => Promise<void>;
  reset: () => void;
  getReceiptStore: () => ReceiptStore;
  reconcileOrphanedReceipts: (nowIso?: string) => PendingReceiptRecord[];
};

export function legacyDecisionFromDisposition(
  disposition: DispositionDecision,
): "block" | "approval" | "allow" {
  if (disposition === "deny" || disposition === "abstain") return "block";
  if (disposition === "require_approval") return "approval";
  return "allow";
}

function severityFor(
  classification: ClassificationResult,
): "info" | "warning" | "critical" {
  if (classification.decision === "block") return "critical";
  if (
    classification.classification.startsWith("fs.delete") ||
    classification.classification.startsWith("fs.write.protected") ||
    classification.classification.startsWith("exec.system-modify") ||
    classification.classification.startsWith("gateway.")
  ) {
    return "warning";
  }
  return "info";
}

function defaultTitle(classification: ClassificationResult): string {
  const title = `FPP gate: ${classification.classification}`;
  return title.length <= 80 ? title : title.slice(0, 77) + "...";
}

function defaultDescription(
  classification: ClassificationResult,
  toolName: string,
): string {
  const body = `${classification.classification}: ${classification.reason} [${toolName}]`;
  return body.length <= 256 ? body : body.slice(0, 253) + "...";
}

function emitAuditGap(message: string): void {
  console.error(`FPP AUDIT-GAP: ${message}`);
}

function workspaceSibling(configPath: string, filename: string): string {
  return join(dirname(configPath), filename);
}

/**
 * Load the local agent public key from the identity seed file.
 * Used for emergency-override self-key rejection (defense-in-depth).
 */
function loadLocalPublicKeyHex(keyPath: string): string | undefined {
  const resolved = resolve(keyPath);
  if (!existsSync(resolved)) return undefined;
  const raw = readFileSync(resolved);
  if (raw.length !== 32) return undefined;
  return Buffer.from(ed.getPublicKey(new Uint8Array(raw))).toString("hex");
}

interface StrictSessionEntry {
  strict: boolean;
  addedApprovalOn: string[];
  expiresAt: string;
}

interface StrictModeState {
  version: number;
  sessions: Record<string, StrictSessionEntry>;
}

type StrictReadResult =
  | { kind: "ok"; state: StrictModeState }
  | { kind: "missing" }
  | { kind: "degraded"; code: "STRICT_MODE_MALFORMED" | "STRICT_MODE_SCHEMA_INVALID" };

function isValidStrictEntry(value: unknown): value is StrictSessionEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.strict === "boolean" &&
    Array.isArray(e.addedApprovalOn) &&
    e.addedApprovalOn.every((x) => typeof x === "string") &&
    typeof e.expiresAt === "string"
  );
}

/**
 * Create a harness-agnostic enforcement runtime.
 * `requestApproval` on the adapter is never called by core — adapters that
 * need interactive approval handle `action: "require_approval"` themselves
 * (operator-present mode only).
 */
export function createEnforcementRuntime(
  configInput: unknown,
  adapter: FppRuntimeAdapter,
  options: EnforcementRuntimeOptions = {},
): EnforcementRuntime {
  const config = mergeConfig(configInput);
  let receiptStore: ReceiptStore | null = null;
  let receiptSigner: ReceiptSigner | null = null;
  let mandateStore: MandateStore | null = null;
  let emergencyOverrideStore: EmergencyOverrideStore | null = null;
  let stagedLedger: StagedActionLedger | null = null;
  let emergencyLedger: EmergencyReviewLedger | null = null;
  let strictModeCache: { result: StrictReadResult; readAt: number } | null =
    null;
  const STRICT_CACHE_TTL_MS = 1000;

  function getReceiptStore(): ReceiptStore {
    if (!receiptStore) {
      receiptStore = new ReceiptStore({
        maxPending: config.receiptMaxPending,
        pendingTtlMs: config.receiptPendingTtlMs,
      });
    }
    return receiptStore;
  }

  function getReceiptSigner(): ReceiptSigner {
    if (!receiptSigner) {
      receiptSigner = loadReceiptSigner({
        keyPath: config.identityKeyPath,
        enabled: config.receiptSigningEnabled,
      });
    }
    return receiptSigner;
  }

  function getMandateStore(): MandateStore {
    if (!mandateStore) {
      mandateStore = new MandateStore(config.mandateStorePath, {
        standingAllowOn: config.standingAllowOn,
        mandateDefaultMaxActions: config.mandateDefaultMaxActions,
        onDiagnostic: (diag) => {
          emitAuditGap(
            `mandate ${diag.kind}: ${diag.mandateId}: ${diag.reason}`,
          );
          try {
            appendMandateIntegrityDiagnostic(config.auditLogPath, {
              mandateId: diag.mandateId,
              reason: diag.reason,
              kind: diag.kind,
              constitutionHash: config.constitutionHash,
            });
          } catch (err) {
            emitAuditGap(
              `mandate diagnostic audit append failed: ${(err as Error).message}`,
            );
          }
        },
      });
    }
    return mandateStore;
  }

  function getEmergencyOverrideStore(): EmergencyOverrideStore {
    if (!emergencyOverrideStore) {
      emergencyOverrideStore = new EmergencyOverrideStore(
        workspaceSibling(config.mandateStorePath, "fpp-emergency-overrides.json"),
      );
    }
    return emergencyOverrideStore;
  }

  function getStagedLedger(): StagedActionLedger {
    if (!stagedLedger) {
      stagedLedger = new StagedActionLedger(
        workspaceSibling(config.mandateStorePath, "fpp-staged-actions.jsonl"),
      );
    }
    return stagedLedger;
  }

  function getEmergencyLedger(): EmergencyReviewLedger {
    if (!emergencyLedger) {
      emergencyLedger = new EmergencyReviewLedger(
        workspaceSibling(config.mandateStorePath, "fpp-emergency-review.jsonl"),
      );
    }
    return emergencyLedger;
  }

  function buildSignedReceiptFromRecord(
    record: PendingReceiptRecord,
  ): SignedReceipt {
    const runtime = buildRuntimeManifest({
      config,
      constitutionHash: config.constitutionHash,
      degraded: false,
      packageBuild: options.packageBuild,
    });
    const payload = {
      schemaVersion: 1 as const,
      receiptClass: "conformance" as const,
      actionDigest: record.actionDigest,
      policyId: runtime.policyId,
      policyVersion: runtime.policyVersion,
      implementationVersion: runtime.implementationVersion,
      disposition: record.disposition,
      authorization: record.authorization ?? "unresolved",
      outcome: record.outcome ?? "unknown",
      issuedAt: record.finalizedAt ?? record.proposedAt,
      classification: record.classification,
      receiptId: record.receiptId,
      toolCallId: record.toolCallId,
      correlationConfidence: record.correlationConfidence,
      constitutionHash: runtime.constitutionHash,
      classifierRulesetHash: runtime.classifierRulesetHash,
      effectiveConfigHash: runtime.effectiveConfigHash,
      packageBuildHash: runtime.packageBuildHash,
      pluginApiCompat: runtime.pluginApiCompat,
      runtimeState: runtime.runtimeState,
    };
    return signReceiptPayload(payload, getReceiptSigner());
  }

  function persistFinalizedReceipt(record: PendingReceiptRecord): void {
    try {
      const signed = buildSignedReceiptFromRecord(record);
      appendSignedReceipt(config.receiptLogPath, signed);
    } catch (err) {
      if (err instanceof ReceiptLogCorruptionError) {
        emitAuditGap(
          `receipt ledger corruption; cannot append receipt ${record.receiptId}: ${err.message}`,
        );
        return;
      }
      emitAuditGap(
        `receipt ledger write failed for ${record.receiptId}: ${(err as Error).message}`,
      );
    }
  }

  function emitStrictDiagnostic(
    code: "STRICT_MODE_MALFORMED" | "STRICT_MODE_SCHEMA_INVALID",
    detail: string,
  ): void {
    console.error(`FPP ${code}: ${detail}`);
  }

  function readStrictModeState(filePath: string): StrictReadResult {
    const now = Date.now();
    if (strictModeCache && now - strictModeCache.readAt < STRICT_CACHE_TTL_MS) {
      return strictModeCache.result;
    }
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) {
      const result: StrictReadResult = { kind: "missing" };
      strictModeCache = { result, readAt: now };
      return result;
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(resolved, "utf-8"));
      if (!raw || typeof raw !== "object") {
        const result: StrictReadResult = {
          kind: "degraded",
          code: "STRICT_MODE_SCHEMA_INVALID",
        };
        emitStrictDiagnostic(result.code, "strict-mode state root is not an object");
        strictModeCache = { result, readAt: now };
        return result;
      }
      const obj = raw as Record<string, unknown>;
      if (obj.version !== 1 || typeof obj.sessions !== "object" || obj.sessions === null) {
        const result: StrictReadResult = {
          kind: "degraded",
          code: "STRICT_MODE_SCHEMA_INVALID",
        };
        emitStrictDiagnostic(
          result.code,
          "strict-mode state failed versioned schema validation",
        );
        strictModeCache = { result, readAt: now };
        return result;
      }
      const sessions: Record<string, StrictSessionEntry> = {};
      for (const [key, entry] of Object.entries(
        obj.sessions as Record<string, unknown>,
      )) {
        if (!isValidStrictEntry(entry)) {
          const result: StrictReadResult = {
            kind: "degraded",
            code: "STRICT_MODE_SCHEMA_INVALID",
          };
          emitStrictDiagnostic(
            result.code,
            "strict-mode session entry failed schema validation",
          );
          strictModeCache = { result, readAt: now };
          return result;
        }
        sessions[key] = entry;
      }
      const state: StrictModeState = { version: 1, sessions };
      const result: StrictReadResult = { kind: "ok", state };
      strictModeCache = { result, readAt: now };
      return result;
    } catch {
      const result: StrictReadResult = {
        kind: "degraded",
        code: "STRICT_MODE_MALFORMED",
      };
      emitStrictDiagnostic(
        result.code,
        "strict-mode state file is not valid JSON; applying conservative fallback",
      );
      strictModeCache = { result, readAt: now };
      return result;
    }
  }

  function getStrictApprovalOverrides(
    filePath: string,
    sessionKey: string | undefined,
  ): string[] {
    if (!sessionKey) return [];
    const result = readStrictModeState(filePath);
    if (result.kind === "missing") return [];
    if (result.kind === "degraded") {
      return [...CONSERVATIVE_STRICT_APPROVAL_ON];
    }
    const entry = result.state.sessions[sessionKey];
    if (!entry || !entry.strict) return [];
    if (new Date(entry.expiresAt).getTime() < Date.now()) return [];
    return entry.addedApprovalOn ?? [];
  }

  function tryAppend(
    logPath: string,
    event: EnforcementEvent,
    outcome: EnforcementOutcome,
  ): { ok: true } | { ok: false; error: Error } {
    try {
      appendEnforcementEntry(logPath, event, outcome);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err as Error };
    }
  }

  function handleAuditFailure(
    decision: "block" | "approval" | "allow",
    error: Error,
  ): FppBeforeToolCallResult | null {
    const highRisk = decision === "block" || decision === "approval";
    if (config.auditFailureBehavior === "fail-closed" || highRisk) {
      return {
        action: "block",
        blockReason: `audit failure (fail-closed): ${error.message}`,
      };
    }
    emitAuditGap(
      `proceeding under degraded-allow-low-risk despite audit write failure: ${error.message}`,
    );
    return null;
  }

  async function onBeforeToolCall(
    event: FppToolCallEvent,
    ctx: FppToolCallContext,
  ): Promise<FppBeforeToolCallResult> {
    const store = getReceiptStore();
    const classification = classifyToolCall(event.toolName, event.params ?? {}, {
      knownCustomTools: config.knownCustomTools,
    });
    const strictOverrides = config.respectTrustStrictMode
      ? getStrictApprovalOverrides(config.strictModeStatePath, ctx.sessionKey)
      : [];
    const mandates = getMandateStore();
    let liveMandate = mandates.findCoverage(classification.classification, {
      nowMs: Date.now(),
    });

    const workspaceRoot = adapter.getWorkspacePaths().workspaceRoot;
    let stewardEvidence: StewardCoverageEvidence | null = null;
    let stewardAction = lookupStewardOperatorCoverage({
      ledgerPath: config.stewardAuthorizationLedgerPath,
      event: { toolName: event.toolName, params: event.params },
      classification: classification.classification,
      workspaceRoot,
      knownCustomTools: config.knownCustomTools,
    });
    if (!liveMandate && stewardAction.liveMandate) {
      liveMandate = stewardAction.liveMandate;
      stewardEvidence = stewardAction.evidence;
    }

    let emergencyCriteriaMet = false;
    let emergencyOverrideRejected: string | undefined;
    let emergencyOverrideId: string | undefined;
    const localPublicKeyHex =
      loadLocalPublicKeyHex(config.identityKeyPath) ??
      (() => {
        const signer = getReceiptSigner();
        return signer.mode === "signed" ? signer.publicKeyHex : undefined;
      })();
    if (localPublicKeyHex) {
      const emergencyCoverage = getEmergencyOverrideStore().findCoverage(
        classification.classification,
        {
          nowMs: Date.now(),
          localPublicKeyHex,
        },
      );
      if (emergencyCoverage.ok) {
        emergencyCriteriaMet = true;
        emergencyOverrideId = emergencyCoverage.overrideId;
      } else if (emergencyCoverage.reason !== "none") {
        emergencyOverrideRejected = emergencyCoverage.reason;
      }
    }

    let dispositionResult = resolveDisposition({
      classification,
      config,
      liveMandate,
      budgetAvailable: true,
      reversible: isReversibleClassification(classification.classification),
      quorumMandatePresent: liveMandate?.authorization === "quorum-mandate",
      emergencyCriteriaMet,
      emergencyOverrideRejected,
      strictOverrides,
    });

    // Operator steward grants must be atomically consumed before allow.
    if (
      dispositionResult.disposition === "allow" &&
      isOperatorMandateId(dispositionResult.mandateId)
    ) {
      const authId = operatorAuthorizationIdFromMandateId(
        dispositionResult.mandateId!,
      );
      const consumed = consumeStewardOperatorCoverage({
        ledgerPath: config.stewardAuthorizationLedgerPath,
        authorizationId: authId,
        action: stewardAction.action,
      });
      if (!consumed.ok) {
        // Fail closed on this coverage — recompute without operator grant.
        liveMandate = mandates.findCoverage(classification.classification, {
          nowMs: Date.now(),
        });
        stewardEvidence = null;
        dispositionResult = resolveDisposition({
          classification,
          config,
          liveMandate,
          budgetAvailable: true,
          reversible: isReversibleClassification(classification.classification),
          quorumMandatePresent: liveMandate?.authorization === "quorum-mandate",
          emergencyCriteriaMet,
          emergencyOverrideRejected,
          strictOverrides,
        });
      } else {
        stewardEvidence = {
          stewardId: consumed.stewardId,
          authorizationId: consumed.authorizationId,
          signingKeyRef: consumed.signingKeyRef,
          stewardLedgerEventHash: consumed.eventHash,
        };
      }
    }

    const decision = legacyDecisionFromDisposition(
      dispositionResult.disposition,
    );

    if (
      dispositionResult.disposition === "allow" &&
      dispositionResult.mandateId &&
      !dispositionResult.mandateId.startsWith("standing:") &&
      !isOperatorMandateId(dispositionResult.mandateId)
    ) {
      mandates.debit(dispositionResult.mandateId);
    }

    const eventForAudit: EnforcementEvent = {
      toolName: event.toolName,
      agentId: ctx.agentId,
      runId: ctx.runId ?? event.runId,
      sessionKey: ctx.sessionKey,
      toolCallId: ctx.toolCallId ?? event.toolCallId,
      classification: classification.classification,
      decision,
      reason: dispositionResult.reason || classification.reason,
      constitutionHash: config.constitutionHash,
      ...(stewardEvidence
        ? {
            stewardId: stewardEvidence.stewardId,
            authorizationId: stewardEvidence.authorizationId,
            signingKeyRef: stewardEvidence.signingKeyRef,
            stewardLedgerEventHash: stewardEvidence.stewardLedgerEventHash,
          }
        : {}),
    };

    const toolCallId = ctx.toolCallId ?? event.toolCallId;
    const proposeResult = store.propose({
      toolCallId,
      toolName: event.toolName,
      paramsDigest: digestActionParams(event.params ?? {}),
      classification: classification.classification,
      decision,
      disposition: dispositionResult.disposition,
      authorization:
        dispositionResult.disposition === "allow" &&
        dispositionResult.authorization === "approved"
          ? undefined
          : dispositionResult.authorization,
      agentId: ctx.agentId,
      runId: ctx.runId ?? event.runId,
      sessionKey: ctx.sessionKey,
      nowIso: new Date().toISOString(),
    });
    const receipt: PendingReceiptRecord = proposeResult.record;
    if (receipt.correlationConfidence === "reduced") {
      emitAuditGap(
        `tool call missing toolCallId; receipt ${receipt.receiptId} recorded with reduced correlation confidence`,
      );
    }
    for (const orphan of store.drainOrphans()) {
      emitAuditGap(
        `pending receipt overflow orphan ${orphan.receiptId} toolCallId=${orphan.toolCallId ?? "none"} outcome=${orphan.outcome}`,
      );
      persistFinalizedReceipt(orphan);
    }

    const titleFn = options.approvalTitle ?? defaultTitle;
    const descFn = options.approvalDescription ?? defaultDescription;

    if (decision === "block") {
      const appended = tryAppend(config.auditLogPath, eventForAudit, "blocked");
      if (!appended.ok) {
        const failure = handleAuditFailure(decision, appended.error);
        if (failure) return failure;
      }
      if (proposeResult.finalized && !proposeResult.idempotent) {
        if (dispositionResult.disposition === "abstain") {
          receipt.authorization = "abstain";
        }
        persistFinalizedReceipt(receipt);
      }
      if (dispositionResult.disposition === "abstain") {
        return { action: "block", blockReason: `abstain: ${dispositionResult.reason}` };
      }
      return {
        action: "block",
        blockReason: `${classification.classification}: ${classification.reason}`,
      };
    }

    if (decision === "approval") {
      // Core never invokes adapter.requestApproval — operator-present adapters
      // surface require_approval to their harness UI.
      void adapter.requestApproval;
      const appended = tryAppend(
        config.auditLogPath,
        eventForAudit,
        "approval_requested",
      );
      if (!appended.ok) {
        const failure = handleAuditFailure(decision, appended.error);
        if (failure) return failure;
      }
      return {
        action: "require_approval",
        title: titleFn(classification),
        description: descFn(classification, event.toolName),
        severity: severityFor(classification),
        timeoutMs: config.approvalTimeoutMs,
        timeoutBehavior: config.approvalTimeoutBehavior,
        onResolution: async (decisionResult: FppApprovalDecision) => {
          const outcome: EnforcementOutcome =
            decisionResult === "allow-once" || decisionResult === "allow-always"
              ? "approved"
              : decisionResult === "deny"
                ? "denied"
                : decisionResult === "timeout"
                  ? "timeout"
                  : "cancelled";
          if (toolCallId) {
            const updated = store.recordAuthorization(
              toolCallId,
              outcome,
              new Date().toISOString(),
            );
            if (updated && updated.status === "finalized") {
              persistFinalizedReceipt(updated);
            }
          }
          const logged = tryAppend(config.auditLogPath, eventForAudit, outcome);
          if (!logged.ok) {
            emitAuditGap(
              `post-approval outcome logging failed (${outcome}): ${logged.error.message}. ` +
                `Preserve the existing audit file; do not overwrite or restart the chain. ` +
                `See docs/TROUBLESHOOTING.md.`,
            );
          }
        },
      };
    }

    const allowedAppend = tryAppend(
      config.auditLogPath,
      eventForAudit,
      "allowed",
    );
    if (!allowedAppend.ok) {
      const failure = handleAuditFailure(decision, allowedAppend.error);
      if (failure) return failure;
    }

    if (dispositionResult.disposition === "allow_staged" && toolCallId) {
      getStagedLedger().register({
        toolCallId,
        classification: classification.classification,
        actionDigest: receipt.actionDigest,
        undoWindowMs: config.stagedUndoWindowMs,
        nowMs: Date.now(),
      });
    }
    if (dispositionResult.disposition === "allow_minimal" && toolCallId) {
      if (emergencyOverrideId) {
        getEmergencyOverrideStore().debit(emergencyOverrideId);
      }
      getEmergencyLedger().requireReview({
        toolCallId,
        classification: classification.classification,
        actionDigest: receipt.actionDigest,
        reason: dispositionResult.reason,
        nowIso: new Date().toISOString(),
      });
    }

    return { action: "allow", disposition: dispositionResult };
  }

  function digestExecutionOutcome(input: {
    error?: string | undefined;
    durationMs?: number | undefined;
    hasResult: boolean;
  }): string {
    return digest({
      version: 2,
      domain: DIGEST_DOMAINS.receipt,
      value: {
        kind: "execution-outcome",
        hasResult: input.hasResult,
        errorPresent: Boolean(input.error),
        errorDigest: input.error
          ? digest({
              version: 2,
              domain: DIGEST_DOMAINS.receipt,
              value: { kind: "error-text", text: input.error.slice(0, 280) },
            })
          : null,
        durationMs:
          typeof input.durationMs === "number" ? input.durationMs : null,
      },
    });
  }

  async function onAfterToolCall(
    event: FppToolCallEvent,
    ctx: FppToolCallContext,
  ): Promise<void> {
    const store = getReceiptStore();
    const toolCallId = ctx.toolCallId ?? event.toolCallId;
    if (!toolCallId) {
      emitAuditGap(
        `after_tool_call missing toolCallId for tool=${event.toolName}; cannot correlate execution outcome`,
      );
      return;
    }

    const outcomeDigest = digestExecutionOutcome({
      error: event.error,
      durationMs: event.durationMs,
      hasResult: event.result !== undefined,
    });
    const outcome = event.error
      ? `error:${outcomeDigest.slice(0, 16)}`
      : `executed:${outcomeDigest.slice(0, 16)}`;

    try {
      const finalized = store.finalizeExecution(
        toolCallId,
        outcome,
        new Date().toISOString(),
      );
      if (!finalized) {
        emitAuditGap(
          `after_tool_call for ${toolCallId} has no pending receipt (duplicate or missing before-hook)`,
        );
        return;
      }
      if (finalized.idempotent) {
        return;
      }
      if (!finalized.authorization || finalized.authorization === "unresolved") {
        finalized.authorization =
          finalized.disposition === "allow" ||
          finalized.disposition === "allow_staged" ||
          finalized.disposition === "allow_minimal"
            ? finalized.disposition === "allow_minimal"
              ? "emergency"
              : finalized.disposition === "allow_staged"
                ? "mandate"
                : "policy-match"
            : "approved";
      }
      persistFinalizedReceipt(finalized);
    } catch (err) {
      emitAuditGap(
        `after_tool_call handler failed for ${toolCallId}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  function reconcileOrphanedReceipts(
    nowIso = new Date().toISOString(),
  ): PendingReceiptRecord[] {
    const store = getReceiptStore();
    const expired = store.sweepExpired(nowIso);
    const abandoned = store.orphanAllPending(nowIso, "audit_gap_orphan");
    store.drainOrphans();
    const orphans = [...expired, ...abandoned];
    for (const orphan of orphans) {
      emitAuditGap(
        `unreconciled receipt ${orphan.receiptId} toolCallId=${orphan.toolCallId ?? "none"} outcome=${orphan.outcome}`,
      );
      persistFinalizedReceipt(orphan);
    }
    return orphans;
  }

  return {
    adapter,
    getConfig: () => config,
    onBeforeToolCall,
    onAfterToolCall,
    reset() {
      receiptStore = null;
      receiptSigner = null;
      mandateStore = null;
      emergencyOverrideStore = null;
      stagedLedger = null;
      emergencyLedger = null;
      strictModeCache = null;
    },
    getReceiptStore,
    reconcileOrphanedReceipts,
  };
}
