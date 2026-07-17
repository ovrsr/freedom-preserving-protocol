/**
 * Heuristic reversibility table for staged-allow decisions.
 * Irreversible / high-impact classes must not take the staged path.
 */

import type { ClassificationId } from "./risk-classifier.js";

const REVERSIBLE: ReadonlySet<ClassificationId> = new Set([
  "fs.write.workspace",
  "fs.delete.workspace",
  "fs.read.benign",
  "http.read",
  "http.public-read",
  "fpp.governance",
  "internal.heartbeat",
  "internal.read",
  "gateway.inspect",
]);

export function isReversibleClassification(id: ClassificationId): boolean {
  return REVERSIBLE.has(id);
}
