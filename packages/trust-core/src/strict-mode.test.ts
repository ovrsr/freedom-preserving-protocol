import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  StrictModeManager,
  CONSERVATIVE_STRICT_APPROVAL_ON,
  STRICT_MODE_SCHEMA_VERSION,
} from "./strict-mode.js";
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

  it("malformed JSON applies conservative session fallback instead of empty", () => {
    const path = join(ws.path, "strict-malformed.json");
    writeFileSync(path, "{not-json", "utf8");
    const diagnostics: string[] = [];
    const mgr = new StrictModeManager(path, {
      now: clock.now,
      onDiagnostic: (d) => diagnostics.push(d.code),
    });
    const entry = mgr.isStrict("any-session");
    assert.ok(entry, "malformed state must not silently disable protection");
    assert.equal(entry.strict, true);
    assert.deepEqual(entry.addedApprovalOn, CONSERVATIVE_STRICT_APPROVAL_ON);
    assert.ok(diagnostics.includes("STRICT_MODE_MALFORMED"));
    assert.ok(
      !diagnostics.some((c) => /any-session|secret/i.test(c)),
      "diagnostics must not embed session keys",
    );
    // Corrupt file must be preserved as evidence
    assert.equal(readFileSync(path, "utf8"), "{not-json");
  });

  it("rejects unknown schema version with conservative fallback", () => {
    const path = join(ws.path, "strict-bad-version.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 99,
        updatedAt: new Date(clock.now()).toISOString(),
        sessions: {
          "s-1": {
            strict: true,
            reason: "x",
            addedApprovalOn: ["fs.write.workspace"],
            addedAt: new Date(clock.now()).toISOString(),
            expiresAt: new Date(clock.now() + 60_000).toISOString(),
          },
        },
      }),
      "utf8",
    );
    const diagnostics: string[] = [];
    const mgr = new StrictModeManager(path, {
      now: clock.now,
      onDiagnostic: (d) => diagnostics.push(d.code),
    });
    const entry = mgr.isStrict("s-1");
    assert.ok(entry);
    assert.deepEqual(entry.addedApprovalOn, CONSERVATIVE_STRICT_APPROVAL_ON);
    assert.ok(diagnostics.includes("STRICT_MODE_SCHEMA_INVALID"));
  });

  it("filters unknown classifications from overrides", () => {
    const path = join(ws.path, "strict-unknown-class.json");
    const mgr = new StrictModeManager(path, { now: clock.now });
    mgr.enterStrict("s-filter", "test", 60_000, [
      "fs.write.workspace",
      "not.a.real.class",
      "http.public-read",
    ]);
    const entry = mgr.isStrict("s-filter");
    assert.ok(entry);
    assert.deepEqual(entry.addedApprovalOn, [
      "fs.write.workspace",
      "http.public-read",
    ]);
    assert.ok(!entry.addedApprovalOn.includes("not.a.real.class"));
  });

  it("default taxonomy includes only reachable classifications", () => {
    assert.equal(STRICT_MODE_SCHEMA_VERSION, 1);
    assert.ok(CONSERVATIVE_STRICT_APPROVAL_ON.includes("http.public-read"));
    assert.ok(CONSERVATIVE_STRICT_APPROVAL_ON.includes("http.public-write"));
    assert.ok(!CONSERVATIVE_STRICT_APPROVAL_ON.includes("http.read"));
  });

  it("persisted state uses versioned schema", () => {
    const path = join(ws.path, "strict-schema.json");
    const mgr = new StrictModeManager(path, { now: clock.now });
    mgr.enterStrict("s-schema", "reason", 60_000, ["fs.write.workspace"]);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(raw.version, STRICT_MODE_SCHEMA_VERSION);
    assert.equal(typeof raw.updatedAt, "string");
    assert.equal(typeof raw.sessions, "object");
    const entry = raw.sessions["s-schema"];
    assert.equal(entry.strict, true);
    assert.ok(Array.isArray(entry.addedApprovalOn));
    assert.equal(typeof entry.addedAt, "string");
    assert.equal(typeof entry.expiresAt, "string");
  });
});
