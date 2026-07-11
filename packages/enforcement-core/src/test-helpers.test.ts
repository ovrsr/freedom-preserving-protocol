import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempWorkspace, createFakeClock } from "./test-helpers.js";

describe("enforcement-core test-helpers", () => {
  it("creates an isolated temp workspace outside .openclaw", () => {
    const ws = createTempWorkspace();
    try {
      assert.ok(!/[\\/]\.openclaw([\\/]|$)/.test(ws.path));
      const written = ws.writeFile("a/b.txt", "ok");
      assert.ok(written.endsWith("a/b.txt") || written.endsWith("a\\b.txt"));
    } finally {
      ws.cleanup();
    }
  });

  it("advances a fake clock", () => {
    const clock = createFakeClock(1000);
    assert.equal(clock.now(), 1000);
    clock.advance(500);
    assert.equal(clock.now(), 1500);
  });
});
