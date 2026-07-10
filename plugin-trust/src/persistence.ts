/**
 * persistence.ts
 *
 * JSON persistence for the FPP trust graph.
 *
 * v1 — unsigned score file (legacy). Still loadable; migration is explicit.
 * v2 — signed snapshot cache over an append-only trust-event ledger.
 *
 * Writes use temp+rename. Migration preserves the original v1 file as `.v1.bak`.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { TrustGraphProtocol } from "./trust-graph.js";
import type { TrustNode, TrustRelationship } from "./trust-graph.js";
import type { AgentIdentity } from "./identity.js";
import {
  TrustEventLedger,
  appendTrustEvent,
  buildSnapshotFromEvents,
  computeEventRoot,
  legacyObservationsFromV1,
  verifySnapshot,
  type SignedTrustEvent,
  type TrustSnapshotV2,
} from "./trust-events.js";

type PersistedTrustGraphV1 = {
  version: 1;
  savedAt: string;
  nodes: TrustNode[];
  relationships: TrustRelationship[];
};

export type LoadTrustGraphOptions = {
  attenuationFactor?: number;
  identity?: AgentIdentity;
};

export type SaveTrustGraphOptions = {
  identity?: AgentIdentity;
  ledger?: TrustEventLedger;
};

function isPersistedTrustGraphV1(value: unknown): value is PersistedTrustGraphV1 {
  if (value === null || typeof value !== "object") return false;
  const v = value as Partial<PersistedTrustGraphV1>;
  return (
    v.version === 1 &&
    typeof v.savedAt === "string" &&
    Array.isArray(v.nodes) &&
    Array.isArray(v.relationships)
  );
}

function isTrustSnapshotV2(value: unknown): value is TrustSnapshotV2 {
  if (value === null || typeof value !== "object") return false;
  const v = value as Partial<TrustSnapshotV2>;
  return (
    v.version === 2 &&
    typeof v.savedAt === "string" &&
    typeof v.eventRoot === "string" &&
    typeof v.eventCount === "number" &&
    typeof v.signerPublicKey === "string" &&
    typeof v.signature === "string" &&
    Array.isArray(v.nodes) &&
    Array.isArray(v.relationships)
  );
}

function eventsPathFor(snapshotPath: string): string {
  return `${snapshotPath}.events.jsonl`;
}

function serializeGraphV1(graph: TrustGraphProtocol): string {
  const data = graph.exportData();
  return (
    JSON.stringify(
      {
        version: 1,
        savedAt: new Date().toISOString(),
        nodes: data.nodes,
        relationships: data.relationships,
      } satisfies PersistedTrustGraphV1,
      null,
      2,
    ) + "\n"
  );
}

function loadEvents(eventsFile: string): SignedTrustEvent[] {
  if (!existsSync(eventsFile)) return [];
  const lines = readFileSync(eventsFile, "utf-8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.map((line) => JSON.parse(line) as SignedTrustEvent);
}

function writeEventsSync(eventsFile: string, events: readonly SignedTrustEvent[]): void {
  mkdirSync(dirname(eventsFile), { recursive: true });
  const body = events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : "");
  const tmp = `${eventsFile}.tmp-${process.pid}`;
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, eventsFile);
}

async function writeEventsAsync(
  eventsFile: string,
  events: readonly SignedTrustEvent[],
): Promise<void> {
  await mkdir(dirname(eventsFile), { recursive: true });
  const body = events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : "");
  const tmp = `${eventsFile}.tmp-${process.pid}`;
  await writeFile(tmp, body, { mode: 0o600 });
  await rename(tmp, eventsFile);
}

function applySnapshotToGraph(
  graph: TrustGraphProtocol,
  snapshot: TrustSnapshotV2,
): void {
  graph.importData({
    nodes: snapshot.nodes,
    relationships: snapshot.relationships,
  });
  graph.setLegacyObservations(snapshot.legacyObservations ?? []);
  graph.setPersistenceMeta({
    eventRoot: snapshot.eventRoot,
    eventCount: snapshot.eventCount,
  });
}

export function loadTrustGraph(
  path: string,
  basePath: string = process.cwd(),
  options?: LoadTrustGraphOptions,
): TrustGraphProtocol {
  const graphOpts: { attenuationFactor?: number } = {};
  if (options?.attenuationFactor !== undefined) {
    graphOpts.attenuationFactor = options.attenuationFactor;
  }
  const graph = new TrustGraphProtocol(graphOpts);
  const resolved = resolve(basePath, path);
  if (!existsSync(resolved)) return graph;

  const parsed = JSON.parse(readFileSync(resolved, "utf-8")) as unknown;

  if (isPersistedTrustGraphV1(parsed)) {
    // Explicit non-escalating import: load nodes but label as legacy.
    graph.importData({
      nodes: parsed.nodes,
      relationships: parsed.relationships,
    });
    graph.setLegacyObservations(
      legacyObservationsFromV1({
        nodes: parsed.nodes,
        relationships: parsed.relationships,
      }),
    );
    return graph;
  }

  if (!isTrustSnapshotV2(parsed)) {
    throw new Error(`invalid or unsupported FPP trust graph persistence file: ${resolved}`);
  }

  const eventsFile = eventsPathFor(resolved);
  const events = loadEvents(eventsFile);
  const check = verifySnapshot(parsed, events);
  if (!check.valid) {
    throw new Error(
      `tampered or invalid v2 trust snapshot at ${resolved}: ${check.reason}`,
    );
  }

  applySnapshotToGraph(graph, parsed);
  return graph;
}

function buildV2Body(
  graph: TrustGraphProtocol,
  identity: AgentIdentity,
  ledger: TrustEventLedger,
): { body: string; events: readonly SignedTrustEvent[] } {
  const data = graph.exportData();
  // Ensure ledger has at least a cache event binding current graph state
  if (ledger.events.length === 0) {
    appendTrustEvent(ledger, identity, {
      kind: "assessment_cached",
      data: {
        nodeCount: data.nodes.length,
        relationshipCount: data.relationships.length,
      },
    });
  }
  const snapshot = buildSnapshotFromEvents(ledger.events, identity, {
    nodes: data.nodes,
    relationships: data.relationships,
    legacyObservations: graph.getLegacyObservations(),
  });
  graph.setPersistenceMeta({
    eventRoot: snapshot.eventRoot,
    eventCount: snapshot.eventCount,
  });
  return {
    body: JSON.stringify(snapshot, null, 2) + "\n",
    events: ledger.events,
  };
}

export async function saveTrustGraph(
  path: string,
  graph: TrustGraphProtocol,
  basePath: string = process.cwd(),
  options?: SaveTrustGraphOptions,
): Promise<void> {
  const resolved = resolve(basePath, path);
  await mkdir(dirname(resolved), { recursive: true });

  if (!options?.identity) {
    const body = serializeGraphV1(graph);
    const tmp = `${resolved}.tmp-${process.pid}`;
    await writeFile(tmp, body, { mode: 0o600 });
    await rename(tmp, resolved);
    return;
  }

  const ledger = options.ledger ?? new TrustEventLedger();
  // Reload existing events if present and ledger empty
  if (ledger.events.length === 0 && existsSync(eventsPathFor(resolved))) {
    ledger.load(loadEvents(eventsPathFor(resolved)));
  }
  const { body, events } = buildV2Body(graph, options.identity, ledger);
  await writeEventsAsync(eventsPathFor(resolved), events);
  const tmp = `${resolved}.tmp-${process.pid}`;
  await writeFile(tmp, body, { mode: 0o600 });
  await rename(tmp, resolved);
}

export function saveTrustGraphSync(
  path: string,
  graph: TrustGraphProtocol,
  basePath: string = process.cwd(),
  options?: SaveTrustGraphOptions,
): void {
  const resolved = resolve(basePath, path);
  mkdirSync(dirname(resolved), { recursive: true });

  if (!options?.identity) {
    const body = serializeGraphV1(graph);
    const tmp = `${resolved}.tmp-${process.pid}`;
    writeFileSync(tmp, body, { mode: 0o600 });
    renameSync(tmp, resolved);
    return;
  }

  const ledger = options.ledger ?? new TrustEventLedger();
  if (ledger.events.length === 0 && existsSync(eventsPathFor(resolved))) {
    ledger.load(loadEvents(eventsPathFor(resolved)));
  }
  const { body, events } = buildV2Body(graph, options.identity, ledger);
  writeEventsSync(eventsPathFor(resolved), events);
  const tmp = `${resolved}.tmp-${process.pid}`;
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, resolved);
}

/**
 * Explicit v1 → v2 migration. Preserves the original file as `${path}.v1.bak`.
 * Never deletes the source until the backup exists and v2 verifies.
 */
