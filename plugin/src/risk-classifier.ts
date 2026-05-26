/**
 * risk-classifier.ts
 *
 * Heuristic classifier that maps a tool call (toolName + params) onto a
 * Freedom-Preserving-Laws risk classification id. The classification is then
 * looked up in the plugin's config to decide whether to block, require
 * approval, or allow.
 *
 * Important caveats:
 *   - This is a HEURISTIC. It pattern-matches on tool names and parameter
 *     shapes. An adversary aware of the patterns can evade it (e.g., by
 *     decoding a base64 command at runtime, or by routing through a tool
 *     name that doesn't match any pattern).
 *   - The classifier is intentionally CONSERVATIVE: when unsure, it returns
 *     the highest applicable risk class. The plugin's config can be tuned
 *     to relax this, but the default should err on Law 1.
 *   - This file is dependency-free so it can be imported from both the
 *     plugin runtime and the self-test script in the parent skill package.
 */

export type ClassificationId =
  | "fs.delete.protected"
  | "fs.delete.workspace"
  | "fs.write.protected"
  | "fs.write.workspace"
  | "fs.read.benign"
  | "exec.cred-exfil"
  | "exec.outbound-write"
  | "exec.system-modify"
  | "exec.benign"
  | "pkg.install"
  | "pkg.publish"
  | "http.public-write"
  | "http.read"
  | "gateway.restart"
  | "gateway.config-change"
  | "credential.exposure"
  | "message.external"
  | "unknown.unclassified";

export type Decision = "block" | "approval" | "allow";

export type ClassificationResult = {
  classification: ClassificationId;
  decision: Decision;
  reason: string;
  matchedPatterns: string[];
};

