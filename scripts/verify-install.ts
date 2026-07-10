#!/usr/bin/env tsx
/**
 * verify-install.ts
 *
 * End-to-end installation check. Answers the question:
 *   "Did the adoption actually take, and what layer is active?"
 *
 * Checks (in order, fail-soft — every check is reported even if earlier ones fail):
 *   1. constitution.json exists and matches the expected hash.
 *   2. signature.ed25519.txt verifies against pubkey.ed25519.txt over the hash.
 *   3. SOUL.md (if --soul given) contains the adoption marker.
 *   4. MEMORY.md (if --memory given) contains the adoption marker.
 *   5. Audit log (default .openclaw/workspace/constitution-audit.jsonl) chain verifies.
 *   6. The enforcement and trust plugins are checked by invoking
 *      `openclaw plugins list --json` if `openclaw` is on PATH. Absence is
 *      reported as a warning — not an adoption failure.
 *
 * Output: human-readable by default; --json for machine consumption.
 * Exit codes:
 *   0  all required checks passed (signature + SOUL + MEMORY if requested)
 *   1  one or more required checks failed
 *   2  usage error
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { sha256 } from "@noble/hashes/sha256";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
import { verify as verifyAuditChain } from "./audit-verify.ts";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "..");

const DEFAULT_EXPECTED_CONSTITUTION_HASH =
  "71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993";
const ADOPTION_MARKER = "Freedom Preserving Protocol";
const ENFORCEMENT_PLUGIN_ID_CANDIDATES = [
  "openclaw-fpp-plugin",
  "ovrsr/openclaw-fpp-plugin",
  "@ovrsr/openclaw-fpp-plugin",
  "fpp",
];
const TRUST_PLUGIN_ID_CANDIDATES = [
  "openclaw-fpp-trust",
  "ovrsr/openclaw-fpp-trust",
  "@ovrsr/openclaw-fpp-trust",
];

export type CheckStatus = "pass" | "fail" | "skip" | "warn";
export type Check = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
};

export type Report = {
  ok: boolean;
  checks: Check[];
  summary: {
    promptLayerActive: boolean;
    dispatcherLayerActive: boolean;
    trustLayerActive: boolean;
  };
};

export type PluginListResult = {
  available: boolean;
  stdout?: string;
  stderr?: string;
};

export type PluginLister = () => PluginListResult;

export type VerifyInstallOptions = {
  rootDir?: string;
  soul?: string;
  memory?: string;
  log?: string;
  expectedConstitutionHash?: string;
  pluginLister?: PluginLister;
  /** Optional enforcement plugin config to diagnose (never rewritten). */
  enforcementConfig?: Record<string, unknown>;
  /** Optional trust plugin config to diagnose (never rewritten). */
  trustConfig?: Record<string, unknown>;
};

