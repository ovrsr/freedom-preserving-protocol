/**
 * File-backed emergency override store — parallel to MandateStore.
 *
 * Stewards only for v1: agent-to-agent (peer) escalation without steward
 * involvement is a materially larger trust decision; not an oversight.
 *
 * Local-agent key rejection is intentional defense-in-depth even when the
 * allowlist should already exclude it — it is the last line between
 * "emergency override" and "agent self-escalation" under allowlist
 * misconfiguration.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  parseSignedEmergencyOverride,
  validateEmergencyOverrideValidity,
  verifyEmergencyOverrideSignature,
  type EmergencyOverrideLedgerEntry,
  type EmergencyOverrideStoreFile,
  type SignedEmergencyOverrideV1,
} from "@ovrsr/fpp-protocol-core";

export type { EmergencyOverrideLedgerEntry, EmergencyOverrideStoreFile };

/**
 * Options for the emergency override store.
 * Stewards only: `stewardEligibleIds` is the sole issuer allowlist for v1;
 * peer escalation is intentionally out of scope.
 */
export type EmergencyOverrideStoreOptions = {
  basePath?: string | undefined;
};

export type EmergencyOverrideRejectReason =
  | "none"
  | "expired"
  | "not-yet-valid"
  | "mis-scoped"
  | "signature-invalid"
  | "budget-exhausted"
  | "revoked"
  | "issuer-not-steward"
  | "agent-self-key";

export type EmergencyCoverageResult =
  | { ok: true; overrideId: string }
  | { ok: false; reason: EmergencyOverrideRejectReason };

export type AdmitResult =
  | { ok: true; overrideId: string }
  | { ok: false; reason: EmergencyOverrideRejectReason; error?: string };

export type FindEmergencyCoverageOptions = {
  nowMs: number;
  localPublicKeyHex: string;
  /** Optional re-check of steward allowlist (trust submit always passes). */
  stewardEligibleIds?: string[] | undefined;
};

export type AdmitOptions = {
  stewardEligibleIds: string[];
  localPublicKeyHex: string;
};

function seedLedgerFromOverride(
  override: SignedEmergencyOverrideV1,
): EmergencyOverrideLedgerEntry {
  const entry: EmergencyOverrideLedgerEntry = {};
  if (override.budgets.remainingActions !== undefined) {
    entry.remainingActions = override.budgets.remainingActions;
  }
  if (override.revoked === true) {
    entry.revoked = true;
  }
  return entry;
}

function hasLedgerBudget(
  ledger: EmergencyOverrideLedgerEntry | undefined,
): boolean {
  const remaining = ledger?.remainingActions;
  if (remaining === undefined) return true;
  return remaining > 0;
}

function normalizeHex(hex: string): string {
  return hex.trim().toLowerCase();
}

function validityRejectReason(
  reason: string,
): EmergencyOverrideRejectReason | null {
  if (/expired/i.test(reason)) return "expired";
  if (/not yet valid|validFrom/i.test(reason)) return "not-yet-valid";
  if (/revoked/i.test(reason)) return "revoked";
  return null;
}

export class EmergencyOverrideStore {
  readonly path: string;
  private overrides: SignedEmergencyOverrideV1[] = [];
  private ledgers: Record<string, EmergencyOverrideLedgerEntry> = {};

  constructor(storePath: string, options: EmergencyOverrideStoreOptions = {}) {
    this.path = resolve(options.basePath ?? process.cwd(), storePath);
    this.reload();
  }