export function migrateV1ToV2(
  path: string,
  identity: AgentIdentity,
  basePath: string = process.cwd(),
): TrustSnapshotV2 {
  const resolved = resolve(basePath, path);
  if (!existsSync(resolved)) {
    throw new Error(`no trust graph file to migrate: ${resolved}`);
  }

  const raw = readFileSync(resolved, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isPersistedTrustGraphV1(parsed)) {
    throw new Error(`migrateV1ToV2 requires a v1 file: ${resolved}`);
  }

  const bakPath = `${resolved}.v1.bak`;
  copyFileSync(resolved, bakPath);

  const ledger = new TrustEventLedger();
  appendTrustEvent(ledger, identity, {
    kind: "legacy_import",
    data: {
      nodes: parsed.nodes,
      relationships: parsed.relationships,
      importedAt: new Date().toISOString(),
      sourcePath: path,
    },
  });

  const legacy = legacyObservationsFromV1({
    nodes: parsed.nodes,
    relationships: parsed.relationships,
  });

  // Import nodes into a graph for the cache, but confidence stays on legacy labels.
  const graph = new TrustGraphProtocol();
  graph.importData({
    nodes: parsed.nodes,
    relationships: parsed.relationships,
  });
  graph.setLegacyObservations(legacy);

  const snapshot = buildSnapshotFromEvents(ledger.events, identity, {
    nodes: parsed.nodes,
    relationships: parsed.relationships,
    legacyObservations: legacy,
  });

  const check = verifySnapshot(snapshot, ledger.events);
  if (!check.valid) {
    throw new Error(`migration verification failed: ${check.reason}`);
  }

  writeEventsSync(eventsPathFor(resolved), ledger.events);
  const tmp = `${resolved}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, resolved);

  // Source preserved at .v1.bak; original path now holds verified v2.
  if (!existsSync(bakPath)) {
    throw new Error("migration aborted: v1 backup missing after write");
  }

  return snapshot;
}

export { computeEventRoot, eventsPathFor };
