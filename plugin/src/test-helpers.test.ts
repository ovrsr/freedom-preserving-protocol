/**
 * RED tests for plugin test helpers — temporary workspaces, hook capture,
 * fake approval resolution, and deterministic clocks.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  createTempWorkspace,
  createFakeClock,
  createHookCapture,
  createFakeApprovalResolver,
} from "./test-helpers.js";

describe("plugin test-helpers", () => {
  const workspaces: Array<{ path: string; cleanup: () => void }> = [];

  after(() => {
    for (const ws of workspaces) ws.cleanup();
  });

  it("creates an isolated temp workspace that cleans up", () => {
    const ws = createTempWorkspace("fpp-plugin-");
    workspaces.push(ws);
    assert.ok(existsSync(ws.path));
    assert.ok(!ws.path.includes(".openclaw"));
    const nested = join(ws.path, "audit.jsonl");
    ws.writeFile("audit.jsonl", "{}\n");
    assert.ok(existsSync(nested));
    ws.cleanup();
    assert.equal(existsSync(ws.path), false);
  });

  it("captures hook registrations for assertion", () => {
    const capture = createHookCapture();
    const handler = async () => ({ block: true as const });
    capture.api.on("before_tool_call", handler, { priority: 50 });
    assert.equal(capture.hooks.length, 1);
    assert.equal(capture.hooks[0]!.event, "before_tool_call");
    assert.equal(capture.hooks[0]!.priority, 50);
    assert.equal(capture.hooks[0]!.handler, handler);
  });

  it("resolves fake approvals without a gateway", async () => {
    const resolver = createFakeApprovalResolver();
    const p = resolver.waitForResolution("call-1");
    resolver.resolve("call-1", "allow-once");
    assert.equal(await p, "allow-once");
  });

  it("advances a fake clock without busy-waiting", () => {
    const clock = createFakeClock(1_000_000);
    assert.equal(clock.now(), 1_000_000);
    clock.advance(5_000);
    assert.equal(clock.now(), 1_005_000);
    assert.equal(clock.iso(), new Date(1_005_000).toISOString());
  });
});
