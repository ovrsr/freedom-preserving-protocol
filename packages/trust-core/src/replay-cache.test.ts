import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { ReplayCache } from "./replay-cache.js";
import { createFakeClock, createTempWorkspace } from "./test-helpers.js";

describe("ReplayCache", () => {
  const ws = createTempWorkspace("fpp-replay-");
  after(() => ws.cleanup());

  it("rejects a reused replay key", () => {
    const clock = createFakeClock(1_000_000);
    const cache = new ReplayCache({
      path: join(ws.path, "replay.json"),
      now: clock.now,
      maxEntries: 100,
    });
    assert.equal(cache.consume("key-a", clock.now() + 60_000), true);
    assert.equal(cache.consume("key-a", clock.now() + 60_000), false);
  });

  it("prunes expired entries and caps growth", () => {
    const clock = createFakeClock(1_000_000);
    const cache = new ReplayCache({
      path: join(ws.path, "replay-cap.json"),
      now: clock.now,
      maxEntries: 3,
    });
    assert.equal(cache.consume("k1", clock.now() + 10_000), true);
    assert.equal(cache.consume("k2", clock.now() + 10_000), true);
    clock.advance(20_000);
    assert.equal(cache.consume("k3", clock.now() + 60_000), true);
    assert.equal(cache.consume("k4", clock.now() + 60_000), true);
    assert.ok(cache.size() <= 3);
    assert.equal(cache.has("k1"), false);
  });

  it("persists consumed keys across reload", () => {
    const path = join(ws.path, "replay-persist.json");
    const clock = createFakeClock(2_000_000);
    const a = new ReplayCache({ path, now: clock.now, maxEntries: 50 });
    assert.equal(a.consume("persist-key", clock.now() + 60_000), true);
    const b = new ReplayCache({ path, now: clock.now, maxEntries: 50 });
    assert.equal(b.consume("persist-key", clock.now() + 60_000), false);
  });
});