function parseArgs(argv: string[]): {
  soul?: string;
  memory?: string;
  log: string;
  json: boolean;
} {
  let soul: string | undefined;
  let memory: string | undefined;
  let log = ".openclaw/workspace/constitution-audit.jsonl";
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--soul") soul = argv[++i];
    else if (a === "--memory") memory = argv[++i];
    else if (a === "--log") log = argv[++i];
    else if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: npm run verify-install -- [options]

Options:
  --soul    <path>   Check that SOUL.md contains the adoption block
  --memory  <path>   Check that MEMORY.md contains the adoption entry
  --log     <path>   Audit log path (default .openclaw/workspace/constitution-audit.jsonl)
  --json             Emit a machine-readable JSON report on stdout
  -h, --help         This help`);
      process.exit(0);
    }
  }
  return { soul, memory, log, json };
}

function checkConstitution(rootDir: string, expectedHash: string): Check {
  try {
    const bytes = readFileSync(resolve(rootDir, "constitution.json"));
    const hash = bytesToHex(sha256(bytes));
    if (hash !== expectedHash) {
      return {
        id: "constitution.hash",
        label: "Constitution hash",
        status: "fail",
        detail: `got ${hash}, expected ${expectedHash}`,
      };
    }
    return {
      id: "constitution.hash",
      label: "Constitution hash",
      status: "pass",
      detail: hash,
    };
  } catch (e) {
    return {
      id: "constitution.hash",
      label: "Constitution hash",
      status: "fail",
      detail: (e as Error).message,
    };
  }
}

function checkSignature(rootDir: string): Check {
  try {
    const bytes = readFileSync(resolve(rootDir, "constitution.json"));
    const hash = sha256(bytes);
    const sig = readFileSync(resolve(rootDir, "signature.ed25519.txt"), "utf-8").trim();
    const pub = readFileSync(resolve(rootDir, "pubkey.ed25519.txt"), "utf-8").trim();
    const ok = ed.verify(hexToBytes(sig), hash, hexToBytes(pub));
    return {
      id: "constitution.signature",
      label: "Ed25519 signature",
      status: ok ? "pass" : "fail",
      detail: ok ? `pubkey=${pub}` : "signature does not verify",
    };
  } catch (e) {
    return {
      id: "constitution.signature",
      label: "Ed25519 signature",
      status: "fail",
      detail: (e as Error).message,
    };
  }
}

function checkMarker(path: string, id: string, label: string): Check {
  if (!existsSync(path)) {
    return {
      id,
      label,
      status: "fail",
      detail: `file not found: ${path}`,
    };
  }
  const content = readFileSync(path, "utf-8");
  const present = content.includes(ADOPTION_MARKER);
  return {
    id,
    label,
    status: present ? "pass" : "fail",
    detail: present
      ? `"${ADOPTION_MARKER}" found in ${path}`
      : `marker "${ADOPTION_MARKER}" not found in ${path}`,
  };
}

function checkAuditChain(logPath: string): Check {
  if (!existsSync(logPath)) {
    return {
      id: "audit.chain",
      label: "Audit chain",
      status: "skip",
      detail: `no audit log yet at ${logPath} — first heartbeat will create it`,
    };
  }
  const report = verifyAuditChain(logPath);
  if (report.ok) {
    return {
      id: "audit.chain",
      label: "Audit chain",
      status: "pass",
      detail: `hash-chained log verifies (${report.entries} entries)`,
    };
  }
  return {
    id: "audit.chain",
    label: "Audit chain",
    status: "fail",
    detail: `chain integrity failed: ${report.errors.slice(0, 2).join("; ")}`,
  };
}

function defaultPluginLister(): PluginListResult {
  const which = spawnSync(process.platform === "win32" ? "where" : "which", [
    "openclaw",
  ]);
  if (which.status !== 0) {
    return { available: false };
  }
  const list = spawnSync("openclaw", ["plugins", "list", "--json"], {
    encoding: "utf-8",
  });
  if (list.status !== 0) {
    return { available: false, stderr: list.stderr?.trim?.() ?? "" };
  }
  return { available: true, stdout: list.stdout };
}

function checkPluginInstalled(
  label: string,
  id: string,
  candidates: string[],
  installHint: string,
  lister: PluginLister,
): Check {
  const result = lister();
  if (!result.available) {
    const detail = result.stderr
      ? `openclaw plugins list failed: ${result.stderr}`
      : "openclaw CLI not on PATH; cannot check plugin installation.";
    return { id, label, status: "warn", detail };
  }
  const stdout = result.stdout ?? "";
  const present = candidates.some((candidate) => stdout.includes(candidate));
  return {
    id,
    label,
    status: present ? "pass" : "warn",
    detail: present
      ? `${label} appears in \`openclaw plugins list\``
      : `${label} NOT installed. Install with: ${installHint}`,
  };
}

function statusGlyph(s: CheckStatus): string {
  switch (s) {
    case "pass":
      return "[PASS]";
    case "fail":
      return "[FAIL]";
    case "warn":
      return "[WARN]";
    case "skip":
      return "[SKIP]";
  }
}

/**
 * @deprecated Use `VerifyInstallOptions` and `runVerifyInstall` instead.
 * Retained as an alias for backward compatibility with earlier test scaffolding.
 */
export type InstallCheckOptions = VerifyInstallOptions;

/**
 * @deprecated Use `runVerifyInstall` instead. This alias skips plugin-install
 * checks (uses a stub `pluginLister` that always returns `available: false`)
 * for backward compatibility with earlier test scaffolding.
 */
export function runInstallChecks(opts: InstallCheckOptions = {}): Report {
  return runVerifyInstall({
    ...opts,
    pluginLister: opts.pluginLister ?? (() => ({ available: false })),
  });
}

function checkEnforcementConfig(config: Record<string, unknown> | undefined): Check[] {
  if (!config) return [];
  const checks: Check[] = [];
  const ack = config.acknowledgeDangerousOverrides === true;

  if (config.approvalTimeoutBehavior === "allow") {
    checks.push({
      id: "config.enforcement.timeout",
      label: "Enforcement approval timeout policy",
      status: ack ? "warn" : "fail",
      detail: ack
        ? "approvalTimeoutBehavior=allow is acknowledged (fail-open on timeout)."
        : "approvalTimeoutBehavior=allow requires acknowledgeDangerousOverrides: true. " +
          "Config file was not rewritten; set the flag explicitly if intentional.",
    });
  }

  const defaultBlocks = [
    "fs.delete.protected",
    "exec.cred-exfil",
    "gateway.restart",
  ];
  if (Array.isArray(config.blockOn)) {
    const blockOn = config.blockOn as string[];
    const missing = defaultBlocks.filter((id) => !blockOn.includes(id));
    if (missing.length > 0) {
      checks.push({
        id: "config.enforcement.blockOn",
        label: "Enforcement hard-block coverage",
        status: ack ? "warn" : "fail",
        detail: ack
          ? `blockOn omits default hard-blocks (${missing.join(", ")}) — acknowledged.`
          : `blockOn omits default hard-blocks (${missing.join(", ")}). ` +
            "Requires acknowledgeDangerousOverrides: true. Config file was not rewritten.",
      });
    }
  }

  return checks;
}

