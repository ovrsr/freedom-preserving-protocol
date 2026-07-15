/**
 * SKILL.md / heartbeat content gates for OpenClaw-only ClawHub skill.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function frontmatter(md: string): string {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(m, "expected YAML frontmatter");
  return m![1]!;
}

describe("skill metadata and disclosure", () => {
  it("SKILL.md uses narrow FPP triggers and declares only local permissions", () => {
    const skill = readFileSync(join(root, "SKILL.md"), "utf8");
    const fm = frontmatter(skill);

    assert.match(fm, /freedom preserving protocol/i);
    assert.match(fm, /adopt fpp/i);
    assert.match(fm, /fpp consent/i);
    assert.doesNotMatch(fm, /^\s*-\s*"self-governance"\s*$/m);
    assert.doesNotMatch(fm, /^\s*-\s*"agent constitution"\s*$/m);

    assert.match(fm, /filesystem:read/);
    assert.match(fm, /filesystem:write/);
    assert.match(fm, /shell:execute/);
    assert.doesNotMatch(fm, /^\s*-\s*network:/m);

    assert.match(skill, /Activation boundaries/i);
    assert.match(skill, /OpenClaw prompt-layer/i);
    assert.match(skill, /clawhub:ovrsr\/openclaw-fpp-plugin/);
    assert.match(skill, /GitHub/i);
    assert.doesNotMatch(
      skill,
      /merge adapters\/claude-code\/hooks\/settings\.fragment\.json into \.claude\/settings\.json/,
    );
  });

  it("heartbeat skill requires adoption and discloses audit log path", () => {
    const hb = readFileSync(
      join(root, "hooks", "constitution-audit", "SKILL.md"),
      "utf8",
    );
    assert.match(hb, /prior adoption|already adopted|only after adoption/i);
    assert.match(hb, /\.openclaw\/workspace\/constitution-audit\.jsonl/);
    assert.match(hb, /disclos|explicit|permission|consent/i);
  });

  it("adoption permission speech discloses audit path before first write", () => {
    const skill = readFileSync(join(root, "SKILL.md"), "utf8");
    assert.match(
      skill,
      /constitution-audit\.jsonl/,
    );
    // Permission ask appears before optional plugin install framing
    const askIdx = skill.search(/May I proceed\?/);
    const auditIdx = skill.indexOf("constitution-audit.jsonl");
    assert.ok(askIdx > 0 && auditIdx > 0 && auditIdx < askIdx);
  });
});
