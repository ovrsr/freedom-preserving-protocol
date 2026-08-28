/**
 * Secure interactive steward bootstrap ceremony helpers.
 * Signing remains external; this module never handles private keys.
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parseKeyRef } from "@ovrsr/fpp-protocol-core";

export type BootstrapInteractiveDeps = {
  isInteractive?: () => boolean;
  confirm?: (prompt: string) => Promise<string>;
  write?: (line: string) => void;
};

export const LEGACY_TOFU_PROFILE = "legacy-tofu" as const;
export const SECURE_BOOTSTRAP_PROFILE = "interactive-fingerprint" as const;

export const LEGACY_TOFU_WARNING =
  "WARNING: --bootstrap-profile legacy-tofu is an insecure compatibility path. Prefer steward bootstrap-template / bootstrap-admit. Local TOFU is not MFA, not malware resistance, and not web-of-trust assurance.";

/** Short operator-attention confirmation derived from the fingerprint suffix. */
export function confirmationPhraseFromKeyRef(keyRef: string): string {
  const parsed = parseKeyRef(keyRef);
  if (!parsed.ok) {
    throw new Error(`invalid key ref: ${parsed.error}`);
  }
  const id = parsed.keyRef.identifier.toLowerCase();
  if (id.length < 8) {
    throw new Error("fingerprint too short for confirmation phrase");
  }
  return id.slice(-8);
}

export function normalizeKeyRef(keyRef: string): string {
  const parsed = parseKeyRef(keyRef.trim().toLowerCase());
  if (!parsed.ok) {
    throw new Error(`invalid key ref: ${parsed.error}`);
  }
  return parsed.keyRef.raw;
}

export function formatBootstrapReview(input: {
  stewardId: string;
  audience: string;
  expectedKeyRef: string;
  policy: {
    maxStandingLifetimeMs: number;
    maxStandingUses: number;
    maxOneShotLifetimeMs: number;
    allowedClockSkewMs: number;
  };
}): string {
  const lines = [
    "Steward secure bootstrap — review before confirming:",
    `  stewardId: ${input.stewardId}`,
    `  audience:  ${input.audience}`,
    `  keyRef:    ${input.expectedKeyRef}`,
    `  policy:    standingLifetimeMs=${input.policy.maxStandingLifetimeMs} standingUses=${input.policy.maxStandingUses} oneShotLifetimeMs=${input.policy.maxOneShotLifetimeMs} clockSkewMs=${input.policy.allowedClockSkewMs}`,
    "",
    "This TTY confirmation is a software attention control only.",
    "It does not prove identity against malware that controls this host.",
  ];
  return lines.join("\n");
}

async function defaultConfirm(prompt: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

function defaultIsInteractive(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

/**
 * Require an interactive TTY and matching fingerprint confirmation.
 * Fails closed before any ledger mutation when non-interactive or mismatched.
 */
export async function requireInteractiveFingerprintConfirmation(
  expectedKeyRef: string,
  deps: BootstrapInteractiveDeps = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const isInteractive = deps.isInteractive ?? defaultIsInteractive;
  const confirm = deps.confirm ?? defaultConfirm;
  const write = deps.write ?? ((line: string) => console.error(line));

  if (!isInteractive()) {
    return {
      ok: false,
      reason:
        "secure bootstrap requires an interactive TTY on stdin and stdout",
    };
  }

  let phrase: string;
  try {
    phrase = confirmationPhraseFromKeyRef(expectedKeyRef);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  write(
    `Type the last 8 hex characters of the expected fingerprint to confirm (${phrase}): `,
  );
  const answer = await confirm("");
  const normalizedAnswer = answer.trim().toLowerCase();
  if (["n", "no", "decline", "cancel"].includes(normalizedAnswer)) {
    return {
      ok: false,
      reason: "operator declined secure bootstrap",
    };
  }
  if (normalizedAnswer !== phrase) {
    return {
      ok: false,
      reason: "fingerprint confirmation did not match",
    };
  }
  return { ok: true };
}

export function assertLegacyTofuProfile(
  profile: string | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (profile !== LEGACY_TOFU_PROFILE) {
    return {
      ok: false,
      reason:
        "legacy steward init / initial key-admit requires --bootstrap-profile legacy-tofu (insecure compatibility). Prefer steward bootstrap-admit.",
    };
  }
  return { ok: true };
}
