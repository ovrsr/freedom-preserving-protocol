/**
 * index.ts
 *
 * Plugin entry. Registers a `before_tool_call` hook that:
 *   1. Classifies the tool call against a risk taxonomy (see risk-classifier.ts).
 *   2. Looks the classification up in this plugin's config to decide:
 *      block, requireApproval, or allow.
 *   3. Writes a hash-chained audit entry to the dispatcher-layer audit log.
 *
 * Types come from `openclaw/plugin-sdk/plugin-entry`. The hook signature is
 * `(event, ctx) => result`; the plugin's resolved config lives on `api.pluginConfig`
 * (not on event.context — the older docs were out of date).
 *
 * Constitutional rationale:
 *   - Law 1 (consent): requireApproval surfaces the action to the user before it runs.
 *   - Law 2 (corrigibility): every decision is logged with reason and tool metadata.
 *   - Law 3 (reversibility): the hook can block irreversible actions in advance.
 *   - Law 5 (scoped exploration): unknown tools require approval by default;
 *     operators may allowlist known custom tools explicitly.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi, OpenClawPluginDefinition } from "openclaw/plugin-sdk/plugin-entry";

import { classifyToolCall, type ClassificationResult } from "./risk-classifier.js";
import {
  mergeConfig,
  CONSERVATIVE_STRICT_APPROVAL_ON,
  type FppPluginConfig,
} from "./config.js";
import {
  appendEnforcementEntry,
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
import { DIGEST_DOMAINS, digest } from "@ovrsr/fpp-protocol-core";
import { buildRuntimeManifest } from "./runtime-manifest.js";
import {
  resolveDisposition,
  type DispositionResult,
} from "./disposition-engine.js";
import { MandateStore } from "./mandate-store.js";
import { isReversibleClassification } from "./reversibility.js";
import type { DispositionDecision } from "@ovrsr/fpp-protocol-core";
import { StagedActionLedger } from "./staged-actions.js";
import { EmergencyReviewLedger } from "./emergency-review.js";

/** Process-local receipt correlation store (resettable in tests). */
let receiptStore: ReceiptStore | null = null;
let receiptSigner: ReceiptSigner | null = null;
let mandateStore: MandateStore | null = null;
let stagedLedger: StagedActionLedger | null = null;
let emergencyLedger: EmergencyReviewLedger | null = null;

function getReceiptStore(config: FppPluginConfig): ReceiptStore {
  if (!receiptStore) {
    receiptStore = new ReceiptStore({
      maxPending: config.receiptMaxPending,
      pendingTtlMs: config.receiptPendingTtlMs,
    });
  }
  return receiptStore;
}

function getReceiptSigner(config: FppPluginConfig): ReceiptSigner {
  if (!receiptSigner) {
    receiptSigner = loadReceiptSigner({
      keyPath: config.identityKeyPath,
      enabled: config.receiptSigningEnabled,
    });
  }
  return receiptSigner;
}

/** Test seam: reset receipt store between tests. */
export function resetReceiptStore(): void {
  receiptStore = null;
  receiptSigner = null;
  mandateStore = null;
  stagedLedger = null;
  emergencyLedger = null;
}

function getMandateStore(config: FppPluginConfig): MandateStore {
  if (!mandateStore) {
    mandateStore = new MandateStore(config.mandateStorePath, {
      standingAllowOn: config.standingAllowOn,
      mandateDefaultMaxActions: config.mandateDefaultMaxActions,
    });
  }
  return mandateStore;
}

function workspaceSibling(configPath: string, filename: string): string {
  return join(dirname(configPath), filename);
}

function getStagedLedger(config: FppPluginConfig): StagedActionLedger {
  if (!stagedLedger) {
    stagedLedger = new StagedActionLedger(
      workspaceSibling(config.mandateStorePath, "fpp-staged-actions.jsonl"),
    );
  }
  return stagedLedger;
}

