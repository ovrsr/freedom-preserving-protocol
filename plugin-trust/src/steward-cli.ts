/**
 * Human-operated steward / OpenPGP operator-authorization CLI.
 * Never signs with private keys — emits templates and admits verified artifacts.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canonicalizeV2,
  mintStewardIdV1,
  parseOperatorAuthorization,
  parseOperatorAuthorizationRevocation,
  parseStewardKeyAttestation,
  workspaceFile,
  type OperatorAuthorizationRevocationV1,
  type OperatorAuthorizationV1,
  type StewardKeyAttestationV1,
} from "@ovrsr/fpp-protocol-core";
import {
  AuthorizationService,
  StewardAuthorizationLedger,
  StewardRegistry,
  createDefaultBackendRegistry,
  createOpenPgpBackend,
} from "@ovrsr/fpp-steward-auth-core";

export type StewardCliCommand = {
  command(name: string): StewardCliCommand;
  description(desc: string): StewardCliCommand;
  argument(arg: string, desc: string): StewardCliCommand;
  option(flags: string, desc: string, defaultValue?: string): StewardCliCommand;
  requiredOption(flags: string, desc: string): StewardCliCommand;
  action(fn: (...args: unknown[]) => void | Promise<void>): StewardCliCommand;
};

export type StewardCliDeps = {
  /** Absolute or workspace-relative ledger path. */
  ledgerPath?: string | undefined;
  /** Default instance audience for init. */
  instanceAudience?: string | undefined;
  exit?: ((code: number) => void) | undefined;
};

function fail(
  message: string,
  exit: (code: number) => void = process.exit,
): never {
  console.error(`error: ${message}`);
  exit(1);
  throw new Error(message);
}

