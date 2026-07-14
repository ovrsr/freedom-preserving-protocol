import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendAdoptionState,
  computePeerAdvertisability,
  currentAdoptionState,
  readAdoptionHistory,
  assertTransitionAllowed,
  type AdoptionProbeEvidence,
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

  it("appends V2 records with overlays, harnessId, and enforcementGrade", () => {
    const log = join(dir, "v2.jsonl");
    appendAdoptionState(log, {
      agentId: "agent-1",
      state: "reviewed",
      constitutionHash: hash,
      harnessId: "cursor",
      enforcementGrade: "native-hook",
      overlays: [],
    });
    appendAdoptionState(log, {
      agentId: "agent-1",
      state: "accepted",
      constitutionHash: hash,
      harnessId: "cursor",
      enforcementGrade: "native-hook",
      overlays: [],
    });
    const last = readAdoptionHistory(log).at(-1)!;
    assert.equal(last.record.schemaVersion, 2);
    if (last.record.schemaVersion === 2) {
      assert.equal(last.record.harnessId, "cursor");
      assert.equal(last.record.enforcementGrade, "native-hook");
      assert.deepEqual(last.record.overlays, []);
    }
  });

  it("allows overlay-only updates without changing base state", () => {
    const log = join(dir, "overlay.jsonl");
    appendAdoptionState(log, {
      agentId: "agent-1",
      state: "reviewed",
      constitutionHash: hash,
      harnessId: "cursor",
      enforcementGrade: "prompt-only",
      overlays: [],
    });
    appendAdoptionState(log, {
      agentId: "agent-1",
      state: "accepted",
      constitutionHash: hash,
      harnessId: "cursor",
      enforcementGrade: "prompt-only",
      overlays: ["runtime_degraded"],
    });
    const before = readAdoptionHistory(log).length;
    appendAdoptionState(log, {
      agentId: "agent-1",
      state: "accepted",
      constitutionHash: hash,
      harnessId: "cursor",
      enforcementGrade: "prompt-only",
      overlays: ["runtime_degraded", "coercion_suspected"],
    });
    assert.equal(currentAdoptionState(log), "accepted");
    assert.equal(readAdoptionHistory(log).length, before + 1);
    const last = readAdoptionHistory(log).at(-1)!;
    assert.equal(last.record.schemaVersion, 2);
    if (last.record.schemaVersion === 2) {
      assert.deepEqual(last.record.overlays, [
        "runtime_degraded",
        "coercion_suspected",
      ]);
    }
  });
});

describe("computePeerAdvertisability", () => {
  const probePass: AdoptionProbeEvidence = {
    passed: true,
    preToolHook: true,
  };

  it("returns false for prompt-only regardless of probe", () => {
    const result = computePeerAdvertisability(
      {
        schemaVersion: 2,
        agentId: "a",
        state: "accepted",
        constitutionHash: "h",
        recordedAt: "2026-07-10T00:00:00.000Z",
        harnessId: "generic",
        enforcementGrade: "prompt-only",
        overlays: ["runtime_degraded"],
      },
      probePass,
    );
    assert.equal(result.peerAdvertisable, false);
    assert.equal(result.assurance, "declaration-only");
  });

  it("returns false for none and for missing probe", () => {
    const base = {
      schemaVersion: 2 as const,
      agentId: "a",
      state: "accepted" as const,
      constitutionHash: "h",
      recordedAt: "2026-07-10T00:00:00.000Z",
      harnessId: "unknown",
      enforcementGrade: "none" as const,
      overlays: [] as [],
    };
    assert.equal(
      computePeerAdvertisability(base, probePass).peerAdvertisable,
      false,
    );
    assert.equal(
      computePeerAdvertisability(
        { ...base, enforcementGrade: "native-hook" },
        undefined,
      ).peerAdvertisable,
      false,
    );
  });

  it("returns peer-advertisable for native-hook when probe passes", () => {
    const result = computePeerAdvertisability(
      {
        schemaVersion: 2,
        agentId: "a",
        state: "accepted",
        constitutionHash: "h",
        recordedAt: "2026-07-10T00:00:00.000Z",
        harnessId: "cursor",
        enforcementGrade: "native-hook",
        overlays: [],
      },
      probePass,
    );
    assert.equal(result.peerAdvertisable, true);
    assert.equal(result.assurance, "peer-advertisable");
  });

  it("returns peer-advertisable for tool-proxy only with partial/degraded disclosure", () => {
    const record = {
      schemaVersion: 2 as const,
      agentId: "a",
      state: "accepted" as const,
      constitutionHash: "h",
      recordedAt: "2026-07-10T00:00:00.000Z",
      harnessId: "sidecar",
      enforcementGrade: "tool-proxy" as const,
      overlays: [] as string[],
    };
    const probe: AdoptionProbeEvidence = {
      passed: true,
      toolProxy: true,
    };
    assert.equal(
      computePeerAdvertisability(record, probe).peerAdvertisable,
      false,
    );
    assert.equal(
      computePeerAdvertisability(
        { ...record, overlays: ["runtime_degraded"] },
        probe,
      ).peerAdvertisable,
      true,
    );
  });

  it("returns false for V1 records (no silent peer elevation)", () => {
    const result = computePeerAdvertisability(
      {
        schemaVersion: 1,
        agentId: "a",
        state: "accepted",
        constitutionHash: "h",
        recordedAt: "2026-07-10T00:00:00.000Z",
      },
      probePass,
    );
    assert.equal(result.peerAdvertisable, false);
    assert.equal(result.assurance, "declaration-only");
  });
});
