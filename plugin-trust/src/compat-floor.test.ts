/**
 * OpenClaw compatibility floor — refuse GHSA-affected <=2026.3.24 range.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("OpenClaw compat floor", () => {
  it("declares minGatewayVersion / peerDep at or above 2026.3.28", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as {
      openclaw?: {
        compat?: { pluginApi?: string; minGatewayVersion?: string };
      };
      peerDependencies?: { openclaw?: string };
    };
    assert.equal(pkg.openclaw?.compat?.minGatewayVersion, "2026.3.28");
    assert.equal(pkg.openclaw?.compat?.pluginApi, ">=2026.3.28");
    assert.equal(pkg.peerDependencies?.openclaw, ">=2026.3.28");
  });
});
