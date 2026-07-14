import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADOPTION_ASSURANCE_CLASSES,
  maxJustifiedConclusion,
  parseAdoptionDisclosure,
} from "./adoption-disclosure.js";

const base = {
  schemaVersion: 1 as const,
  agentId: "fpp:ed25519:" + "c".repeat(64),
  constitutionHash: "a".repeat(64),
  harnessId: "cursor",
  localState: "accepted" as const,
  enforcementGrade: "native-hook" as const,
  overlays: [] as string[],
  assurance: "peer-advertisable" as const,
  recordedAt: "2026-07-10T12:00:00.000Z",
};

describe("parseAdoptionDisclosure", () => {
  it("accepts peer-advertisable and declaration-only assurance classes", () => {
    for (const assurance of ADOPTION_ASSURANCE_CLASSES) {
      const result = parseAdoptionDisclosure({
        ...base,
        assurance,
        enforcementGrade:
          assurance === "declaration-only" ? "prompt-only" : "native-hook",
        overlays:
          assurance === "declaration-only" ? ["runtime_degraded"] : [],
      });
      assert.equal(result.ok, true, assurance);
      if (result.ok) {
        assert.equal(result.disclosure.assurance, assurance);
        assert.equal(result.disclosure.harnessId, "cursor");
        assert.equal(result.disclosure.constitutionHash, "a".repeat(64));
      }
    }
  });

  it("requires grade, overlays, constitution hash, and harnessId", () => {
    assert.equal(
      parseAdoptionDisclosure({ ...base, harnessId: "" }).ok,
      false,
    );
    assert.equal(
      parseAdoptionDisclosure({ ...base, constitutionHash: "" }).ok,
      false,
    );
    assert.equal(
      parseAdoptionDisclosure({
        ...base,
        overlays: undefined,
      }).ok,
      false,
    );
    assert.equal(
      parseAdoptionDisclosure({
        ...base,
        enforcementGrade: undefined,
      }).ok,
      false,
    );
  });

  it("rejects elevating prompt-only to peer-advertisable", () => {
    const result = parseAdoptionDisclosure({
      ...base,
      enforcementGrade: "prompt-only",
      overlays: ["runtime_degraded"],
      assurance: "peer-advertisable",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /prompt-only/i);
    }
  });

  it("rejects elevating none to peer-advertisable", () => {
    const result = parseAdoptionDisclosure({
      ...base,
      enforcementGrade: "none",
      assurance: "peer-advertisable",
    });
    assert.equal(result.ok, false);
  });

  it("requires runtime_degraded for prompt-only local accepted", () => {
    const result = parseAdoptionDisclosure({
      ...base,
      enforcementGrade: "prompt-only",
      overlays: [],
      assurance: "declaration-only",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /runtime_degraded/);
    }
  });

  it("requires degraded overlay for tool-proxy peer-advertisable", () => {
    assert.equal(
      parseAdoptionDisclosure({
        ...base,
        enforcementGrade: "tool-proxy",
        overlays: [],
        assurance: "peer-advertisable",
      }).ok,
      false,
    );
    assert.equal(
      parseAdoptionDisclosure({
        ...base,
        enforcementGrade: "tool-proxy",
        overlays: ["runtime_degraded"],
        assurance: "peer-advertisable",
      }).ok,
      true,
    );
  });
});

describe("maxJustifiedConclusion", () => {
  it("documents ceilings per assurance class", () => {
    const declaration = maxJustifiedConclusion("declaration-only");
    assert.match(declaration, /self-binding|attested/i);
    assert.match(declaration, /not .*boundary|not .*completeness|not .*dispatcher/i);

    const peer = maxJustifiedConclusion("peer-advertisable");
    assert.match(peer, /probe|grade/i);
    assert.match(peer, /not .*behavioral|not .*gateway/i);
  });
});
