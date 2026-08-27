/**
 * Non-default gateway-shaped reference stub for CI demos.
 *
 * NOT a production gateway. NOT an OpenClaw plugin. Opt-in via `enabled: true`.
 * Demonstrates tool-router → enforcement-core disposition before invoke, plus
 * bounded governance transitions (enabled → draining → disabled).
 */

import type {
  EnforcementRuntime,
  FppToolCallContext,
} from "@ovrsr/fpp-enforcement-core";
import type {
  GovernanceMode,
  GovernanceStateV1,
} from "@ovrsr/fpp-protocol-core";
import type { GovernanceLedger } from "./governance-ledger.js";

export type GatewayInvoke = (
  toolName: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export type GatewayRouteContext = {
  toolCallId: string;
  agentId?: string | undefined;
  runId?: string | undefined;
  sessionKey?: string | undefined;
};

export class GatewayReferenceDisabledError extends Error {
  constructor(
    message = "gateway-reference is disabled (set enabled: true for CI demos only)",
  ) {
    super(message);
    this.name = "GatewayReferenceDisabledError";
  }
}

export class GatewayReferenceDeniedError extends Error {
  readonly blockReason: string;
  constructor(blockReason: string) {
    super(blockReason);
    this.name = "GatewayReferenceDeniedError";
    this.blockReason = blockReason;
  }
}

/** New governed admissions rejected while disable drain is in progress. */
export class GatewayReferenceDrainingError extends Error {
  constructor(
    message = "gateway governance is draining; new governed calls are not admitted",
  ) {
    super(message);
    this.name = "GatewayReferenceDrainingError";
  }
}

/** Captured epoch no longer matches published governance state at invoke. */
export class GatewayReferenceStaleEpochError extends Error {
  constructor(
    message = "gateway governance epoch changed before invoke; call aborted",
  ) {
    super(message);
    this.name = "GatewayReferenceStaleEpochError";
  }
}

/** A bounded disable attempt cannot publish disabled while work is executing. */
export class GatewayReferenceDrainIncompleteError extends Error {
  readonly invokingToolCallIds: readonly string[];

  constructor(invokingToolCallIds: readonly string[]) {
    super(
      `gateway governance drain deadline reached with invoking calls: ${invokingToolCallIds.join(", ")}`,
    );
    this.name = "GatewayReferenceDrainIncompleteError";
    this.invokingToolCallIds = invokingToolCallIds;
  }
}

/** A live toolCallId is already reserved by an in-flight route. */
export class GatewayReferenceDuplicateActiveCallError extends Error {
  readonly toolCallId: string;

  constructor(toolCallId: string) {
    super(
      `gateway-reference refuses duplicate live toolCallId while a route is active: ${toolCallId}`,
    );
    this.name = "GatewayReferenceDuplicateActiveCallError";
    this.toolCallId = toolCallId;
  }
}

export {
  GOVERNANCE_LEDGER_ZERO_HASH,
  GovernanceLedger,
  GovernanceLedgerUnavailableError,
  type AppendGovernanceEventInput,
  type AppendResult,
  type GovernanceEventSigner,
  type GovernanceEventVerifier,
  type GovernanceLedgerIoHooks,
  type GovernanceLedgerOptions,
  type LedgerStateErr,
  type LedgerStateOk,
} from "./governance-ledger.js";

export type GatewayWaitUntil = (
  deadlineMs: number,
) => Promise<"deadline" | "cancelled">;

export type GatewayReferenceOptions = {
  /** Package feature flag — default false. Must be explicitly true for demos. */
  enabled?: boolean | undefined;
  runtime: EnforcementRuntime;
  invoke: GatewayInvoke;
  /** Required for disable/enable transitions; optional for governed-only demos. */
  governanceLedger?: GovernanceLedger | undefined;
  /** Bounded drain deadline (ms). Default 1000. */
  drainTimeoutMs?: number | undefined;
  nowMs?: (() => number) | undefined;
  waitUntil?: GatewayWaitUntil | undefined;
  eventIdFactory?: (() => string) | undefined;
  actor?: { role: string; id: string } | undefined;
  /**
   * Test seam: awaited after disposition and immediately before the final
   * epoch check / downstream invoke.
   */
  beforeInvoke?:
    | ((ctx: {
        toolCallId: string;
        capturedEpoch: number;
        mode: GovernanceMode;
      }) => Promise<void>)
    | undefined;
};

export type GatewayReferenceRouter = {
  /** Package feature flag (CI opt-in). Distinct from runtime governance mode. */
  readonly enabled: boolean;
  getGovernanceState: () => GovernanceStateV1;
  disableGovernance: (opts?: {
    reason?: string | undefined;
  }) => Promise<GovernanceStateV1>;
  enableGovernance: (opts?: {
    reason?: string | undefined;
  }) => Promise<GovernanceStateV1>;
  route: (
    toolName: string,
    params: Record<string, unknown>,
    ctx: GatewayRouteContext,
  ) => Promise<unknown>;
};

type ActiveCall = {
  toolCallId: string;
  epoch: number;
  phase: "evaluating" | "ready" | "invoking";
  cancelled: boolean;
  /** Opaque ownership token so only the reserving route may release the slot. */
  ownershipToken: symbol;
};

/**
 * Fake in-process tool-router that consults enforcement-core before invoke.
 * Default `enabled: false` so this package cannot be mistaken for a live gateway.
 */
export function createGatewayReferenceRouter(
  options: GatewayReferenceOptions,
): GatewayReferenceRouter {
  const packageEnabled = options.enabled === true;
  const { runtime, invoke } = options;
  const drainTimeoutMs = options.drainTimeoutMs ?? 1_000;
  const nowMs = options.nowMs ?? (() => Date.now());
  const waitUntil: GatewayWaitUntil =
    options.waitUntil ??
    (async (deadlineMs) => {
      const remaining = deadlineMs - Date.now();
      if (remaining > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
      }
      return "deadline";
    });
  const eventIdFactory =
    options.eventIdFactory ??
    (() => {
      let n = 0;
      return () => `evt_gov_${Date.now()}_${++n}`;
    })();
  const actor = options.actor ?? { role: "operator", id: "op_local_host" };

  let mode: GovernanceMode = "enabled";
  let epoch = 0;
  if (options.governanceLedger) {
    const loaded = options.governanceLedger.getLastState();
    if (!loaded.ok) {
      throw loaded.error;
    }
    mode = loaded.state.mode;
    epoch = loaded.state.epoch;
  }

  const active = new Map<string, ActiveCall>();
  const pendingTransitionAbortIds = new Set<string>();
  let transitionLock: Promise<void> = Promise.resolve();
  const activityWaiters = new Set<() => void>();

  function getGovernanceState(): GovernanceStateV1 {
    return { schemaVersion: 1, mode, epoch };
  }

  function notifyActivityChanged(): void {
    if (activityWaiters.size === 0) return;
    const waiters = [...activityWaiters];
    activityWaiters.clear();
    for (const wake of waiters) wake();
  }

  function releaseActiveCall(
    toolCallId: string,
    ownershipToken: symbol,
  ): boolean {
    const current = active.get(toolCallId);
    if (!current || current.ownershipToken !== ownershipToken) {
      return false;
    }
    active.delete(toolCallId);
    notifyActivityChanged();
    return true;
  }

  function waitForIdleOrDeadline(
    deadlineMs: number,
  ): Promise<"deadline" | "idle"> {
    if (active.size === 0) return Promise.resolve("idle");
    if (nowMs() >= deadlineMs) return Promise.resolve("deadline");

    return new Promise<"deadline" | "idle">((resolve) => {
      let settled = false;
      const settle = (reason: "deadline" | "idle") => {
        if (settled) return;
        settled = true;
        activityWaiters.delete(onActivity);
        resolve(reason);
      };
      const onActivity = () => {
        if (active.size === 0) settle("idle");
      };
      activityWaiters.add(onActivity);
      void waitUntil(deadlineMs).then((reason) => {
        if (active.size === 0) {
          settle("idle");
          return;
        }
        if (reason === "deadline" || nowMs() >= deadlineMs) {
          settle("deadline");
        }
      });
    });
  }

  function withTransitionLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = transitionLock.then(fn, fn);
    transitionLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function disableGovernance(opts?: {
    reason?: string | undefined;
  }): Promise<GovernanceStateV1> {
    return withTransitionLock(async () => {
      if (mode === "disabled") {
        return getGovernanceState();
      }
      if (!options.governanceLedger) {
        throw new Error(
          "governanceLedger is required to disable gateway governance",
        );
      }

      const drainEpoch = epoch;
      mode = "draining";

      const deadline = nowMs() + drainTimeoutMs;
      while (active.size > 0 && nowMs() < deadline) {
        const wake = await waitForIdleOrDeadline(deadline);
        if (wake === "idle" || active.size === 0 || nowMs() >= deadline) break;
      }

      const abortable = [...active.values()].filter(
        (call) =>
          call.epoch === drainEpoch &&
          (call.phase === "evaluating" || call.phase === "ready"),
      );
      for (const call of abortable) {
        // The call object remains visible to its route continuation even after
        // active tracking is released, so a failed disable cannot revive it.
        call.cancelled = true;
        active.delete(call.toolCallId);
        pendingTransitionAbortIds.add(call.toolCallId);
      }

      // Explicit transition-abort only for pre-invoke leftovers from this epoch.
      try {
        runtime.reconcileTransitionAbortedReceipts({
          governanceEpoch: drainEpoch,
          eligibleToolCallIds: pendingTransitionAbortIds,
          nowIso: new Date(nowMs()).toISOString(),
        });
        pendingTransitionAbortIds.clear();
      } catch (err) {
        mode = "enabled";
        epoch = drainEpoch;
        throw err instanceof Error
          ? err
          : new Error(`receipt reconciliation failed: ${String(err)}`);
      }

      const invoking = [...active.values()].filter(
        (call) => call.epoch === drainEpoch && call.phase === "invoking",
      );
      if (invoking.length > 0) {
        mode = "enabled";
        epoch = drainEpoch;
        throw new GatewayReferenceDrainIncompleteError(
          invoking.map((call) => call.toolCallId),
        );
      }

      const appended = options.governanceLedger.append({
        kind: "governance-disabled",
        eventId: eventIdFactory(),
        actor,
        reason: opts?.reason,
      });
      if (!appended.ok) {
        mode = "enabled";
        epoch = drainEpoch;
        throw appended.error;
      }

      mode = "disabled";
      epoch = appended.event.epoch;
      return getGovernanceState();
    });
  }

  async function enableGovernance(opts?: {
    reason?: string | undefined;
  }): Promise<GovernanceStateV1> {
    return withTransitionLock(async () => {
      if (mode === "enabled") {
        return getGovernanceState();
      }
      if (mode === "draining") {
        throw new Error("cannot enable while governance is draining");
      }
      if (!options.governanceLedger) {
        throw new Error(
          "governanceLedger is required to enable gateway governance",
        );
      }

      const appended = options.governanceLedger.append({
        kind: "governance-enabled",
        eventId: eventIdFactory(),
        actor,
        reason: opts?.reason,
      });
      if (!appended.ok) {
        // Fail closed: remain disabled.
        throw appended.error;
      }

      mode = "enabled";
      epoch = appended.event.epoch;
      return getGovernanceState();
    });
  }

  async function route(
    toolName: string,
    params: Record<string, unknown>,
    ctx: GatewayRouteContext,
  ): Promise<unknown> {
    if (!packageEnabled) {
      throw new GatewayReferenceDisabledError();
    }

    // Ungated path — only after durable disable publication.
    if (mode === "disabled") {
      return invoke(toolName, params);
    }

    if (mode === "draining") {
      throw new GatewayReferenceDrainingError();
    }

    const capturedEpoch = epoch;
    const toolCtx: FppToolCallContext = {
      toolCallId: ctx.toolCallId,
      agentId: ctx.agentId,
      runId: ctx.runId,
      sessionKey: ctx.sessionKey,
      governanceEpoch: capturedEpoch,
      governanceMode: mode,
    };

    if (active.has(ctx.toolCallId)) {
      throw new GatewayReferenceDuplicateActiveCallError(ctx.toolCallId);
    }

    const ownershipToken = Symbol(`active:${ctx.toolCallId}`);
    const activeCall: ActiveCall = {
      toolCallId: ctx.toolCallId,
      epoch: capturedEpoch,
      phase: "evaluating",
      cancelled: false,
      ownershipToken,
    };
    active.set(ctx.toolCallId, activeCall);
    try {
      const before = await runtime.onBeforeToolCall(
        { toolName, params, toolCallId: ctx.toolCallId },
        toolCtx,
      );

      // A delayed policy evaluation can create a pending receipt after a drain
      // already cancelled and reconciled this call. Reconcile it before the
      // stale-epoch exit so every created receipt reaches one terminal state.
      if (activeCall.cancelled) {
        runtime.reconcileTransitionAbortedReceipts({
          governanceEpoch: capturedEpoch,
          eligibleToolCallIds: new Set([ctx.toolCallId]),
          nowIso: new Date(nowMs()).toISOString(),
        });
        throw new GatewayReferenceStaleEpochError();
      }

      if (before.action === "block") {
        throw new GatewayReferenceDeniedError(before.blockReason);
      }
      if (before.action === "require_approval") {
        // Gateway-reference has no approval UI: terminalize before returning.
        await before.onResolution("cancelled");
        throw new GatewayReferenceDeniedError(
          `require_approval not supported in gateway-reference: ${before.description}`,
        );
      }

      activeCall.phase = "ready";
      if (options.beforeInvoke) {
        await options.beforeInvoke({
          toolCallId: ctx.toolCallId,
          capturedEpoch,
          mode,
        });
      }

      // Final pre-invoke barrier: reject stale epochs and post-disable resumes.
      // Re-read published state after awaits — mode may have transitioned.
      const published = getGovernanceState();
      if (
        activeCall.cancelled ||
        capturedEpoch !== published.epoch ||
        published.mode === "disabled"
      ) {
        throw new GatewayReferenceStaleEpochError();
      }

      activeCall.phase = "invoking";
      try {
        const result = await invoke(toolName, params);
        await runtime.onAfterToolCall(
          { toolName, params, toolCallId: ctx.toolCallId, result },
          toolCtx,
        );
        return result;
      } catch (err) {
        if (
          err instanceof GatewayReferenceStaleEpochError ||
          err instanceof GatewayReferenceDrainingError
        ) {
          throw err;
        }
        await runtime.onAfterToolCall(
          {
            toolName,
            params,
            toolCallId: ctx.toolCallId,
            error: err instanceof Error ? err.message : String(err),
          },
          toolCtx,
        );
        throw err;
      }
    } finally {
      releaseActiveCall(ctx.toolCallId, ownershipToken);
    }
  }

  return {
    enabled: packageEnabled,
    getGovernanceState,
    disableGovernance,
    enableGovernance,
    route,
  };
}