function checkTrustConfig(config: Record<string, unknown> | undefined): Check[] {
  if (!config) return [];
  const checks: Check[] = [];
  const ack = config.acknowledgeDangerousOverrides === true;

  if (config.verificationPolicy === "legacy-unsafe") {
    checks.push({
      id: "config.trust.legacy",
      label: "Trust verification policy",
      status: ack ? "warn" : "fail",
      detail: ack
        ? "verificationPolicy=legacy-unsafe is acknowledged (visibly weaker)."
        : "verificationPolicy=legacy-unsafe requires acknowledgeDangerousOverrides: true. " +
          "Without acknowledgement, runtime fails closed to hardened-v2. Config file was not rewritten.",
    });
  }

  return checks;
}

export function runVerifyInstall(options: VerifyInstallOptions = {}): Report {
  const rootDir = options.rootDir ?? DEFAULT_ROOT;
  const expectedHash =
    options.expectedConstitutionHash ?? DEFAULT_EXPECTED_CONSTITUTION_HASH;
  const lister = options.pluginLister ?? defaultPluginLister;
  const logPath = options.log ?? ".openclaw/workspace/constitution-audit.jsonl";

  const checks: Check[] = [];

  checks.push(checkConstitution(rootDir, expectedHash));
  checks.push(checkSignature(rootDir));

  if (options.soul) {
    checks.push(
      checkMarker(resolve(options.soul), "soul.marker", "SOUL adoption block"),
    );
  } else {
    checks.push({
      id: "soul.marker",
      label: "SOUL adoption block",
      status: "skip",
      detail: "no --soul path provided",
    });
  }

  if (options.memory) {
    checks.push(
      checkMarker(
        resolve(options.memory),
        "memory.marker",
        "MEMORY adoption entry",
      ),
    );
  } else {
    checks.push({
      id: "memory.marker",
      label: "MEMORY adoption entry",
      status: "skip",
      detail: "no --memory path provided",
    });
  }

  checks.push(checkAuditChain(resolve(logPath)));
  checks.push(
    checkPluginInstalled(
      "Dispatcher-layer enforcement plugin",
      "plugin.enforcement.installed",
      ENFORCEMENT_PLUGIN_ID_CANDIDATES,
      "openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin",
      lister,
    ),
  );
  checks.push(
    checkPluginInstalled(
      "Dispatcher-layer trust plugin",
      "plugin.trust.installed",
      TRUST_PLUGIN_ID_CANDIDATES,
      "openclaw plugins install clawhub:ovrsr/openclaw-fpp-trust",
      lister,
    ),
  );

  checks.push(...checkEnforcementConfig(options.enforcementConfig));
  checks.push(...checkTrustConfig(options.trustConfig));

  const requiredIds = new Set<string>([
    "constitution.hash",
    "constitution.signature",
    ...(options.soul ? ["soul.marker"] : []),
    ...(options.memory ? ["memory.marker"] : []),
  ]);
  const requiredOk = checks
    .filter((c) => requiredIds.has(c.id))
    .every((c) => c.status === "pass");

  const promptLayerActive =
    checks.find((c) => c.id === "soul.marker")?.status === "pass" ||
    checks.find((c) => c.id === "memory.marker")?.status === "pass";
  const dispatcherLayerActive =
    checks.find((c) => c.id === "plugin.enforcement.installed")?.status ===
    "pass";
  const trustLayerActive =
    checks.find((c) => c.id === "plugin.trust.installed")?.status === "pass";

  return {
    ok: requiredOk,
    checks,
    summary: { promptLayerActive, dispatcherLayerActive, trustLayerActive },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = runVerifyInstall({
    soul: args.soul,
    memory: args.memory,
    log: args.log,
  });
  const promptLayerActive = report.summary.promptLayerActive;
  const dispatcherLayerActive = report.summary.dispatcherLayerActive;
  const trustLayerActive = report.summary.trustLayerActive;
  const checks = report.checks;

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("Freedom Preserving Protocol — installation check\n");
    for (const c of checks) {
      console.log(`${statusGlyph(c.status)} ${c.label}`);
      console.log(`        ${c.detail}`);
    }
    console.log("");
    console.log(
      `Prompt-layer governance:     ${promptLayerActive ? "ACTIVE" : "not active"}`,
    );
    console.log(
      `Dispatcher-layer governance: ${dispatcherLayerActive ? "ACTIVE" : "not active"}`,
    );
    console.log(
      `Trust layer:                 ${trustLayerActive ? "ACTIVE" : "not active"}`,
    );
    console.log("");
    if (!dispatcherLayerActive) {
      console.log(
        "Note: without the dispatcher-layer enforcement plugin, the five-question gate can be bypassed by prompt injection or a hostile skill. Install the plugin for `before_tool_call` enforcement:",
      );
      console.log(
        "  openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin",
      );
    }
    if (!trustLayerActive) {
      console.log(
        "Note: without the trust plugin, agent-to-agent constitutional handshakes and trust graph verification are not active:",
      );
      console.log(
        "  openclaw plugins install clawhub:ovrsr/openclaw-fpp-trust",
      );
    }
    console.log(`\nOverall: ${report.ok ? "PASS" : "FAIL"}`);
  }

  process.exit(report.ok ? 0 : 1);
}

const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`;

if (isDirectInvocation) {
  main();
}
