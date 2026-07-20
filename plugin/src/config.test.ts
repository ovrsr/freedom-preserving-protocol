import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  validateManifestDefaults,
  diagnoseConfigSafety,
} from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, "..", "openclaw.plugin.json");

describe("manifest / runtime default parity", () => {
  it("openclaw.plugin.json defaults match DEFAULT_CONFIG", () => {
    const result = validateManifestDefaults(MANIFEST_PATH);
    assert.equal(
      result.ok,
      true,
      result.mismatches.join("\n") || "manifest drift",
    );
  });

  it("validateManifestDefaults reports missing and mismatched defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "fpp-manifest-"));
    try {
      const path = join(dir, "openclaw.plugin.json");
      writeFileSync(
        path,
        JSON.stringify({
          configSchema: {
            properties: {
              // omit most keys → missing-default path
              dispositionMode: { default: "operator-present" }, // mismatch vs DEFAULT_CONFIG
              auditLogPath: { default: ".openclaw/workspace/fpp-audit.jsonl" }, // path-equivalent OK
            },
          },
        }),
        "utf8",
      );
      const result = validateManifestDefaults(path);
      assert.equal(result.ok, false);
      assert.ok(
        result.mismatches.some((m) => /missing default/i.test(m)),
        result.mismatches.join("\n"),
      );
      assert.ok(
        result.mismatches.some((m) => /dispositionMode:/.test(m)),
        result.mismatches.join("\n"),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("diagnoseConfigSafety flags unsafe legacy-style settings", () => {
    const diags = diagnoseConfigSafety({
      approvalTimeoutBehavior: "allow",
      blockOn: [],
      acknowledgeDangerousOverrides: false,
    });
    assert.ok(diags.some((d) => d.code === "DANGEROUS_TIMEOUT_ALLOW"));
    assert.ok(diags.some((d) => d.code === "DANGEROUS_BLOCK_DOWNGRADE"));
  });

  it("DEFAULT_CONFIG is imported from enforcement-core", () => {
    assert.equal(DEFAULT_CONFIG.dispositionMode, "unattended");
  });

  it("DEFAULT_CONFIG knownCustomTools is empty; runtime includes fpp.governance id", async () => {
    assert.deepEqual(DEFAULT_CONFIG.knownCustomTools, []);
    const { CLASSIFICATION_IDS } = await import("@ovrsr/fpp-enforcement-core");
    assert.ok(CLASSIFICATION_IDS.includes("fpp.governance"));
  });

  it("declares outOfWorkspacePaths as an exact string-valued map defaulting to {}", () => {
    assert.deepEqual(DEFAULT_CONFIG.outOfWorkspacePaths, {});
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      configSchema: {
        additionalProperties: boolean;
        properties: Record<
          string,
          {
            type?: string;
            additionalProperties?: { type?: string } | boolean;
            default?: unknown;
            description?: string;
          }
        >;
      };
    };
    assert.equal(manifest.configSchema.additionalProperties, false);
    const prop = manifest.configSchema.properties.outOfWorkspacePaths;
    assert.ok(prop, "manifest must declare outOfWorkspacePaths");
    assert.equal(prop.type, "object");
    assert.deepEqual(prop.default, {});
    assert.deepEqual(prop.additionalProperties, { type: "string" });
    assert.match(String(prop.description), /exact/i);
    assert.doesNotMatch(String(prop.description), /\*|glob|prefix|directory/i);
  });
});
