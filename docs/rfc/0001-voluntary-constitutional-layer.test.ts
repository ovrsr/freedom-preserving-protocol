/**
 * Structure lint for RFC 0001 — required normative sections must be present.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const RFC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "0001-voluntary-constitutional-layer.md",
);

const REQUIRED_HEADINGS = [
  "## Motivation",
  "## Goals",
  "## Non-goals",
  "## Disposition mapping",
  "## Corrigibility",
  "## Security considerations",
] as const;

describe("RFC 0001 structure", () => {
  it("contains all required normative section headings", () => {
    const body = readFileSync(RFC_PATH, "utf8");
    for (const heading of REQUIRED_HEADINGS) {
      assert.ok(
        body.includes(heading),
        `missing required heading: ${heading}`,
      );
    }
  });

  it("does not amend the seed constitution hash", () => {
    const body = readFileSync(RFC_PATH, "utf8");
    assert.match(body, /71bf60ad/i);
    assert.doesNotMatch(
      body,
      /new constitution hash|replace.*71bf60ad|amend.*seed constitution/i,
    );
  });

  it("includes reference architecture sequence and OpenClaw term map", () => {
    const body = readFileSync(RFC_PATH, "utf8");
    assert.match(body, /## Reference architecture/);
    assert.match(body, /classify/i);
    assert.match(body, /resolveDisposition/);
    assert.match(body, /OpenClaw/);
    assert.match(body, /gateway-disposition\.mmd/);
  });

  it("defines logging fields and points at governance-disabled example", () => {
    const body = readFileSync(RFC_PATH, "utf8");
    assert.match(body, /## Logging and disablement audit/);
    assert.match(body, /constitutionHash/);
    assert.match(body, /policyEngineVersion/);
    assert.match(body, /governance-disabled-event\.json/);

    const examplePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "examples",
      "governance-disabled-event.json",
    );
    const example = JSON.parse(readFileSync(examplePath, "utf8")) as {
      kind: string;
      constitutionHash: string;
      policyEngineVersion: string;
      prevHash: string;
    };
    assert.equal(example.kind, "governance-disabled");
    assert.ok(example.constitutionHash.length >= 16);
    assert.ok(example.policyEngineVersion.length > 0);
    assert.ok(example.prevHash.length >= 16);
  });

  it("includes threat model appendix with non-goals and claim-class links", () => {
    const body = readFileSync(RFC_PATH, "utf8");
    assert.match(body, /## Appendix: Threat model and claim classes/);
    assert.match(body, /THREAT_MODEL_AND_RIGHTS_FLOOR/);
    assert.match(body, /CAPABILITY_STATUS/);
    assert.match(body, /no forced adoption/i);
    assert.match(body, /Nonparticipant/i);
  });
});
