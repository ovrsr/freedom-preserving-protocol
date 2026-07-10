/**
 * Evidence class ceilings for trust derivation.
 *
 * Self-asserted configuration (chainIntact / entry counts) cannot reach HIGH.
 * Merkle inclusion under a peer-claimed root is completeness evidence, not
 * behavioral proof.
 */

export const EVIDENCE_CLASSES = [
  "identity",
  "configuration",
  "runtime",
  "event",
  "completeness",
  "behavioral",
] as const;

export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

/** Maximum confidence contribution per verified evidence class. */
export const EVIDENCE_CLASS_CEILINGS: Record<EvidenceClass, number> = {
  /** Key-bound signature / agent identity. Standing only — not HIGH. */
  identity: 0.7,
  /** Constitution hash / config claim. Verified match is limited standing. */
  configuration: 0.55,
  runtime: 0.7,
  event: 0.75,
  /** Merkle inclusion under a peer-claimed root — not log completeness. */
  completeness: 0.65,
  behavioral: 0.95,
};

/** Self-asserted (unverified) configuration standing ceiling. */
export const SELF_ASSERTED_CONFIGURATION_CEILING = 0.35;

/** Max trust level index reachable from a given confidence ceiling. */
export function trustLevelCeilingFromConfidence(maxConfidence: number): number {
  if (maxConfidence > 0.8) return 3; // HIGH
  if (maxConfidence > 0.6) return 2; // MEDIUM
  if (maxConfidence > 0.4) return 1; // LOW
  return 0; // UNKNOWN
}
