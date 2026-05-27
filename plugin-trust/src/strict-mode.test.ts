import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StrictModeManager } from "./strict-mode.js";

describe("StrictModeManager", () => {
  const tmp = mkdtempSync(join(tmpdir(), "fpp-strict-test-"));
  const statePath = join(tmp, "strict.json");

  it("starts with no strict sessions", () => {
    const mgr = new StrictModeManager(statePath);
    const sessions = mgr.getStrictSessions();
    assert.deepEqual(sessions, {});
  });

  it("enters and reads strict mode", () => {
    const mgr = new StrictModeManager(statePath);
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
    const mgr = new StrictModeManager(statePath);
    mgr.enterStrict("session-2", "test reason");
    assert.ok(mgr.isStrict("session-2"));

    const removed = mgr.exitStrict("session-2");
    assert.equal(removed, true);
    assert.equal(mgr.isStrict("session-2"), null);
  });

  it("returns null for unknown session", () => {
    const mgr = new StrictModeManager(statePath);
    assert.equal(mgr.isStrict("nonexistent"), null);
  });

  it("auto-prunes expired sessions", () => {
    const mgr = new StrictModeManager(statePath);
    mgr.enterStrict("expired-session", "will expire", 1);

    // Wait 10ms so it expires
    const start = Date.now();
    while (Date.now() - start < 15) {
      /* spin */
    }

    assert.equal(mgr.isStrict("expired-session"), null);
  });

  it("clears all sessions", () => {
    const mgr = new StrictModeManager(statePath);
    mgr.enterStrict("s1", "r1");
    mgr.enterStrict("s2", "r2");
    mgr.clearAll();
    assert.deepEqual(mgr.getStrictSessions(), {});
  });

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });
});