function getEmergencyLedger(config: FppPluginConfig): EmergencyReviewLedger {
  if (!emergencyLedger) {
    emergencyLedger = new EmergencyReviewLedger(
      workspaceSibling(config.mandateStorePath, "fpp-emergency-review.jsonl"),
    );
  }
  return emergencyLedger;
}

/** Test seam: inspect the active receipt store. */
export function getActiveReceiptStore(): ReceiptStore | null {
  return receiptStore;
}

/** Test seam: inspect the active receipt signer. */
export function getActiveReceiptSigner(): ReceiptSigner | null {
  return receiptSigner;
}

/**
 * Build and sign a conformance receipt from a finalized lifecycle record.
 * Unsigned-degraded when signing is disabled.
 */
export function buildSignedReceiptFromRecord(
  record: PendingReceiptRecord,
  config: FppPluginConfig,
  signer: ReceiptSigner,
): SignedReceipt {
  const runtime = buildRuntimeManifest({
    config,
    constitutionHash: config.constitutionHash,
    degraded: false,
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
  return signReceiptPayload(payload, signer);
}

/** Digest minimized result/error metadata — never copies raw tool output. */
export function digestExecutionOutcome(input: {
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

function persistFinalizedReceipt(
  config: FppPluginConfig,
  record: PendingReceiptRecord,
): void {
  try {
    const signer = getReceiptSigner(config);
    const signed = buildSignedReceiptFromRecord(record, config, signer);
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

/**
 * Mark unreconciled pending receipts as orphans (startup/shutdown).
 * Emits audit-gap diagnostics and persists gap receipts when possible.
 */
export function reconcileOrphanedReceipts(
  config: FppPluginConfig,
  nowIso = new Date().toISOString(),
): PendingReceiptRecord[] {
  const store = getReceiptStore(config);
  const expired = store.sweepExpired(nowIso);
  const abandoned = store.orphanAllPending(nowIso, "audit_gap_orphan");
  // orphanAllPending / sweepExpired already push into the internal orphan buffer;
  // drain once so callers see each gap exactly once.
  store.drainOrphans();
  const orphans = [...expired, ...abandoned];
  for (const orphan of orphans) {
    emitAuditGap(
      `unreconciled receipt ${orphan.receiptId} toolCallId=${orphan.toolCallId ?? "none"} outcome=${orphan.outcome}`,
    );
    persistFinalizedReceipt(config, orphan);
  }
  return orphans;
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

let strictModeCache: { result: StrictReadResult; readAt: number } | null = null;
const STRICT_CACHE_TTL_MS = 1000;

function emitStrictDiagnostic(
  code: "STRICT_MODE_MALFORMED" | "STRICT_MODE_SCHEMA_INVALID",
  detail: string,
): void {
  // Structured diagnostic — never include session keys or reason text.
  console.error(`FPP ${code}: ${detail}`);
}

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
    // Malformed state must not silently disable configured protection.
    return [...CONSERVATIVE_STRICT_APPROVAL_ON];
  }
  const entry = result.state.sessions[sessionKey];
  if (!entry || !entry.strict) return [];
  if (new Date(entry.expiresAt).getTime() < Date.now()) return [];
  return entry.addedApprovalOn ?? [];
}

/** Test seam: reset the strict-mode read cache between tests. */
export function resetStrictModeCache(): void {
  strictModeCache = null;
}

function severityFor(classification: ClassificationResult): "info" | "warning" | "critical" {
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

/**
 * Map disposition engine output to the legacy decide() vocabulary used by
 * audit events and the receipt store until Task 6 extends those surfaces.
 */
export function legacyDecisionFromDisposition(
  disposition: DispositionDecision,
): "block" | "approval" | "allow" {
  if (disposition === "deny" || disposition === "abstain") return "block";
  if (disposition === "require_approval") return "approval";
  return "allow";
}

/**
 * @deprecated Prefer resolveDisposition. Kept as a thin wrapper for callers
 * that still expect block | approval | allow.
 */
function decide(
  config: FppPluginConfig,
  classification: ClassificationResult,
  strictOverrides: string[] = [],
): "block" | "approval" | "allow" {
  const result = resolveDisposition({
    classification,
    config,
    strictOverrides,
    reversible: isReversibleClassification(classification.classification),
  });
  return legacyDecisionFromDisposition(result.disposition);
}

/** Test seam: decision helper used by the before_tool_call hook. */
export { decide };

function mapDispositionToHookResult(
  dispositionResult: DispositionResult,
  classification: ClassificationResult,
  toolName: string,
  config: FppPluginConfig,
  eventForAudit: EnforcementEvent,
  onApprovalResolution: (decisionResult: string) => Promise<void>,
):
  | { block: true; blockReason: string }
  | {
      requireApproval: {
        title: string;
        description: string;
        severity: "critical" | "warning" | "info";
        timeoutMs: number;
        timeoutBehavior: "allow" | "deny";
        allowedDecisions: ("allow-once" | "deny")[];
        pluginId: string;
        onResolution: (decisionResult: string) => Promise<void>;
      };
    }
  | undefined {
  const { disposition, authorization, reason } = dispositionResult;

  if (disposition === "deny") {
    return {
      block: true,
      blockReason: `${classification.classification}: ${classification.reason}`,
    };
  }

  if (disposition === "abstain") {
    return {
      block: true,
      blockReason: `abstain: ${reason}`,
    };
  }

  if (disposition === "require_approval") {
    return {
      requireApproval: {
        title: buildTitle(classification),
        description: buildDescription(classification, toolName),
        severity: severityFor(classification),
        timeoutMs: config.approvalTimeoutMs,
        timeoutBehavior: config.approvalTimeoutBehavior,
        allowedDecisions: ["allow-once", "deny"],
        pluginId: "openclaw-fpp-plugin",
        onResolution: onApprovalResolution,
      },
    };
  }

  // allow | allow_staged | allow_minimal → proceed (no approval)
  void authorization;
  void eventForAudit;
  return undefined;
}

function emitAuditGap(message: string): void {
  console.error(`FPP AUDIT-GAP: ${message}`);
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

/**
 * When audit persistence fails: fail-closed for high-risk / approval paths.
 * degraded-allow-low-risk may proceed only for classifier-allow decisions.
 */
function handleAuditFailure(
  config: FppPluginConfig,
  decision: "block" | "approval" | "allow",
  error: Error,
): { block: true; blockReason: string } | undefined {
  const highRisk = decision === "block" || decision === "approval";
  if (config.auditFailureBehavior === "fail-closed" || highRisk) {
    return {
      block: true,
      blockReason: `audit failure (fail-closed): ${error.message}`,
    };
  }
  emitAuditGap(
    `proceeding under degraded-allow-low-risk despite audit write failure: ${error.message}`,
  );
  return undefined;
}

/**
 * Test seam: register the enforcement hook against any api-like object.
 * Production entry calls this from definePluginEntry.register.
 */
export function registerEnforcement(api: {
  pluginConfig?: unknown;
  on: (
    event: string,
    handler: (...args: unknown[]) => unknown,
    opts?: { priority?: number },
  ) => void;
}): FppPluginConfig {
  const config = mergeConfig(api.pluginConfig);
  const store = getReceiptStore(config);
  api.on(
    "before_tool_call",
    async (event: unknown, ctx: unknown) => {
      const e = event as {
        toolName: string;
        params?: Record<string, unknown>;
        runId?: string;
      };
      const c = ctx as {
        agentId?: string;
        runId?: string;
        sessionKey?: string;
        toolCallId?: string;
      };
      const classification = classifyToolCall(e.toolName, e.params ?? {}, {
        knownCustomTools: config.knownCustomTools,
      });
      const strictOverrides = config.respectTrustStrictMode
        ? getStrictApprovalOverrides(config.strictModeStatePath, c.sessionKey)
        : [];
      const mandates = getMandateStore(config);
      const liveMandate = mandates.findCoverage(classification.classification, {
        nowMs: Date.now(),
      });
      const dispositionResult = resolveDisposition({
        classification,
        config,
        liveMandate,
        budgetAvailable: true,
        reversible: isReversibleClassification(classification.classification),
        quorumMandatePresent:
          liveMandate?.authorization === "quorum-mandate",
        strictOverrides,
      });
      const decision = legacyDecisionFromDisposition(
        dispositionResult.disposition,
      );

      // Debit mandate budget on allow paths that consumed a stored mandate.
      if (
        dispositionResult.disposition === "allow" &&
        dispositionResult.mandateId &&
        !dispositionResult.mandateId.startsWith("standing:")
      ) {
        mandates.debit(dispositionResult.mandateId);
      }

      const eventForAudit: EnforcementEvent = {
        toolName: e.toolName,
        agentId: c.agentId,
        runId: c.runId ?? e.runId,
        sessionKey: c.sessionKey,
        toolCallId: c.toolCallId,
        classification: classification.classification,
        decision,
        reason: dispositionResult.reason || classification.reason,
        constitutionHash: config.constitutionHash,
      };

      const proposeResult = store.propose({
        toolCallId: c.toolCallId,
        toolName: e.toolName,
        paramsDigest: digestActionParams(e.params ?? {}),
        classification: classification.classification,
        decision,
        disposition: dispositionResult.disposition,
        // Leave classifier-allow authorization unset so after_tool_call can
        // record policy-match; keep explicit classes (mandate, abstain, etc.).
        authorization:
          dispositionResult.disposition === "allow" &&
          dispositionResult.authorization === "approved"
            ? undefined
            : dispositionResult.authorization,
        agentId: c.agentId,
        runId: c.runId ?? e.runId,
        sessionKey: c.sessionKey,
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
        persistFinalizedReceipt(config, orphan);
      }

      if (decision === "block") {
        const outcome =
          dispositionResult.disposition === "abstain" ? "blocked" : "blocked";
        const appended = tryAppend(config.auditLogPath, eventForAudit, outcome);
        if (!appended.ok) {
          const failure = handleAuditFailure(config, decision, appended.error);
          if (failure) return failure;
        }
        if (proposeResult.finalized && !proposeResult.idempotent) {
          // Prefer abstain authorization on the receipt when applicable (Task 6).
          if (dispositionResult.disposition === "abstain") {
            receipt.authorization = "abstain";
          }
          persistFinalizedReceipt(config, receipt);
        }
        return mapDispositionToHookResult(
          dispositionResult,
          classification,
          e.toolName,
          config,
          eventForAudit,
          async () => undefined,
        );
      }

      if (decision === "approval") {
        const appended = tryAppend(
          config.auditLogPath,
          eventForAudit,
          "approval_requested",
        );
        if (!appended.ok) {
          const failure = handleAuditFailure(config, decision, appended.error);
          if (failure) return failure;
        }
        return mapDispositionToHookResult(
          dispositionResult,
          classification,
          e.toolName,
          config,
          eventForAudit,
          async (decisionResult: string) => {
            const outcome: EnforcementOutcome =
              decisionResult === "allow-once" || decisionResult === "allow-always"
                ? "approved"
                : decisionResult === "deny"
                  ? "denied"
                  : decisionResult === "timeout"
                    ? "timeout"
                    : "cancelled";
            if (c.toolCallId) {
              const updated = store.recordAuthorization(
                c.toolCallId,
                outcome,
                new Date().toISOString(),
              );
              if (updated && updated.status === "finalized") {
                persistFinalizedReceipt(config, updated);
              }
            }
            const logged = tryAppend(
              config.auditLogPath,
              eventForAudit,
              outcome,
            );
            if (!logged.ok) {
              emitAuditGap(
                `post-approval outcome logging failed (${outcome}): ${logged.error.message}. ` +
                  `Preserve the existing audit file; do not overwrite or restart the chain. ` +
                  `See docs/TROUBLESHOOTING.md.`,
              );
            }
          },
        );
      }

      const allowedAppend = tryAppend(
        config.auditLogPath,
        eventForAudit,
        "allowed",
      );
      if (!allowedAppend.ok) {
        const failure = handleAuditFailure(
          config,
          decision,
          allowedAppend.error,
        );
        if (failure) return failure;
      }

      if (
        dispositionResult.disposition === "allow_staged" &&
        c.toolCallId
      ) {
        getStagedLedger(config).register({
          toolCallId: c.toolCallId,
          classification: classification.classification,
          actionDigest: receipt.actionDigest,
          undoWindowMs: config.stagedUndoWindowMs,
          nowMs: Date.now(),
        });
      }
      if (
        dispositionResult.disposition === "allow_minimal" &&
        c.toolCallId
      ) {
        getEmergencyLedger(config).requireReview({
          toolCallId: c.toolCallId,
          classification: classification.classification,
          actionDigest: receipt.actionDigest,
          reason: dispositionResult.reason,
          nowIso: new Date().toISOString(),
        });
      }
      return;
    },
    { priority: 50 },
  );

  api.on(
    "after_tool_call",
    async (event: unknown, ctx: unknown) => {
      const e = event as {
        toolName: string;
        params?: Record<string, unknown>;
        runId?: string;
        toolCallId?: string;
        result?: unknown;
        error?: string;
        durationMs?: number;
      };
      const c = ctx as {
        agentId?: string;
        runId?: string;
        sessionKey?: string;
        toolCallId?: string;
      };
      const toolCallId = c.toolCallId ?? e.toolCallId;
      if (!toolCallId) {
        emitAuditGap(
          `after_tool_call missing toolCallId for tool=${e.toolName}; cannot correlate execution outcome`,
        );
        return;
      }

      const outcomeDigest = digestExecutionOutcome({
        error: e.error,
        durationMs: e.durationMs,
        hasResult: e.result !== undefined,
      });
      const outcome = e.error ? `error:${outcomeDigest.slice(0, 16)}` : `executed:${outcomeDigest.slice(0, 16)}`;

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
        // Ensure authorization is recorded separately from execution success.
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
        persistFinalizedReceipt(config, finalized);
      } catch (err) {
        // Callback errors must not silently erase evidence — emit gap and rethrow.
        emitAuditGap(
          `after_tool_call handler failed for ${toolCallId}: ${(err as Error).message}`,
        );
        throw err;
      }
    },
    { priority: 50 },
  );

  return config;
}

export const PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH = 256;
export const PLUGIN_APPROVAL_TITLE_MAX_LENGTH = 80;

export function buildDescription(
  classification: ClassificationResult,
  toolName: string,
): string {
  const body = `${classification.classification}: ${classification.reason} [${toolName}]`;
  if (body.length <= PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH) return body;
  return body.slice(0, PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH - 3) + "...";
}

export function buildTitle(classification: ClassificationResult): string {
  const title = `FPP gate: ${classification.classification}`;
  if (title.length <= PLUGIN_APPROVAL_TITLE_MAX_LENGTH) return title;
  return title.slice(0, PLUGIN_APPROVAL_TITLE_MAX_LENGTH - 3) + "...";
}

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "openclaw-fpp-plugin",
  name: "Freedom Preserving Protocol — Enforcement",
  description:
    "Gates tool calls through the five Freedom Preserving Laws via a before_tool_call hook.",
  register(api: OpenClawPluginApi) {
    registerEnforcement(api as Parameters<typeof registerEnforcement>[0]);
  },
});

export default plugin;
