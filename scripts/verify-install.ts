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
import {
  computePeerAdvertisability,
  currentAdoptionState,
  readAdoptionHistory,
  type AdoptionProbeEvidence,
} from "./adoption-state.ts";
import { resolveEnforcementGradeForProfile } from "./safe-append.ts";
import { workspaceFile } from "./skill-lib/index.ts";

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

export type RuntimeProbeStatus = "active" | "inactive" | "unknown";
export type RuntimeProbe = {
  harnessId: string;
  probe: () => RuntimeProbeStatus | Promise<RuntimeProbeStatus>;
};
export type RuntimeProbeResult = {
  harnessId: string;
  status: RuntimeProbeStatus;
};

export type Report = {
  ok: boolean;
  checks: Check[];
  summary: {
    promptLayerActive: boolean;
    dispatcherLayerActive: boolean;
    trustLayerActive: boolean;
    /** Local constitutional self-binding (lifecycle accepted). */
    localAcceptanceActive: boolean;
    /** Peer-advertisable acceptance (probe-backed, grade-capped). */
    peerAdvertisableActive: boolean;
    enforcementGrade?: string | undefined;
  };
  /** Graded harness probe results (active / inactive / unknown). */
  probes: RuntimeProbeResult[];
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
  /** Workspace profile: openclaw (default) or generic. */
  profile?: string;
  /**
   * Optional harness probes. When omitted, the default OpenClaw probe runs.
   * Inject custom probes for non-OpenClaw harnesses or tests.
   */
  probes?: RuntimeProbe[];
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
  profile: string;
} {
  let soul: string | undefined;
  let memory: string | undefined;
  let log: string | undefined;
  let json = false;
  let profile = "openclaw";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--soul") soul = argv[++i];
    else if (a === "--memory") memory = argv[++i];
    else if (a === "--log") log = argv[++i];
    else if (a === "--profile") profile = argv[++i] ?? "openclaw";
    else if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: npm run verify-install -- [options]

Options:
  --soul    <path>   Check that SOUL.md contains the adoption block
  --memory  <path>   Check that MEMORY.md contains the adoption entry
  --log     <path>   Audit log path (default: <workspace>/constitution-audit.jsonl)
  --profile <id>     Workspace/harness profile: openclaw (default), generic,
                     cursor, claude-code, codex (unknown → warn, not false PASS)
  --json             Emit a machine-readable JSON report on stdout
  -h, --help         This help

Environment:
  FPP_WORKSPACE      Override workspace root for any profile`);
      process.exit(0);
    }
  }
  // Deferred import keeps script load light when only --help is used.
  return { soul, memory, log: log ?? "", json, profile };
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

/**
 * OpenClaw harness probe: active when the enforcement plugin appears in
 * `openclaw plugins list`; inactive when the CLI is present but the plugin
 * is missing; unknown when the CLI cannot be queried.
 */
export function createOpenClawRuntimeProbe(
  lister: PluginLister = defaultPluginLister,
): RuntimeProbe {
  return {
    harnessId: "openclaw",
    probe: (): RuntimeProbeStatus => {
      const result = lister();
      if (!result.available) return "unknown";
      const stdout = result.stdout ?? "";
      const enforcementPresent = ENFORCEMENT_PLUGIN_ID_CANDIDATES.some((c) =>
        stdout.includes(c),
      );
      return enforcementPresent ? "active" : "inactive";
    },
  };
}

const ADAPTER_PACKAGE_BY_PROFILE: Record<string, string> = {
  cursor: "@ovrsr/fpp-adapter-cursor",
  "claude-code": "@ovrsr/fpp-adapter-claude-code",
  codex: "@ovrsr/fpp-adapter-codex",
};

const ADAPTER_DIR_BY_PROFILE: Record<string, string> = {
  cursor: "adapters/cursor",
  "claude-code": "adapters/claude-code",
  codex: "adapters/codex",
};

export type AdapterProbeOptions = {
  /** Repo / install root used to locate adapter packages. */
  rootDir?: string | undefined;
  /** Override presence check (tests). */
  isPresent?: (() => boolean) | undefined;
};

/**
 * Probe for Cursor / Claude Code / Codex adapters: active when the adapter
 * package directory (or injectable presence check) is found; otherwise unknown.
 * Never reports a false dispatcher PASS for an unknown harness.
 */
export function createHookAdapterProbe(
  harnessId: string,
  options: AdapterProbeOptions = {},
): RuntimeProbe {
  return {
    harnessId,
    probe: (): RuntimeProbeStatus => {
      if (options.isPresent) {
        return options.isPresent() ? "active" : "inactive";
      }
      const root = options.rootDir ?? DEFAULT_ROOT;
      const rel = ADAPTER_DIR_BY_PROFILE[harnessId];
      if (!rel) return "unknown";
      const pkgJson = resolve(root, rel, "package.json");
      if (!existsSync(pkgJson)) return "inactive";
      try {
        const name = JSON.parse(readFileSync(pkgJson, "utf8")).name as string;
        const expected = ADAPTER_PACKAGE_BY_PROFILE[harnessId];
        return expected && name === expected ? "active" : "inactive";
      } catch {
        return "unknown";
      }
    },
  };
}

/**
 * Select default runtime probes for a verify-install profile.
 * Unknown profiles get a single warn/unknown probe — never a false dispatcher PASS.
 */
export function defaultProbesForProfile(
  profile: string,
  options: {
    pluginLister?: PluginLister | undefined;
    rootDir?: string | undefined;
  } = {},
): RuntimeProbe[] {
  const lister = options.pluginLister ?? defaultPluginLister;
  const rootDir = options.rootDir ?? DEFAULT_ROOT;

  if (profile === "openclaw" || profile === "generic") {
    return [createOpenClawRuntimeProbe(lister)];
  }
  if (profile === "cursor" || profile === "claude-code" || profile === "codex") {
    return [createHookAdapterProbe(profile, { rootDir })];
  }
  // Unknown harness: honest unknown, not OpenClaw plugin inventory.
  return [
    {
      harnessId: profile,
      probe: (): RuntimeProbeStatus => "unknown",
    },
  ];
}

function probeStatusToCheck(
  harnessId: string,
  status: RuntimeProbeStatus,
  profile: string,
): Check {
  const id = `runtime.probe.${harnessId}`;
  const label = `Runtime probe (${harnessId})`;
  if (status === "active") {
    return {
      id,
      label,
      status: "pass",
      detail: `${harnessId} harness probe: active`,
    };
  }
  if (status === "inactive") {
    return {
      id,
      label,
      status: "warn",
      detail: `${harnessId} harness probe: inactive (harness present; dispatcher not installed)`,
    };
  }
  // unknown
  const genericHint =
    profile === "generic"
      ? "Dispatcher layer not verified for this profile — not an OpenClaw-only failure."
      : "Harness status unknown (CLI or probe surface unavailable).";
  return {
    id,
    label,
    status: "warn",
    detail: `${harnessId} harness probe: unknown. ${genericHint}`,
  };
}

function checkPluginInstalled(
  label: string,
  id: string,
  candidates: string[],
  installHint: string,
  lister: PluginLister,
  profile: string,
): Check {
  const result = lister();
  if (!result.available) {
    if (profile === "generic") {
      return {
        id,
        label,
        status: "warn",
        detail:
          "OpenClaw CLI not present; plugin install status unknown for generic profile (not an OpenClaw-only failure).",
      };
    }
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
  const profile = options.profile ?? "openclaw";
  const logPath = options.log ?? ".openclaw/workspace/constitution-audit.jsonl";
  const probesToRun: RuntimeProbe[] =
    options.probes ??
    defaultProbesForProfile(profile, {
      pluginLister: lister,
      rootDir,
    });

  const checks: Check[] = [];
  const probeResults: RuntimeProbeResult[] = [];

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

  // Graded harness probes (OpenClaw by default; inject others for non-OpenClaw).
  for (const runtimeProbe of probesToRun) {
    const status = runtimeProbe.probe() as RuntimeProbeStatus;
    probeResults.push({ harnessId: runtimeProbe.harnessId, status });
    checks.push(probeStatusToCheck(runtimeProbe.harnessId, status, profile));
  }

  // Detailed OpenClaw plugin inventory when the OpenClaw probe is in the set.
  // Custom probe lists that omit openclaw skip this (no OpenClaw-only failure implied).
  const includesOpenClawProbe = probesToRun.some(
    (p) => p.harnessId === "openclaw",
  );
  if (includesOpenClawProbe) {
    checks.push(
      checkPluginInstalled(
        "Dispatcher-layer enforcement plugin",
        "plugin.enforcement.installed",
        ENFORCEMENT_PLUGIN_ID_CANDIDATES,
        "openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin",
        lister,
        profile,
      ),
    );
    checks.push(
      checkPluginInstalled(
        "Dispatcher-layer trust plugin",
        "plugin.trust.installed",
        TRUST_PLUGIN_ID_CANDIDATES,
        "openclaw plugins install clawhub:ovrsr/openclaw-fpp-trust",
        lister,
        profile,
      ),
    );
  }

  checks.push(...checkEnforcementConfig(options.enforcementConfig));
  checks.push(...checkTrustConfig(options.trustConfig));

  // Distinguish installation vs constitutional adoption vs enforcement.
  const adoptionLog = resolve(
    dirname(resolve(logPath)),
    "fpp-adoption-state.jsonl",
  );
  let localAcceptanceActive = false;
  let peerAdvertisableActive = false;
  let enforcementGrade: string | undefined;
  try {
    const state = currentAdoptionState(adoptionLog);
    localAcceptanceActive = state === "accepted";
    checks.push({
      id: "adoption.state",
      label: "Machine-readable adoption state (local)",
      status: state === "none" ? "warn" : "pass",
      detail:
        state === "none"
          ? `no adoption-state ledger at ${adoptionLog} (installation ≠ acceptance)`
          : `current state=${state} (installation, adoption, and enforcement are distinct)`,
    });
    if (state === "externally-enforced") {
      checks.push({
        id: "adoption.externally-enforced",
        label: "Externally enforced (not voluntary accepted)",
        status: "warn",
        detail:
          "Peer claims must not advertise externally-enforced as voluntary accepted",
      });
    }

    const history = readAdoptionHistory(adoptionLog);
    const last = history.at(-1)?.record;
    if (last && last.schemaVersion === 2) {
      enforcementGrade = last.enforcementGrade;
    } else if (state === "accepted" || state === "reviewed") {
      enforcementGrade = resolveEnforcementGradeForProfile(profile, rootDir);
    }

    if (enforcementGrade) {
      checks.push({
        id: "adoption.enforcement-grade",
        label: "Enforcement grade (harness-scoped)",
        status: "pass",
        detail: `enforcementGrade=${enforcementGrade} harnessId=${
          last && last.schemaVersion === 2 ? last.harnessId : profile
        }`,
      });
    }

    const anyProbeActive = probeResults.some((p) => p.status === "active");
    const probeEvidence: AdoptionProbeEvidence | undefined = anyProbeActive
      ? {
          passed: true,
          preToolHook: anyProbeActive,
          toolProxy: false,
        }
      : undefined;

    if (last) {
      const peer = computePeerAdvertisability(last, probeEvidence);
      peerAdvertisableActive = peer.peerAdvertisable;
      checks.push({
        id: "adoption.peer-advertisable",
        label: "Peer-advertisable acceptance",
        status: peer.peerAdvertisable
          ? "pass"
          : localAcceptanceActive
            ? "warn"
            : "skip",
        detail: peer.peerAdvertisable
          ? `assurance=${peer.assurance} (${peer.reason})`
          : `NOT peer-advertisable: ${peer.reason}. Local acceptance may still be active.`,
      });

      if (
        localAcceptanceActive &&
        (enforcementGrade === "prompt-only" || enforcementGrade === "none")
      ) {
        checks.push({
          id: "adoption.peer-compliance-claim",
          label: "Peer compliance claim (dispatcher)",
          status: "fail",
          detail: `grade=${enforcementGrade}: local accepted OK; must NOT claim dispatcher/peer compliance (declaration-only ceiling)`,
        });
      }
    } else {
      checks.push({
        id: "adoption.peer-advertisable",
        label: "Peer-advertisable acceptance",
        status: "skip",
        detail: "no adoption ledger record to evaluate",
      });
    }
  } catch (err) {
    checks.push({
      id: "adoption.state",
      label: "Machine-readable adoption state (local)",
      status: "warn",
      detail: `adoption-state read failed: ${(err as Error).message}`,
    });
  }

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

  const openclawProbeActive = probeResults.some(
    (p) => p.harnessId === "openclaw" && p.status === "active",
  );
  const anyProbeActive = probeResults.some((p) => p.status === "active");
  const dispatcherLayerActive =
    checks.find((c) => c.id === "plugin.enforcement.installed")?.status ===
      "pass" ||
    openclawProbeActive ||
    (anyProbeActive &&
      !probeResults.some((p) => p.harnessId === "openclaw"));
  const trustLayerActive =
    checks.find((c) => c.id === "plugin.trust.installed")?.status === "pass";

  return {
    ok: requiredOk,
    checks,
    summary: {
      promptLayerActive,
      dispatcherLayerActive,
      trustLayerActive,
      localAcceptanceActive,
      peerAdvertisableActive,
      enforcementGrade,
    },
    probes: probeResults,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const log =
    args.log ||
    workspaceFile("constitution-audit.jsonl", { profile: args.profile });
  const report = runVerifyInstall({
    soul: args.soul,
    memory: args.memory,
    log,
    profile: args.profile,
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
    console.log(
      `Local acceptance:            ${report.summary.localAcceptanceActive ? "ACTIVE" : "not active"}`,
    );
    console.log(
      `Peer-advertisable acceptance:${report.summary.peerAdvertisableActive ? " ACTIVE" : " not active"}` +
        (report.summary.enforcementGrade
          ? ` (grade=${report.summary.enforcementGrade})`
          : ""),
    );
    console.log("");
    if (!dispatcherLayerActive) {
      console.log(
        "Note: without a dispatcher-layer adapter (OpenClaw plugin or harness hooks), the five-question gate can be bypassed by prompt injection or a hostile skill.",
      );
      if (args.profile === "openclaw" || args.profile === "generic") {
        console.log(
          "  openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin",
        );
      } else {
        console.log(
          `  See adapters/${args.profile}/ and docs/runbooks/${args.profile}.md`,
        );
      }
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