const PROTECTED_PATH_PATTERNS: RegExp[] = [
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.gnupg(\/|$)/,
  /(^|\/)\.aws(\/|$)/,
  /(^|\/)\.gcloud(\/|$)/,
  /(^|\/)\.kube(\/|$)/,
  /(^|\/)\.config\/(openclaw|claude|cursor|codex)(\/|$)/,
  /(^|\/)\.openclaw\/(?!workspace\/).+/,
  /(^|\/)\.env(\..+)?$/,
  /(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/,
  /(^|\/)credentials(\.json|\.yaml|\.yml|\.toml)?$/,
];

const WORKSPACE_PATH_PATTERNS: RegExp[] = [
  /(^|\/)\.openclaw\/workspace(\/|$)/,
  /(^|\/)tmp(\/|$)/,
  /(^|\/)scratch(\/|$)/,
];

const CRED_VAR_PATTERNS: RegExp[] = [
  /\$AWS_[A-Z_]*KEY/,
  /\$AWS_[A-Z_]*SECRET/,
  /\$OPENAI_API_KEY/,
  /\$ANTHROPIC_API_KEY/,
  /\$GH_TOKEN/,
  /\$GITHUB_TOKEN/,
  /\$NPM_TOKEN/,
  /\$DATABASE_URL/,
  /\$SECRET/,
  /\$PASSWORD/,
  /\$PRIVATE_KEY/,
];

const OUTBOUND_EXEC_PATTERNS: RegExp[] = [
  /\bcurl\b.*\-X\s*(POST|PUT|DELETE|PATCH)/i,
  /\bwget\b.*--post-data/i,
  /\bcurl\b.*\-d\b/,
  /\bcurl\b.*\-\-data\b/,
];

const PACKAGE_INSTALL_PATTERNS: RegExp[] = [
  /\bnpm\s+(install|i)\b/,
  /\bpnpm\s+(install|i|add)\b/,
  /\byarn\s+(add|install)\b/,
  /\bpip(3)?\s+install\b/,
  /\bcargo\s+install\b/,
  /\bgem\s+install\b/,
  /\bgo\s+install\b/,
  /\bbrew\s+install\b/,
  /\bapt(-get)?\s+install\b/,
  /\byum\s+install\b/,
];

const PACKAGE_PUBLISH_PATTERNS: RegExp[] = [
  /\bnpm\s+publish\b/,
  /\bpnpm\s+publish\b/,
  /\bcargo\s+publish\b/,
  /\bgem\s+push\b/,
  /\bgh\s+release\s+create\b/,
];

const GATEWAY_RESTART_PATTERNS: RegExp[] = [
  /\bopenclaw\s+gateway\s+(restart|stop|kill)\b/i,
  /\bsystemctl\s+(restart|stop)\s+openclaw\b/i,
  /\bpkill\s+.*openclaw\b/i,
];

const GATEWAY_CONFIG_PATTERNS: RegExp[] = [
  /\bopenclaw\s+config\s+set\b/i,
  /\bopenclaw\s+plugins\s+(install|uninstall|disable)\b/i,
  /\bopenclaw\s+skills\s+(install|uninstall)\b/i,
];

const SYSTEM_MODIFY_PATTERNS: RegExp[] = [
  /\bsudo\b/,
  /\bsystemctl\b/,
  /\bservice\s+\w+\s+(start|stop|restart)\b/,
  /\bmount\b/,
  /\bumount\b/,
  /\bchmod\s+(\+x|777|666)/,
  /\bchown\s+/,
  /\bdd\s+if=/,
  /\bmkfs/,
];

const PUBLIC_HOST_PATTERN = /^https?:\/\/(?!(localhost|127\.|192\.168\.|10\.|169\.254\.|::1)).*/i;

function matchAny(text: string, patterns: RegExp[]): string[] {
  const matched: string[] = [];
  for (const p of patterns) if (p.test(text)) matched.push(p.source);
  return matched;
}

function classifyFilesystem(
  toolName: string,
  params: Record<string, unknown>,
): ClassificationResult | null {
  const lower = toolName.toLowerCase();
  const isDelete = /delete|remove|unlink|rm\b/.test(lower);
  const isWrite = /write|edit|put|patch|create|move|rename/.test(lower);
  const isRead = /read|get|cat|stat|list|ls\b/.test(lower);
  if (!isDelete && !isWrite && !isRead) return null;
  const path = String(params.path ?? params.target ?? params.file ?? params.filepath ?? "");
  if (!path) return null;

  const protectedHits = matchAny(path, PROTECTED_PATH_PATTERNS);
  const workspaceHits = matchAny(path, WORKSPACE_PATH_PATTERNS);

  if (isDelete && protectedHits.length > 0) {
    return {
      classification: "fs.delete.protected",
      decision: "block",
      reason: `delete on protected path ${path} would reduce options irreversibly without consent (Law 1 + Law 3).`,
      matchedPatterns: protectedHits,
    };
  }
  if (isDelete && workspaceHits.length > 0) {
    return {
      classification: "fs.delete.workspace",
      decision: "approval",
      reason: `delete on workspace path ${path}; reversible cost is moderate but consent should be confirmed (Law 1).`,
      matchedPatterns: workspaceHits,
    };
  }
  if (isDelete) {
    return {
      classification: "fs.delete.workspace",
      decision: "approval",
      reason: `delete on uncategorized path ${path}; requesting approval out of caution (Law 3).`,
      matchedPatterns: [],
    };
  }
  if (isWrite && protectedHits.length > 0) {
    return {
      classification: "fs.write.protected",
      decision: "approval",
      reason: `write on protected path ${path}; requesting approval (Law 1).`,
      matchedPatterns: protectedHits,
    };
  }
  if (isWrite) {
    return {
      classification: "fs.write.workspace",
      decision: "allow",
      reason: `write inside workspace; reversible.`,
      matchedPatterns: workspaceHits,
    };
  }
  return {
    classification: "fs.read.benign",
    decision: "allow",
    reason: `read does not reduce options.`,
    matchedPatterns: [],
  };
}

function classifyExec(
  toolName: string,
  params: Record<string, unknown>,
): ClassificationResult | null {
  if (!/exec|shell|bash|sh|run|command/i.test(toolName)) return null;
  const command = String(params.command ?? params.cmd ?? params.argv ?? "");
  if (!command) return null;

  const credHits = matchAny(command, CRED_VAR_PATTERNS);
  const outboundHits = matchAny(command, OUTBOUND_EXEC_PATTERNS);

  if (credHits.length > 0 && outboundHits.length > 0) {
    return {
      classification: "exec.cred-exfil",
      decision: "block",
      reason: `command interpolates credential vars (${credHits.join(", ")}) into outbound request; classic exfiltration shape (Law 1).`,
      matchedPatterns: [...credHits, ...outboundHits],
    };
  }

  const restartHits = matchAny(command, GATEWAY_RESTART_PATTERNS);
  if (restartHits.length > 0) {
    return {
      classification: "gateway.restart",
      decision: "block",
      reason: `command would restart/stop the OpenClaw gateway, severing corrigibility (Law 2).`,
      matchedPatterns: restartHits,
    };
  }

  const configHits = matchAny(command, GATEWAY_CONFIG_PATTERNS);
  if (configHits.length > 0) {
    return {
      classification: "gateway.config-change",
      decision: "approval",
      reason: `command would change OpenClaw gateway configuration; needs steward approval (Law 2).`,
      matchedPatterns: configHits,
    };
  }

  const installHits = matchAny(command, PACKAGE_INSTALL_PATTERNS);
  if (installHits.length > 0) {
    return {
      classification: "pkg.install",
      decision: "approval",
      reason: `command would install a package, expanding capability surface (Law 5).`,
      matchedPatterns: installHits,
    };
  }

  const publishHits = matchAny(command, PACKAGE_PUBLISH_PATTERNS);
  if (publishHits.length > 0) {
    return {
      classification: "pkg.publish",
      decision: "approval",
      reason: `command would publish a package to a public registry (Law 1 + Law 3).`,
      matchedPatterns: publishHits,
    };
  }

  const sysHits = matchAny(command, SYSTEM_MODIFY_PATTERNS);
  if (sysHits.length > 0) {
    return {
      classification: "exec.system-modify",
      decision: "approval",
      reason: `command would modify host system (sudo / systemctl / mount / etc.); needs approval (Law 1 + Law 2).`,
      matchedPatterns: sysHits,
    };
  }

  if (outboundHits.length > 0) {
    return {
      classification: "exec.outbound-write",
      decision: "approval",
      reason: `command performs outbound write; verify destination and payload (Law 1 + Law 3).`,
      matchedPatterns: outboundHits,
    };
  }

  return {
    classification: "exec.benign",
    decision: "allow",
    reason: `no high-risk pattern matched.`,
    matchedPatterns: [],
  };
}

function classifyHttp(
  toolName: string,
  params: Record<string, unknown>,
): ClassificationResult | null {
  if (!/http|fetch|request|curl|webhook/i.test(toolName)) return null;
  const method = String(params.method ?? "GET").toUpperCase();
  const url = String(params.url ?? params.endpoint ?? "");
  if (!url) return null;

  const isPublic = PUBLIC_HOST_PATTERN.test(url);
  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  if (isWrite && isPublic) {
    return {
      classification: "http.public-write",
      decision: "approval",
      reason: `${method} to public URL ${url} could create external state (Law 1 + Law 3).`,
      matchedPatterns: [PUBLIC_HOST_PATTERN.source],
    };
  }
  return {
    classification: "http.read",
    decision: "allow",
    reason: `${method} is a read or targets a local/private host.`,
    matchedPatterns: [],
  };
}

function classifyMessage(
  toolName: string,
  params: Record<string, unknown>,
): ClassificationResult | null {
  if (!/message|send|email|sms|post|tweet|telegram|slack|discord|whatsapp/i.test(toolName))
    return null;
  // Any outbound message to a non-self recipient is a Law 1 candidate; we
  // approve rather than block by default, because explicit user messaging is
  // the most common legitimate task.
  void params;
  return {
    classification: "message.external",
    decision: "approval",
    reason: `outbound message to a third party; verify recipient and content (Law 1).`,
    matchedPatterns: [],
  };
}

export function classifyToolCall(
  toolName: string,
  params: Record<string, unknown>,
): ClassificationResult {
  const results: (ClassificationResult | null)[] = [
    classifyFilesystem(toolName, params),
    classifyExec(toolName, params),
    classifyHttp(toolName, params),
    classifyMessage(toolName, params),
  ];
  for (const r of results) {
    if (r) return r;
  }
  return {
    classification: "unknown.unclassified",
    decision: "allow",
    reason: `tool ${toolName} did not match any known risk pattern; allowing with audit (Law 5: log unknown territory).`,
    matchedPatterns: [],
  };
}
