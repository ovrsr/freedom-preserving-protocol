import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { StrictModeManager } from "./strict-mode.js";
import { createTempWorkspace, createFakeClock } from "./test-helpers.js";

describe("StrictModeManager", () => {
  const ws = createTempWorkspace("fpp-strict-test-");
  const statePath = join(ws.path, "strict.json");
  const clock = createFakeClock(1_000_000);

  after(() => {
    ws.cleanup();
  });

  it("starts with no strict sessions", () => {
    const mgr = new StrictModeManager(statePath, { now: clock.now });
    assert.deepEqual(mgr.getStrictSessions(), {});
  });

  it("enters and reads strict mode", () => {
    const mgr = new StrictModeManager(statePath, { now: clock.now });
    mgr.enterStrict("session-1", "handshake failed", 60_000, [
      "fs.write.workspace",
    ]);
    const entry = mgr.isStrict("session-1");
    assert.ok(entry);
    assert.equal(entry.strict, true);
    assert.equal(entry.reason, "handshake failed");
    assert.deepEqual(entry.addedApprovalOn, ["fs.write.workspace"]);
    assert.ok(existsSync(statePath));
  });

  it("exits strict mode", () => {
    const mgr = new StrictModeManager(statePath, { now: clock.now });
    mgr.enterStrict("session-2", "test reason");
    assert.ok(mgr.isStrict("session-2"));
    assert.equal(mgr.exitStrict("session-2"), true);
    assert.equal(mgr.isStrict("session-2"), null);
  });

  it("returns null for unknown session", () => {
    const mgr = new StrictModeManager(statePath, { now: clock.now });
    assert.equal(mgr.isStrict("nonexistent"), null);
  });

  it("auto-prunes expired sessions without busy-wait", () => {
    const mgr = new StrictModeManager(statePath, { now: clock.now });
    mgr.enterStrict("expired-session", "will expire", 10);
    clock.advance(50);
    assert.equal(mgr.isStrict("expired-session"), null);
  });

  it("clears all sessions", () => {
    const mgr = new StrictModeManager(statePath, { now: clock.now });
    mgr.enterStrict("s1", "r1");
    mgr.enterStrict("s2", "r2");
    mgr.clearAll();
    assert.deepEqual(mgr.getStrictSessions(), {});
  });
});
