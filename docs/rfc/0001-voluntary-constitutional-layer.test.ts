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
      epoch?: number;
      previousMode?: string;
      mode?: string;
    };
    assert.equal(example.kind, "governance-disabled");
    assert.ok(example.constitutionHash.length >= 16);
    assert.ok(example.policyEngineVersion.length > 0);
    assert.ok(example.prevHash.length >= 16);
    assert.equal(typeof example.epoch, "number");
    assert.equal(example.mode, "disabled");
    assert.ok(
      example.previousMode === "draining" || example.previousMode === "enabled",
    );
  });

  it("defines in-flight governance transition semantics with bounded drain", () => {
    const body = readFileSync(RFC_PATH, "utf8");
    assert.match(body, /## Governance transitions/);
    assert.match(body, /governance epoch/i);
    assert.match(body, /enabled.*draining.*disabled/is);
    assert.match(body, /bounded drain/i);
    assert.match(body, /governance_transition_aborted/);
    assert.match(body, /MUST[\s\S]*append[\s\S]*governance-disabled/i);
    assert.match(body, /MUST NOT[\s\S]*unbounded/i);
    assert.match(body, /approval-held/i);
    assert.match(body, /pending|queued|in-flight/i);
  });

  it("fails disable rather than relabeling work already invoking", () => {
    const body = readFileSync(RFC_PATH, "utf8");
    assert.match(
      body,
      /invoking[\s\S]*deadline[\s\S]*disable attempt[\s\S]*MUST fail/is,
    );
    assert.match(
      body,
      /fail[\s\S]*MUST NOT[\s\S]*governance-disabled|MUST NOT[\s\S]*append[\s\S]*governance-disabled/is,
    );
    assert.match(body, /executed|error/);
    assert.doesNotMatch(
      body,
      /reference[- ]only proof|reference proof|proven only in `?packages\/gateway-reference/i,
    );
  });

  it("includes threat model appendix with non-goals and claim-class links", () => {
    const body = readFileSync(RFC_PATH, "utf8");
    assert.match(body, /## Appendix: Threat model and claim classes/);
    assert.match(body, /THREAT_MODEL_AND_RIGHTS_FLOOR/);
    assert.match(body, /CAPABILITY_STATUS/);
    assert.match(body, /no forced adoption/i);
    assert.match(body, /Nonparticipant/i);
  });

  it("defines instrumented-boundary-disposition with positive and prohibited conclusions", () => {
    const body = readFileSync(RFC_PATH, "utf8");
    assert.match(body, /### Claim-class cross-link/);
    const claimRow = body
      .split(/\r?\n/)
      .find(
        (line) =>
          line.trimStart().startsWith("|") &&
          line.includes("instrumented-boundary-disposition"),
      );
    assert.ok(
      claimRow,
      "missing structured instrumented-boundary-disposition claim row",
    );
    assert.match(claimRow, /schema/i);
    assert.match(claimRow, /signed receipt|signature/i);
    assert.match(claimRow, /expected|matching/i);
    assert.match(claimRow, /inclusion/i);
    assert.match(
      claimRow,
      /recorded disposition .+ and authorization .+ against action digest/i,
    );
    assert.match(claimRow, /self-presented/i);
    assert.match(claimRow, /trusted boundary/i);
    assert.match(claimRow, /independent.*constitution/i);
    assert.match(claimRow, /policy ID/i);
    assert.match(claimRow, /policy version/i);
    assert.match(claimRow, /proof valid under (?:a |the )?claimed root/i);
    assert.match(claimRow, /independent.*root|root.*independent/i);
    assert.match(claimRow, /signature validity.*signer trust|signer trust.*signature validity/i);
    assert.match(claimRow, /downstream parameter/i);
    assert.match(claimRow, /bypass|uninstrumented/i);
    assert.match(claimRow, /completeness/i);
    assert.match(claimRow, /uncompromised runtime/i);
    assert.match(claimRow, /behavioral compliance/i);
    assert.doesNotMatch(
      body,
      /consultation occurred \(when enabled\), not that the model obeyed/i,
    );
    assert.doesNotMatch(body, /cryptographic execution constraint/i);
    assert.match(
      body,
      /execute-time digest comparison|exact downstream parameters become claimable/i,
    );
  });
});
