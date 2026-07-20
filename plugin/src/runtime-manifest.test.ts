import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeConfig } from "./config.js";
import {
  buildRuntimeManifest,
  readOpenClawPackageBuild,
} from "./runtime-manifest.js";

describe("OpenClaw runtime-manifest adapter", () => {
  it("readOpenClawPackageBuild binds plugin package identity", () => {
    const build = readOpenClawPackageBuild();
    assert.equal(build.name, "@ovrsr/openclaw-fpp-plugin");
    assert.match(build.version, /^\d+\.\d+\.\d+/);
    assert.notEqual(build.pluginApi, "unknown");
  });

  it("buildRuntimeManifest injects package build and optional degradedReason", () => {
    const config = mergeConfig({ respectTrustStrictMode: false });
    const live = buildRuntimeManifest({
      config,
      constitutionHash: config.constitutionHash,
      degraded: false,
    });
    assert.equal(live.runtimeState, "ok");
    assert.ok(live.packageBuildHash);

    const degraded = buildRuntimeManifest({
      config,
      constitutionHash: config.constitutionHash,
      degraded: true,
      degradedReason: "test-degraded",
    });
    assert.equal(degraded.runtimeState, "degraded");
    assert.equal(degraded.degradedReason, "test-degraded");
  });
});
