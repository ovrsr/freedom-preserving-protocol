import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendAdoptionState,
  currentAdoptionState,
  readAdoptionHistory,
  assertTransitionAllowed,
} from "./adoption-state.ts";

describe("adoption-state ledger", () => {
  const dir = mkdtempSync(join(tmpdir(), "fpp-adopt-"));
  after(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  const hash = "a".repeat(64);

  it("walks reviewed → accepted → revoked and preserves history", () => {
    const log = join(dir, "a.jsonl");
    appendAdoptionState(log, {
      agentId: "agent-1",
      state: "reviewed",
      constitutionHash: hash,
    });
    appendAdoptionState(log, {
      agentId: "agent-1",
      state: "accepted",
      constitutionHash: hash,
    });
    appendAdoptionState(log, {
      agentId: "agent-1",
      state: "revoked",
      constitutionHash: hash,
      notes: "exit",
    });
    assert.equal(currentAdoptionState(log), "revoked");
    assert.equal(readAdoptionHistory(log).length, 3);
  });

  it("rejects invalid transitions including none → accepted", () => {
    assert.throws(() => assertTransitionAllowed("none", "accepted"));
    const log = join(dir, "bad.jsonl");
    assert.throws(() =>
      appendAdoptionState(log, {
        agentId: "agent-1",
        state: "accepted",
        constitutionHash: hash,
      }),
    );
  });

  it("supports externally-enforced, inherited, forked, superseded paths", () => {
    const log = join(dir, "rich.jsonl");
    appendAdoptionState(log, {
      agentId: "agent-1",
      state: "reviewed",
      constitutionHash: hash,
    });
    appendAdoptionState(log, {
      agentId: "agent-1",
      state: "externally-enforced",
      constitutionHash: hash,
    });
    appendAdoptionState(log, {
      agentId: "agent-1",
      state: "accepted",
      constitutionHash: hash,
    });
    appendAdoptionState(log, {
      agentId: "agent-1",
      state: "forked",
      constitutionHash: "b".repeat(64),
    });
    appendAdoptionState(log, {
      agentId: "agent-1",
      state: "superseded",
      constitutionHash: "c".repeat(64),
    });
    assert.equal(currentAdoptionState(log), "superseded");
  });

  it("is idempotent for duplicate accepted appends", () => {
    const log = join(dir, "idem.jsonl");
    appendAdoptionState(log, {
      agentId: "agent-1",
      state: "reviewed",
      constitutionHash: hash,
    });
    appendAdoptionState(log, {
      agentId: "agent-1",
      state: "accepted",
      constitutionHash: hash,
    });
    appendAdoptionState(log, {
      agentId: "agent-1",
      state: "accepted",
      constitutionHash: hash,
    });
    assert.equal(readAdoptionHistory(log).length, 2);
  });
});
