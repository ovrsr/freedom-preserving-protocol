/**
 * RED tests for trust-plugin test helpers.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import {
  createTempWorkspace,
  createFakeClock,
  createHookCapture,
  createFakeApprovalResolver,
} from "./test-helpers.js";

describe("plugin-trust test-helpers", () => {
  const workspaces: Array<{ path: string; cleanup: () => void }> = [];

  after(() => {
    for (const ws of workspaces) ws.cleanup();
  });

  it("creates an isolated temp workspace that cleans up", () => {
    const ws = createTempWorkspace("fpp-trust-");
    workspaces.push(ws);
    assert.ok(existsSync(ws.path));
    assert.ok(!ws.path.includes(".openclaw"));
    ws.cleanup();
    assert.equal(existsSync(ws.path), false);
  });

  it("captures hook registrations for assertion", () => {
    const capture = createHookCapture();
    const handler = async () => undefined;
    capture.api.on("agent_end", handler);
    assert.equal(capture.hooks.length, 1);
    assert.equal(capture.hooks[0]!.event, "agent_end");
  });

  it("resolves fake approvals without a gateway", async () => {
    const resolver = createFakeApprovalResolver();
    const p = resolver.waitForResolution("t-1");
    resolver.resolve("t-1", "deny");
    assert.equal(await p, "deny");
  });

  it("advances a fake clock without busy-waiting", () => {
    const clock = createFakeClock(42);
    clock.advance(8);
    assert.equal(clock.now(), 50);
  });
});
