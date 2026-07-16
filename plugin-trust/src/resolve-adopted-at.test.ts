/**
 * Resolve historical adoption time for handshake claims (Q6-A).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("resolveAdoptedAt", () => {
  const root = mkdtempSync(join(tmpdir(), "fpp-adopted-at-"));
  after(() => rmSync(root, { recursive: true, force: true }));

  it("uses SOUL - Adopted: ISO when present", async () => {
    const { resolveAdoptedAt, parseSoulAdoptedAt } = await import(
      "./resolve-adopted-at.js"
    );
    assert.equal(
      parseSoulAdoptedAt(
        "# Agent\n\n## Freedom Preserving Protocol\n- Adopted: 2026-05-01T12:34:56.000Z\n",
      ),
      "2026-05-01T12:34:56.000Z",
    );
    const soul = join(root, "SOUL.md");
    writeFileSync(
      soul,
      "## Freedom Preserving Protocol\n- Adopted: 2026-05-01T12:34:56.000Z\n",
    );
    assert.equal(
      resolveAdoptedAt({
        soulPath: soul,
        now: () => new Date("2026-07-16T00:00:00.000Z"),
      }),
      "2026-05-01T12:34:56.000Z",
    );
  });

  it("prefers adoption-state accepted recordedAt when present", async () => {
    const { resolveAdoptedAt } = await import("./resolve-adopted-at.js");
    const soul = join(root, "SOUL-state.md");
    writeFileSync(
      soul,
      "## Freedom Preserving Protocol\n- Adopted: 2026-05-01T00:00:00.000Z\n",
    );
    const statePath = join(root, "fpp-adoption-state.jsonl");
    writeFileSync(
      statePath,
      JSON.stringify({
        previousHash: "0".repeat(64),
        timestamp: "2026-06-15T10:00:00.000Z",
        kind: "adoption-state",
        record: {
          schemaVersion: 1,
          agentId: "agent-1",
          state: "accepted",
          constitutionHash: "a".repeat(64),
          recordedAt: "2026-06-15T10:00:00.000Z",
        },
        hash: "b".repeat(64),
      }) + "\n",
    );
    assert.equal(
      resolveAdoptedAt({
        soulPath: soul,
        adoptionStatePath: statePath,
        now: () => new Date("2026-07-16T00:00:00.000Z"),
      }),
      "2026-06-15T10:00:00.000Z",
    );
  });

  it("falls back to now when SOUL and adoption-state missing", async () => {
    const { resolveAdoptedAt } = await import("./resolve-adopted-at.js");
    assert.equal(
      resolveAdoptedAt({
        soulPath: join(root, "missing-SOUL.md"),
        now: () => new Date("2026-07-16T18:00:00.000Z"),
      }),
      "2026-07-16T18:00:00.000Z",
    );
  });

  it("executeHandshakeOffer stamps claim.adoptedAt from SOUL", async () => {
    const { executeHandshakeOffer } = await import("./tools.js");
    const { loadOrCreateIdentity } = await import("./identity.js");
    const { TrustGraphProtocol } = await import("./trust-graph.js");
    const { ConstitutionalHandshake } = await import("./handshake.js");
    const { MerkleBridge } = await import("./merkle-bridge.js");
    const { StrictModeManager } = await import("./strict-mode.js");
    const { GroupContextManager } = await import("./group-context.js");

    const HASH =
      "71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993";
    const dir = join(root, "offer");
    mkdirSync(dir, { recursive: true });
    const soul = join(dir, "SOUL.md");
    writeFileSync(
      soul,
      "## Freedom Preserving Protocol\n- Adopted: 2026-05-01T12:34:56.000Z\n",
    );
    const identity = loadOrCreateIdentity(join(dir, "id.key"), "/");
    const trustGraph = new TrustGraphProtocol();
    trustGraph.addAgent(identity.agentId, HASH);
    const handshake = new ConstitutionalHandshake(trustGraph, HASH);
    const merkleBridge = new MerkleBridge(join(dir, "audit.jsonl"));
    const strictMode = new StrictModeManager(join(dir, "strict.json"));
    const groupContext = new GroupContextManager(trustGraph, identity.agentId);
    const offer = executeHandshakeOffer(
      {},
      {
        identity,
        trustGraph,
        handshake,
        merkleBridge,
        strictMode,
        groupContext,
        constitutionHash: HASH,
        strictModeOnHandshakeFailure: false,
        strictModeTtlMs: 60_000,
        soulPath: soul,
      },
    );
    const claim = (offer.details as { claim: { adoptedAt: string } }).claim;
    assert.equal(claim.adoptedAt, "2026-05-01T12:34:56.000Z");
  });
});
