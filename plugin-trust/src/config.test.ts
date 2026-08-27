import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { mergeTrustConfig } from "@ovrsr/fpp-trust-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, "..", "openclaw.plugin.json");

describe("steward plugin configuration contract", () => {
  it("recognizes the ledger path and optional stable audience consistently", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      configSchema: {
        properties: Record<string, {
          type?: string;
          minLength?: number;
          pattern?: string;
          default?: unknown;
        }>;
      };
    };
    const properties = manifest.configSchema.properties;

    assert.equal(properties.stewardAuthorizationLedgerPath?.type, "string");
    assert.equal(
      properties.stewardAuthorizationLedgerPath?.default,
      ".openclaw/workspace/fpp-steward-authorization-ledger.jsonl",
    );
    assert.equal(properties.stewardInstanceAudience?.type, "string");
    assert.equal(properties.stewardInstanceAudience?.minLength, 1);
    assert.ok(properties.stewardInstanceAudience?.pattern);
    assert.equal(properties.stewardInstanceAudience?.default, undefined);

    const runtime = mergeTrustConfig({
      stewardAuthorizationLedgerPath:
        ".openclaw/workspace/config-contract-ledger.jsonl",
      stewardInstanceAudience: "instance:config-contract",
    });
    assert.match(
      runtime.stewardAuthorizationLedgerPath.replace(/\\/g, "/"),
      /\/\.openclaw\/workspace\/config-contract-ledger\.jsonl$/,
    );
    assert.equal(
      runtime.stewardInstanceAudience,
      "instance:config-contract",
    );
  });
});
