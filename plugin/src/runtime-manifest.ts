/**
 * OpenClaw adapter: bind plugin package.json identity into the shared
 * runtime manifest builder from @ovrsr/fpp-enforcement-core.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRuntimeManifest as buildCoreRuntimeManifest,
  computeClassifierRulesetHash,
  computeEffectiveConfigHash,
  computePackageBuildHash,
  type FppPluginConfig,
  type PackageBuildInput,
  type RuntimeManifest,
} from "@ovrsr/fpp-enforcement-core";

export {
  computeClassifierRulesetHash,
  computeEffectiveConfigHash,
  computePackageBuildHash,
  type PackageBuildInput,
  type RuntimeManifest,
} from "@ovrsr/fpp-enforcement-core";

const __dirname = dirname(fileURLToPath(import.meta.url));

let cachedPkg: {
  name: string;
  version: string;
  openclaw?: {
    compat?: { pluginApi?: string; minGatewayVersion?: string };
    build?: { openclawVersion?: string };
  };
} | null = null;

function readPluginPackage(): NonNullable<typeof cachedPkg> {
  if (cachedPkg) return cachedPkg;
  const pkgPath = join(__dirname, "..", "package.json");
  cachedPkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  return cachedPkg!;
}

export function readOpenClawPackageBuild(): PackageBuildInput {
  const pkg = readPluginPackage();
  return {
    name: pkg.name,
    version: pkg.version,
    pluginApi: pkg.openclaw?.compat?.pluginApi ?? "unknown",
    minGatewayVersion: pkg.openclaw?.compat?.minGatewayVersion ?? "unknown",
    openclawVersion: pkg.openclaw?.build?.openclawVersion,
  };
}

export function buildRuntimeManifest(input: {
  config: FppPluginConfig;
  constitutionHash: string;
  degraded: boolean;
  degradedReason?: string | undefined;
}): RuntimeManifest {
  return buildCoreRuntimeManifest({
    ...input,
    packageBuild: readOpenClawPackageBuild(),
  });
}