function requireOpt(
  opts: Record<string, string | undefined>,
  key: string,
  exit: (code: number) => void,
): string {
  const value = opts[key];
  if (typeof value !== "string" || value.length === 0) {
    fail(`missing required option ${key}`, exit);
  }
  return value;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function readTextFile(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

function nonce(): string {
  return randomBytes(24).toString("base64url");
}

function idToken(prefix: string): string {
  return `${prefix}-${randomBytes(8).toString("hex")}`;
}

function createStack(ledgerPath: string) {
  const ledger = new StewardAuthorizationLedger({ path: ledgerPath });
  const backends = createDefaultBackendRegistry([createOpenPgpBackend()]);
  const registry = new StewardRegistry({ ledger, backends });
  const authorization = new AuthorizationService({
    ledger,
    backends,
    registry,
  });
  return { ledger, registry, authorization };
}

function envelopeFromOpts(opts: Record<string, unknown>): {
  format: "detached" | "cleartext";
  signaturesArmored?: string[];
  cleartextArmored?: string;
} {
  const cleartextPath = opts.cleartext as string | undefined;
  const payloadPath = opts.payload as string | undefined;
  const signaturePaths = opts.signature as string[] | string | undefined;
  if (cleartextPath) {
    return {
      format: "cleartext",
      cleartextArmored: readTextFile(cleartextPath),
    };
  }
  if (!payloadPath) {
    throw new Error("provide --payload + --signature, or --cleartext");
  }
  const sigs = Array.isArray(signaturePaths)
    ? signaturePaths
    : signaturePaths
      ? [signaturePaths]
      : [];
  if (sigs.length === 0) {
    throw new Error("detached mode requires at least one --signature");
  }
  return {
    format: "detached",
    signaturesArmored: sigs.map((p) => readTextFile(p)),
  };
}

function loadPayload(opts: Record<string, unknown>): unknown {
  if (opts.cleartext) {
    // Cleartext path: attestation JSON is embedded; caller parses after verify.
    // For admit we still need structured payload — require --payload alongside
    // cleartext OR extract is handled by service expecting structured input.
    // CLI requires --payload for structured JSON always.
  }
  const payloadPath = opts.payload as string | undefined;
  if (!payloadPath) {
    throw new Error("--payload <file.json> is required");
  }
  return readJsonFile(payloadPath);
}

export function registerStewardCli(
  parent: StewardCliCommand,
  deps: StewardCliDeps = {},
): void {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const defaultLedger =
    deps.ledgerPath ??
    workspaceFile("fpp-steward-authorization-ledger.jsonl");
  const defaultAudience =
    deps.instanceAudience ?? `instance:local-${mintStewardIdV1().slice(-8)}`;

  const steward = parent
    .command("steward")
    .description(
      "OpenPGP steward identity and operator authorization (human-operated; never signs privately)",
    );

  steward
    .command("init")
    .description(
      "Initialize steward ledger + mint steward ID (explicit local policy; no private-key signing)",
    )
    .option("--audience <id>", "Instance audience bound into the ledger", defaultAudience)
    .option("--ledger <path>", "Ledger path", defaultLedger)
    .option("--max-standing-lifetime-ms <n>", "Standing max lifetime ms", "86400000")
    .option("--max-standing-uses <n>", "Standing max uses", "100")
    .option("--max-oneshot-lifetime-ms <n>", "One-shot max lifetime ms", "3600000")
    .option("--allowed-clock-skew-ms <n>", "Allowed clock skew ms", "300000")
    .action((...args: unknown[]) => {
      const opts = (args[0] ?? {}) as Record<string, string>;
      const ledgerPath = resolve(opts.ledger ?? defaultLedger);
      const audience = opts.audience ?? defaultAudience;
      const ledger = new StewardAuthorizationLedger({ path: ledgerPath });
      const stewardId = mintStewardIdV1();
      const init = ledger.initialize({
        instanceAudience: audience,
        maxStandingLifetimeMs: Number(opts.maxStandingLifetimeMs ?? 86_400_000),
        maxStandingUses: Number(opts.maxStandingUses ?? 100),
        maxOneShotLifetimeMs: Number(opts.maxOneshotLifetimeMs ?? 3_600_000),
        allowedClockSkewMs: Number(opts.allowedClockSkewMs ?? 300_000),
      });
      if (!init.ok) {
        fail(
          init.error instanceof Error ? init.error.message : String(init.error),
          exit,
        );
      }
      console.log(
        JSON.stringify(
          {
            stewardId,
            audience,
            ledgerPath,
            note: "Sign key attestations and authorizations with external OpenPGP tooling. Local TOFU is not web-of-trust assurance.",
            next: "steward key-template --steward-id … then steward key-admit --accept-tofu",
          },
          null,
          2,
        ),
      );
    });

  steward
    .command("key-template")
    .description("Emit canonical steward-key-attestation JSON for offline signing")
    .requiredOption("--steward-id <id>", "Steward ID")
    .requiredOption("--operation <op>", "initial-bind | add | rotate | revoke")
    .requiredOption("--key-ref <ref>", "openpgp:<fingerprint>")
    .requiredOption("--public-key <path>", "Armored public key file")
    .option("--audience <id>", "Audience (defaults to ledger policy)")
    .option("--ledger <path>", "Ledger path", defaultLedger)
    .option("--replaces-key-ref <ref>", "Required for rotate")
    .option("--reason <text>", "Reason", "steward key lifecycle")
    .action((...args: unknown[]) => {
      const opts = (args[0] ?? {}) as Record<string, string>;
      const ledgerPath = resolve(opts.ledger ?? defaultLedger);
      const { ledger } = createStack(ledgerPath);
      const loaded = ledger.loadVerified();
      if (!loaded.ok || !loaded.policy) {
        fail("ledger unavailable or uninitialized — run steward init", exit);
      }
      const audience = opts.audience ?? loaded.policy.instanceAudience;
      const publicKeyArmored = readTextFile(requireOpt(opts, "publicKey", exit));
      if (/PRIVATE KEY/i.test(publicKeyArmored)) {
        fail("refusing private key material — provide a public certificate only", exit);
      }
      const attestation: StewardKeyAttestationV1 = {
        schemaVersion: 1,
        kind: "steward-key-attestation",
        attestationId: idToken("att"),
        operation: requireOpt(opts, "operation", exit) as StewardKeyAttestationV1["operation"],
        stewardId: requireOpt(opts, "stewardId", exit),
        audience,
        subjectKey: {
          algorithm: "openpgp",
          keyRef: requireOpt(opts, "keyRef", exit),
          publicKeyArmored,
        },
        ...(opts.replacesKeyRef
          ? { replacesKeyRef: opts.replacesKeyRef }
          : {}),
        issuedAt: new Date().toISOString(),
        nonce: nonce(),
        reason: opts.reason ?? "steward key lifecycle",
      };
      const parsed = parseStewardKeyAttestation(attestation);
      if (!parsed.ok) fail(parsed.error, exit);
      process.stdout.write(canonicalizeV2(attestation));
    });

  steward
    .command("key-admit")
    .description(
      "Admit a signed key attestation (detached --payload/--signature or --cleartext)",
    )
    .requiredOption("--payload <path>", "Canonical attestation JSON")
    .option("--signature <path>", "Detached signature (repeatable)")
    .option("--cleartext <path>", "Clear-signed message")
    .option("--authorizer-key-ref <ref>", "Active authorizer for add/rotate/revoke")
    .option("--accept-tofu", "Required acknowledgement for initial-bind")
    .option("--ledger <path>", "Ledger path", defaultLedger)
    .action(async (...args: unknown[]) => {
      const opts = (args[0] ?? {}) as Record<string, unknown>;
      try {
        const ledgerPath = resolve(String(opts.ledger ?? defaultLedger));
        const { registry } = createStack(ledgerPath);
        const attestation = parseStewardKeyAttestation(loadPayload(opts));
        if (!attestation.ok) fail(attestation.error, exit);
        const envelope = envelopeFromOpts(opts);
        const result = await registry.admitKeyAttestation({
          attestation: attestation.attestation,
          format: envelope.format,
          ...(envelope.signaturesArmored
            ? { signaturesArmored: envelope.signaturesArmored }
            : {}),
          ...(envelope.cleartextArmored
            ? { cleartextArmored: envelope.cleartextArmored }
            : {}),
          ...(typeof opts.authorizerKeyRef === "string"
            ? { authorizerKeyRef: opts.authorizerKeyRef }
            : {}),
          acceptTofu: Boolean(opts.acceptTofu),
        });
        if (!result.ok) fail(result.reason, exit);
        console.log(
          JSON.stringify(
            {
              ok: true,
              stewardId: result.stewardId,
              eventHash: result.eventHash,
              trustModel: "local-tofu-or-signed-lifecycle (not OpenPGP WoT)",
            },
            null,
            2,
          ),
        );
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err), exit);
      }
    });

  steward
    .command("inspect")
    .description("Print steward bindings and recent ledger sequence/hash")
    .option("--ledger <path>", "Ledger path", defaultLedger)
    .action((...args: unknown[]) => {
      const opts = (args[0] ?? {}) as Record<string, string>;
      const ledgerPath = resolve(opts.ledger ?? defaultLedger);
      const { ledger, registry } = createStack(ledgerPath);
      const loaded = ledger.loadVerified();
      if (!loaded.ok) {
        fail(loaded.error.message, exit);
      }
      const stewards = registry.listStewards().map((s) => ({
        stewardId: s.stewardId,
        keys: [...s.keys.values()].map((k) => ({
          keyRef: k.keyRef,
          status: k.status,
          boundAt: k.boundAt,
        })),
      }));
      const last = loaded.events[loaded.events.length - 1];
      console.log(
        JSON.stringify(
          {
            ledgerPath,
            audience: loaded.policy?.instanceAudience ?? null,
            eventCount: loaded.events.length,
            lastSequence: last?.sequence ?? 0,
            lastEventHash: last?.eventHash ?? null,
            stewards,
            note: "Local ledger inspection only — not web-of-trust assurance.",
          },
          null,
          2,
        ),
      );
    });

  steward
    .command("authorization-template")
    .description("Emit canonical operator-authorization JSON for offline signing")
    .requiredOption("--steward-id <id>", "Steward ID")
    .requiredOption("--signing-key-ref <ref>", "Active openpgp key ref")
    .requiredOption("--classifications <csv>", "Exact classification ids")
    .requiredOption("--mode <mode>", "one-shot | standing")
    .requiredOption("--expires-at <iso>", "Expiry ISO-8601 UTC")
    .requiredOption("--reason <text>", "Reason")
    .option("--tool-names <csv>", "Optional exact tool names")
    .option("--resource-paths <csv>", "Optional exact workspace-relative paths")
    .option("--max-uses <n>", "Required; one-shot must be 1")
    .option("--ledger <path>", "Ledger path", defaultLedger)
    .action((...args: unknown[]) => {
      const opts = (args[0] ?? {}) as Record<string, string>;
      const ledgerPath = resolve(opts.ledger ?? defaultLedger);
      const { ledger } = createStack(ledgerPath);
      const loaded = ledger.loadVerified();
      if (!loaded.ok || !loaded.policy) {
        fail("ledger unavailable or uninitialized", exit);
      }
      const mode = requireOpt(opts, "mode", exit) as "one-shot" | "standing";
      const maxUses = Number(opts.maxUses ?? (mode === "one-shot" ? 1 : 0));
      const classifications = requireOpt(opts, "classifications", exit)
        .split(",")
        .map((s) => s.trim());
      const authorization: OperatorAuthorizationV1 = {
        schemaVersion: 1,
        kind: "operator-authorization",
        authorizationId: idToken("authz"),
        stewardId: requireOpt(opts, "stewardId", exit),
        signingKeyRef: requireOpt(opts, "signingKeyRef", exit),
        audience: loaded.policy.instanceAudience,
        mode,
        scope: {
          classifications,
          ...(opts.toolNames
            ? {
                toolNames: opts.toolNames.split(",").map((s) => s.trim()),
              }
            : {}),
          ...(opts.resourcePaths
            ? {
                resourcePaths: opts.resourcePaths
                  .split(",")
                  .map((s) => s.trim()),
              }
            : {}),
        },
        issuedAt: new Date().toISOString(),
        expiresAt: requireOpt(opts, "expiresAt", exit),
        nonce: nonce(),
        maxUses,
        reason: requireOpt(opts, "reason", exit),
      };
      const parsed = parseOperatorAuthorization(authorization);
      if (!parsed.ok) fail(parsed.error, exit);
      process.stdout.write(canonicalizeV2(authorization));
    });

  steward
    .command("authorization-verify")
    .description("Verify a signed authorization without consuming the nonce")
    .requiredOption("--payload <path>", "Authorization JSON")
    .option("--signature <path>", "Detached signature (repeatable)")
    .option("--cleartext <path>", "Clear-signed message")
    .option("--ledger <path>", "Ledger path", defaultLedger)
    .action(async (...args: unknown[]) => {
      const opts = (args[0] ?? {}) as Record<string, unknown>;
      try {
        const ledgerPath = resolve(String(opts.ledger ?? defaultLedger));
        const { authorization } = createStack(ledgerPath);
        const parsed = parseOperatorAuthorization(loadPayload(opts));
        if (!parsed.ok) fail(parsed.error, exit);
        const envelope = envelopeFromOpts(opts);
        const result = await authorization.verify({
          authorization: parsed.authorization,
          format: envelope.format,
          ...(envelope.signaturesArmored
            ? { signaturesArmored: envelope.signaturesArmored }
            : {}),
          ...(envelope.cleartextArmored
            ? { cleartextArmored: envelope.cleartextArmored }
            : {}),
        });
        if (!result.ok) fail(result.reason, exit);
        console.log(
          JSON.stringify(
            { ok: true, authorizationId: result.authorization.authorizationId },
            null,
            2,
          ),
        );
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err), exit);
      }
    });

  steward
    .command("authorization-admit")
    .description("Admit a signed authorization (consumes nonce once)")
    .requiredOption("--payload <path>", "Authorization JSON")
    .option("--signature <path>", "Detached signature (repeatable)")
    .option("--cleartext <path>", "Clear-signed message")
    .option("--ledger <path>", "Ledger path", defaultLedger)
    .action(async (...args: unknown[]) => {
      const opts = (args[0] ?? {}) as Record<string, unknown>;
      try {
        const ledgerPath = resolve(String(opts.ledger ?? defaultLedger));
        const { authorization } = createStack(ledgerPath);
        const parsed = parseOperatorAuthorization(loadPayload(opts));
        if (!parsed.ok) fail(parsed.error, exit);
        const envelope = envelopeFromOpts(opts);
        const result = await authorization.admit({
          authorization: parsed.authorization,
          format: envelope.format,
          ...(envelope.signaturesArmored
            ? { signaturesArmored: envelope.signaturesArmored }
            : {}),
          ...(envelope.cleartextArmored
            ? { cleartextArmored: envelope.cleartextArmored }
            : {}),
        });
        if (!result.ok) fail(result.reason, exit);
        console.log(
          JSON.stringify(
            {
              ok: true,
              authorizationId: result.authorizationId,
              eventHash: result.eventHash,
            },
            null,
            2,
          ),
        );
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err), exit);
      }
    });

  steward
    .command("authorization-list")
    .description("List admitted authorizations and remaining uses")
    .option("--ledger <path>", "Ledger path", defaultLedger)
    .action((...args: unknown[]) => {
      const opts = (args[0] ?? {}) as Record<string, string>;
      const ledgerPath = resolve(opts.ledger ?? defaultLedger);
      const { authorization } = createStack(ledgerPath);
      const listed = authorization.listAdmitted().map((e) => ({
        authorizationId: e.authorization.authorizationId,
        stewardId: e.stewardId,
        signingKeyRef: e.signingKeyRef,
        mode: e.authorization.mode,
        scope: e.authorization.scope,
        remainingUses: e.remainingUses,
        revoked: e.revoked,
        expiresAt: e.authorization.expiresAt,
      }));
      console.log(JSON.stringify({ authorizations: listed }, null, 2));
    });

  steward
    .command("authorization-revoke-template")
    .description("Emit canonical authorization-revocation JSON")
    .requiredOption("--authorization-id <id>", "Authorization to revoke")
    .requiredOption("--steward-id <id>", "Steward ID")
    .requiredOption("--signing-key-ref <ref>", "Any active same-steward key")
    .requiredOption("--reason <text>", "Reason")
    .option("--ledger <path>", "Ledger path", defaultLedger)
    .action((...args: unknown[]) => {
      const opts = (args[0] ?? {}) as Record<string, string>;
      const ledgerPath = resolve(opts.ledger ?? defaultLedger);
      const { ledger } = createStack(ledgerPath);
      const loaded = ledger.loadVerified();
      if (!loaded.ok || !loaded.policy) {
        fail("ledger unavailable or uninitialized", exit);
      }
      const revocation: OperatorAuthorizationRevocationV1 = {
        schemaVersion: 1,
        kind: "operator-authorization-revocation",
        authorizationId: requireOpt(opts, "authorizationId", exit),
        stewardId: requireOpt(opts, "stewardId", exit),
        signingKeyRef: requireOpt(opts, "signingKeyRef", exit),
        audience: loaded.policy.instanceAudience,
        issuedAt: new Date().toISOString(),
        nonce: nonce(),
        reason: requireOpt(opts, "reason", exit),
      };
      const parsed = parseOperatorAuthorizationRevocation(revocation);
      if (!parsed.ok) fail(parsed.error, exit);
      process.stdout.write(canonicalizeV2(revocation));
    });

  steward
    .command("authorization-revoke")
    .description("Admit a signed authorization revocation")
    .requiredOption("--payload <path>", "Revocation JSON")
    .option("--signature <path>", "Detached signature (repeatable)")
    .option("--cleartext <path>", "Clear-signed message")
    .option("--ledger <path>", "Ledger path", defaultLedger)
    .action(async (...args: unknown[]) => {
      const opts = (args[0] ?? {}) as Record<string, unknown>;
      try {
        const ledgerPath = resolve(String(opts.ledger ?? defaultLedger));
        const { authorization } = createStack(ledgerPath);
        const parsed = parseOperatorAuthorizationRevocation(loadPayload(opts));
        if (!parsed.ok) fail(parsed.error, exit);
        const envelope = envelopeFromOpts(opts);
        const result = await authorization.admitRevocation({
          revocation: parsed.revocation,
          format: envelope.format,
          ...(envelope.signaturesArmored
            ? { signaturesArmored: envelope.signaturesArmored }
            : {}),
          ...(envelope.cleartextArmored
            ? { cleartextArmored: envelope.cleartextArmored }
            : {}),
        });
        if (!result.ok) fail(result.reason, exit);
        console.log(
          JSON.stringify(
            {
              ok: true,
              authorizationId: result.authorizationId,
              eventHash: result.eventHash,
            },
            null,
            2,
          ),
        );
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err), exit);
      }
    });
}
