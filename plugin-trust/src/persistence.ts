/**
 * persistence.ts
 *
 * Small JSON persistence layer for the FPP trust graph. The trust graph is
 * still an in-process structure, but this module lets the plugin reload its
 * last known graph after an OpenClaw restart and write updates back to disk.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { TrustGraphProtocol } from "./trust-graph.js";
import type { TrustNode, TrustRelationship } from "./trust-graph.js";

type PersistedTrustGraph = {
  version: 1;
  savedAt: string;
  nodes: TrustNode[];
  relationships: TrustRelationship[];
};

function isPersistedTrustGraph(value: unknown): value is PersistedTrustGraph {
  if (value === null || typeof value !== "object") return false;
  const v = value as Partial<PersistedTrustGraph>;
  return (
    v.version === 1 &&
    typeof v.savedAt === "string" &&
    Array.isArray(v.nodes) &&
    Array.isArray(v.relationships)
  );
}

export function loadTrustGraph(path: string): TrustGraphProtocol {
  const graph = new TrustGraphProtocol();
  const resolved = resolve(path);
  if (!existsSync(resolved)) return graph;

  const parsed = JSON.parse(readFileSync(resolved, "utf-8")) as unknown;
  if (!isPersistedTrustGraph(parsed)) {
    throw new Error(`invalid FPP trust graph persistence file: ${resolved}`);
  }
  graph.importData({
    nodes: parsed.nodes,
    relationships: parsed.relationships,
  });
  return graph;
}

export function saveTrustGraph(
  path: string,
  graph: TrustGraphProtocol,
): void {
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { recursive: true });
  const data = graph.exportData();
  const body = JSON.stringify(
    {
      version: 1,
      savedAt: new Date().toISOString(),
      nodes: data.nodes,
      relationships: data.relationships,
    } satisfies PersistedTrustGraph,
    null,
    2,
  ) + "\n";
  const tmp = `${resolved}.tmp-${process.pid}`;
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, resolved);
}
