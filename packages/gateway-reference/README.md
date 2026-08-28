# @ovrsr/fpp-gateway-reference

**Not a production gateway. Not an OpenClaw plugin. Not upstream enforcement.**

This package is a **feature-flagged, non-default, CI-only** in-process stub that
exercises gateway-shaped disposition and **bounded governance transitions**
(`enabled → draining → disabled` with a monotonic epoch).

It must not be packaged, installed, or described as a live OpenClaw gateway.

At a disable deadline, only evaluating/ready calls from the draining epoch are
transition-aborted. If a downstream call is already invoking, disable fails,
no `governance-disabled` event is published, and that call retains its eventual
executed/error receipt. Receipt persistence failure also prevents disabled
publication. Governance ledger candidates are validated and file-fsynced before
atomic replacement; parent-directory fsync and POSIX mode bits are best effort
on Windows/filesystems that do not support them.

## Focused verification

```bash
npm test -w @ovrsr/fpp-gateway-reference
npm run typecheck -w @ovrsr/fpp-gateway-reference
```

## Minimal usage (CI demos only)

```ts
import {
  createGatewayReferenceRouter,
  GovernanceLedger,
} from "@ovrsr/fpp-gateway-reference";
import { createEnforcementRuntime } from "@ovrsr/fpp-enforcement-core";

const runtime = createEnforcementRuntime(config, adapter);
const ledger = new GovernanceLedger({
  path: "./governance.jsonl",
  signer, // injected — this package does not own private keys
  verifier,
  constitutionHash,
  policyEngineVersion,
});

const router = createGatewayReferenceRouter({
  enabled: true, // package feature flag — default is false
  runtime,
  invoke: async (tool, params) => realInvoke(tool, params),
  governanceLedger: ledger,
  drainTimeoutMs: 1_000,
});

// Package flag (`enabled`) ≠ runtime governance mode (`getGovernanceState()`).
await router.route("Shell", { command: "echo hi" }, { toolCallId: "1" });
await router.disableGovernance({ reason: "Law 2 kill-switch demo" });
```

See RFC: `docs/rfc/0001-voluntary-constitutional-layer.md` (§ Governance transitions).
Canonical status remains `PROPOSED` / upstream `DEFERRED` in `docs/CAPABILITY_STATUS.md`.
