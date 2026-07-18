/**
 * Library consumer smoke test: enforcement-core + trust-core run in-process
 * without requiring the `openclaw` package as a dependency or import.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  classifyToolCall,
  resolveDisposition,
  DEFAULT_CONFIG,
  PACKAGE_NAME as ENFORCEMENT_NAME,
} from "@ovrsr/fpp-enforcement-core";
import {
  createTrustStack,
  PACKAGE_NAME as TRUST_NAME,
} from "@ovrsr/fpp-trust-core";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function assertNoOpenclawDependency(packageJsonPath: string): void {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  for (const section of [
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
    "devDependencies",
  ] as const) {
    assert.equal(
      pkg[section]?.openclaw,
      undefined,
      `${packageJsonPath} must not declare openclaw in ${section}`,
    );
  }
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...listSourceFiles(p));
    else if (name.name.endsWith(".ts") && !name.name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

function assertNoOpenclawImport(srcDir: string): void {
  for (const file of listSourceFiles(srcDir)) {
    const text = readFileSync(file, "utf8");
    assert.equal(
      /from\s+["']openclaw(?:\/[^"']*)?["']/.test(text),
      false,
      `${file} must not import openclaw`,
    );
    assert.equal(
      /require\(\s*["']openclaw(?:\/[^"']*)?["']\s*\)/.test(text),
      false,
      `${file} must not require openclaw`,
    );
  }
}

describe("library consumer smoke (no OpenClaw peer)", () => {
  it("enforcement-core and trust-core omit openclaw from manifests and sources", () => {
    assertNoOpenclawDependency(
      join(REPO_ROOT, "packages/enforcement-core/package.json"),
    );
    assertNoOpenclawDependency(
      join(REPO_ROOT, "packages/trust-core/package.json"),
    );
    assertNoOpenclawDependency(
      join(REPO_ROOT, "packages/steward-auth-core/package.json"),
    );
    assertNoOpenclawImport(join(REPO_ROOT, "packages/enforcement-core/src"));
    assertNoOpenclawImport(join(REPO_ROOT, "packages/trust-core/src"));
    assertNoOpenclawImport(join(REPO_ROOT, "packages/steward-auth-core/src"));
    assert.equal(ENFORCEMENT_NAME, "@ovrsr/fpp-enforcement-core");
    assert.equal(TRUST_NAME, "@ovrsr/fpp-trust-core");
  });

  it("classify + resolveDisposition + createTrustStack run without openclaw", () => {
    const classification = classifyToolCall("shell_exec", {
      command: "npm install some-package",
    });
    assert.equal(classification.classification, "pkg.install");

    const disposition = resolveDisposition({
      classification,
      config: { ...DEFAULT_CONFIG, dispositionMode: "unattended" },
    });
    assert.ok(
      disposition.disposition === "allow_staged" ||
        disposition.disposition === "abstain" ||
        disposition.disposition === "require_approval" ||
        disposition.disposition === "deny" ||
        disposition.disposition === "allow",
    );

    const dir = mkdtempSync(join(tmpdir(), "fpp-library-smoke-"));
    try {
      const stack = createTrustStack({
        identityKeyPath: join(dir, "identity.key"),
        trustGraphPath: join(dir, "trust-graph.json"),
        auditLogPath: join(dir, "audit.jsonl"),
        fallbackAuditLogPath: null,
        receiptLogPath: join(dir, "receipts.jsonl"),
        strictModeStatePath: join(dir, "strict.json"),
        replayCachePath: join(dir, "replay.json"),
        mandateStorePath: join(dir, "mandates.json"),
        quorumStatePath: join(dir, "quorum.json"),
      });
      assert.match(stack.identity.agentId, /^fpp:/);
      assert.equal(typeof stack.handshake.issueChallenge, "function");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
