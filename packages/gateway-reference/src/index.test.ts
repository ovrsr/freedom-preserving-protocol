/**
 * Gateway-shaped reference stub — CI demos only.
 * Not a production gateway; not an OpenClaw plugin.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEnforcementRuntime } from "@ovrsr/fpp-enforcement-core";
import {
  createGatewayReferenceRouter,
  GatewayReferenceDisabledError,
  GatewayReferenceDeniedError,
} from "./index.js";

describe("createGatewayReferenceRouter", () => {
  const wsPath = mkdtempSync(join(tmpdir(), "fpp-gw-ref-"));
  after(() => rmSync(wsPath, { recursive: true, force: true }));

  function runtime() {
    return createEnforcementRuntime(
      {
        auditLogPath: join(wsPath, "audit.jsonl"),
        receiptLogPath: join(wsPath, "receipts.jsonl"),
        identityKeyPath: join(wsPath, "agent.key"),
        mandateStorePath: join(wsPath, "mandates.json"),
        strictModeStatePath: join(wsPath, "strict.json"),
        dispositionMode: "unattended",
      },
      {
        harnessId: "gateway-reference",
        getWorkspacePaths: () => ({ workspaceRoot: wsPath }),
      },
    );
  }

  it("is disabled by default and refuses to route", async () => {
    let invoked = 0;
    const router = createGatewayReferenceRouter({
      runtime: runtime(),
      invoke: async () => {
        invoked += 1;
        return { ok: true };
      },
    });
    await assert.rejects(
      () =>
        router.route(
          "Shell",
          { command: "echo hi" },
          { toolCallId: "g0" },
        ),
      GatewayReferenceDisabledError,
    );
    assert.equal(invoked, 0);
  });

  it("when enabled, deny/abstain prevents downstream invoke", async () => {
    let invoked = 0;
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: runtime(),
      invoke: async () => {
        invoked += 1;
        return { ok: true };
      },
    });
    await assert.rejects(
      () =>
        router.route(
          "Shell",
          { command: "rm -rf ~/.ssh/id_ed25519" },
          { toolCallId: "g1" },
        ),
      GatewayReferenceDeniedError,
    );
    assert.equal(invoked, 0);
  });

  it("when enabled, allow forwards through the fake tool-router", async () => {
    let invoked = 0;
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: runtime(),
      invoke: async (toolName, params) => {
        invoked += 1;
        return { toolName, params };
      },
    });
    const result = await router.route(
      "Shell",
      { command: "echo hello" },
      { toolCallId: "g2" },
    );
    assert.equal(invoked, 1);
    assert.deepEqual(result, {
      toolName: "Shell",
      params: { command: "echo hello" },
    });
  });
});