  reload(): void {
    if (!existsSync(this.path)) {
      this.overrides = [];
      this.ledgers = {};
      return;
    }
    const raw = JSON.parse(
      readFileSync(this.path, "utf8"),
    ) as EmergencyOverrideStoreFile;
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.overrides)) {
      throw new Error(`invalid emergency override store at ${this.path}`);
    }
    this.overrides = raw.overrides.map((o) => ({ ...o }));
    this.ledgers = { ...(raw.ledgers ?? {}) };
    let seeded = false;
    for (const override of this.overrides) {
      if (this.ledgers[override.overrideId] === undefined) {
        this.ledgers[override.overrideId] = seedLedgerFromOverride(override);
        seeded = true;
      }
    }
    if (seeded) {
      this.persist();
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const file: EmergencyOverrideStoreFile = {
      schemaVersion: 1,
      overrides: this.overrides,
      ledgers: this.ledgers,
    };
    writeFileSync(this.path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }

  /**
   * Admit a steward-signed override after schema, signature, eligibility,
   * and self-key checks. Never signs.
   */
  admit(
    override: SignedEmergencyOverrideV1,
    options: AdmitOptions,
  ): AdmitResult {
    const parsed = parseSignedEmergencyOverride(override);
    if (!parsed.ok) {
      return { ok: false, reason: "signature-invalid", error: parsed.error };
    }
    if (!verifyEmergencyOverrideSignature(parsed.override)) {
      return { ok: false, reason: "signature-invalid" };
    }
    // Defense-in-depth: reject local agent key even if allowlist is wrong.
    if (
      normalizeHex(parsed.override.publicKey) ===
      normalizeHex(options.localPublicKeyHex)
    ) {
      return { ok: false, reason: "agent-self-key" };
    }
    if (!options.stewardEligibleIds.includes(parsed.override.issuerId)) {
      return { ok: false, reason: "issuer-not-steward" };
    }

    const idx = this.overrides.findIndex(
      (o) => o.overrideId === parsed.override.overrideId,
    );
    if (idx >= 0) {
      this.overrides[idx] = parsed.override;
    } else {
      this.overrides.push(parsed.override);
    }
    this.ledgers[parsed.override.overrideId] = seedLedgerFromOverride(
      parsed.override,
    );
    this.persist();
    return { ok: true, overrideId: parsed.override.overrideId };
  }

  getRemaining(overrideId: string): number | null {
    this.reload();
    const o = this.overrides.find((x) => x.overrideId === overrideId);
    if (!o) return null;
    const remaining = this.ledgers[overrideId]?.remainingActions;
    return remaining ?? null;
  }

  /**
   * Atomically debit one action from an override's remaining budget.
   * Mutates the unsigned ledger only — never the signed grant blob.
   */
  debit(overrideId: string): boolean {
    this.reload();
    const idx = this.overrides.findIndex((o) => o.overrideId === overrideId);
    if (idx < 0) return false;
    const ledger = { ...(this.ledgers[overrideId] ?? {}) };
    const remaining = ledger.remainingActions;
    if (remaining !== undefined && remaining <= 0) return false;
    if (remaining !== undefined) {
      ledger.remainingActions = remaining - 1;
      this.ledgers[overrideId] = ledger;
      this.persist();
    }
    return true;
  }

  revoke(overrideId: string): boolean {
    this.reload();
    const exists = this.overrides.some((o) => o.overrideId === overrideId);
    if (!exists) return false;
    const ledger = { ...(this.ledgers[overrideId] ?? {}) };
    ledger.revoked = true;
    this.ledgers[overrideId] = ledger;
    this.persist();
    return true;
  }

  findCoverage(
    classification: string,
    options: FindEmergencyCoverageOptions,
  ): EmergencyCoverageResult {
    this.reload();

    if (this.overrides.length === 0) {
      return { ok: false, reason: "none" };
    }

    let lastReject: EmergencyOverrideRejectReason = "none";

    for (const override of this.overrides) {
      const parsed = parseSignedEmergencyOverride(override);
      if (!parsed.ok) {
        lastReject = "signature-invalid";
        continue;
      }

      // Defense-in-depth: reject local agent key even if allowlist is wrong.
      if (
        normalizeHex(parsed.override.publicKey) ===
        normalizeHex(options.localPublicKeyHex)
      ) {
        lastReject = "agent-self-key";
        continue;
      }

      if (
        options.stewardEligibleIds !== undefined &&
        !options.stewardEligibleIds.includes(parsed.override.issuerId)
      ) {
        lastReject = "issuer-not-steward";
        continue;
      }

      if (!verifyEmergencyOverrideSignature(parsed.override)) {
        lastReject = "signature-invalid";
        continue;
      }

      const ledger = this.ledgers[parsed.override.overrideId];
      if (ledger?.revoked === true || parsed.override.revoked === true) {
        lastReject = "revoked";
        continue;
      }

      const validity = validateEmergencyOverrideValidity(parsed.override, {
        nowMs: options.nowMs,
      });
      if (!validity.valid) {
        lastReject = validityRejectReason(validity.reason) ?? "expired";
        continue;
      }

      if (!hasLedgerBudget(ledger)) {
        lastReject = "budget-exhausted";
        continue;
      }

      const classes = parsed.override.scope.classifications ?? [];
      if (!classes.includes(classification)) {
        lastReject = "mis-scoped";
        continue;
      }

      return { ok: true, overrideId: parsed.override.overrideId };
    }

    return { ok: false, reason: lastReject };
  }
}
