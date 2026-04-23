import { randomUUID } from "node:crypto";
import {
  emptyCollection,
  sanitizeFeature,
  type CairnFeature,
  type CairnFeatureCollection,
  type FeatureRecord,
  type ProjectOp,
  type ProjectOpsResponse,
  type ProjectSnapshot,
  type StoredProjectOp,
  type TombstoneRecord,
} from "@cairn/types";
import { S3_KEYS } from "./env.js";
import { touchProject } from "./projects.js";
import { deleteObject, getObjectText, listObjectKeys, putObjectText } from "./s3.js";

interface ProjectStateMeta {
  projectId: string;
  schemaVersion: number;
  lastCursor: string | null;
  migratedAt: string;
  lastCompactedAt: string;
}

interface ApplyOpsResult {
  ok: boolean;
  response?: ProjectOpsResponse;
  snapshot?: ProjectSnapshot;
  reason?: string;
}

export async function readProjectSnapshot(projectId: string): Promise<ProjectSnapshot> {
  await ensureProjectState(projectId);
  const snapshot = await loadStoredSnapshot(projectId);
  if (snapshot) return snapshot;
  const built = await buildProjectSnapshot(projectId);
  await saveProjectSnapshot(projectId, built);
  return built;
}

export async function readProjectOps(projectId: string, since: string | null): Promise<StoredProjectOp[]> {
  await ensureProjectState(projectId);
  const keys = await listObjectKeys(S3_KEYS.projectOpsPrefix(projectId));
  const filtered = since ? keys.filter((key) => cursorFromKey(key) > since) : keys;
  const objects = await Promise.all(filtered.map((key) => getObjectText(key)));
  return objects
    .filter((value): value is { body: string; etag: string } => Boolean(value))
    .map((value) => JSON.parse(value.body) as StoredProjectOp)
    .sort((a, b) => a.cursor.localeCompare(b.cursor));
}

export async function applyProjectOps(projectId: string, actor: string, ops: ProjectOp[]): Promise<ApplyOpsResult> {
  await ensureProjectState(projectId);
  const meta = await loadProjectMeta(projectId);
  const featureKeys = await listObjectKeys(S3_KEYS.projectFeaturesPrefix(projectId));
  const tombstoneKeys = await listObjectKeys(S3_KEYS.projectTombstonesPrefix(projectId));
  const featureRecords = await readFeatureRecords(featureKeys);
  const tombstones = await readTombstones(tombstoneKeys);
  const featureMap = new Map(featureRecords.map((record) => [record.id, record]));
  const tombstoneMap = new Map(tombstones.map((record) => [record.featureId, record]));
  const applied: StoredProjectOp[] = [];

  for (const op of ops) {
    const now = new Date().toISOString();
    const cursor = nextCursor();
    const tombstone =
      op.type === "delete_feature" ? tombstoneMap.get(op.featureId) : tombstoneMap.get(op.feature.properties.id);
    if (tombstone) {
      if (op.type === "delete_feature") {
        const stored = { cursor, actor, appliedAt: now, op };
        applied.push(stored);
        await putObjectText(S3_KEYS.projectOp(projectId, cursor), JSON.stringify(stored));
        continue;
      }
      return {
        ok: false,
        reason: "feature deleted",
        snapshot: snapshotFromMaps(projectId, featureMap, tombstoneMap, applied.at(-1)?.cursor ?? meta?.lastCursor ?? null),
      };
    }

    if (op.type === "create_feature") {
      if (featureMap.has(op.feature.properties.id)) {
        return {
          ok: false,
          reason: "feature already exists",
          snapshot: snapshotFromMaps(projectId, featureMap, tombstoneMap, applied.at(-1)?.cursor ?? meta?.lastCursor ?? null),
        };
      }
      const record = makeRecord(projectId, actor, op.feature, 1, op.opId, now);
      featureMap.set(record.id, record);
      await putObjectText(S3_KEYS.projectFeature(projectId, record.id), JSON.stringify(record));
      const stored = { cursor, actor, appliedAt: now, op };
      applied.push(stored);
      await putObjectText(S3_KEYS.projectOp(projectId, cursor), JSON.stringify(stored));
      continue;
    }

    if (op.type === "update_feature") {
      const current = featureMap.get(op.feature.properties.id);
      if (!current) {
        return {
          ok: false,
          reason: "feature not found",
          snapshot: snapshotFromMaps(projectId, featureMap, tombstoneMap, applied.at(-1)?.cursor ?? meta?.lastCursor ?? null),
        };
      }
      if (current.version !== op.baseVersion) {
        return {
          ok: false,
          reason: "conflict",
          snapshot: snapshotFromMaps(projectId, featureMap, tombstoneMap, applied.at(-1)?.cursor ?? meta?.lastCursor ?? null),
        };
      }
      const record = makeRecord(projectId, actor, op.feature, current.version + 1, op.opId, now, current);
      featureMap.set(record.id, record);
      await putObjectText(S3_KEYS.projectFeature(projectId, record.id), JSON.stringify(record));
      const stored = { cursor, actor, appliedAt: now, op };
      applied.push(stored);
      await putObjectText(S3_KEYS.projectOp(projectId, cursor), JSON.stringify(stored));
      continue;
    }

    const current = featureMap.get(op.featureId);
    if (!current) {
      const stored = { cursor, actor, appliedAt: now, op };
      applied.push(stored);
      await putObjectText(S3_KEYS.projectOp(projectId, cursor), JSON.stringify(stored));
      continue;
    }
    if (current.version !== op.baseVersion) {
      return {
        ok: false,
        reason: "conflict",
        snapshot: snapshotFromMaps(projectId, featureMap, tombstoneMap, applied.at(-1)?.cursor ?? meta?.lastCursor ?? null),
      };
    }
    const tombstoneRecord: TombstoneRecord = {
      projectId,
      featureId: op.featureId,
      deletedAt: now,
      deletedBy: actor,
      deleteOpId: op.opId,
      cursor,
    };
    tombstoneMap.set(op.featureId, tombstoneRecord);
    featureMap.delete(op.featureId);
    await putObjectText(S3_KEYS.projectTombstone(projectId, op.featureId), JSON.stringify(tombstoneRecord));
    await deleteObject(S3_KEYS.projectFeature(projectId, op.featureId));
    const stored = { cursor, actor, appliedAt: now, op };
    applied.push(stored);
    await putObjectText(S3_KEYS.projectOp(projectId, cursor), JSON.stringify(stored));
  }

  const snapshot = snapshotFromMaps(projectId, featureMap, tombstoneMap, applied.at(-1)?.cursor ?? meta?.lastCursor ?? null);
  await saveProjectSnapshot(projectId, snapshot);
  await saveProjectMeta(projectId, {
    projectId,
    schemaVersion: 2,
    lastCursor: snapshot.lastCursor,
    migratedAt: meta?.migratedAt ?? new Date().toISOString(),
    lastCompactedAt: snapshot.generatedAt,
  });
  if (applied.length > 0) await touchProject(projectId);
  return { ok: true, response: { applied, snapshot } };
}

export function collectionToOps(
  projectId: string,
  actor: string,
  current: ProjectSnapshot,
  incoming: CairnFeatureCollection,
): ProjectOp[] {
  const currentById = new Map(current.features.map((record) => [record.id, record]));
  const incomingById = new Map(incoming.features.map((feature) => [feature.properties.id, feature]));
  const ops: ProjectOp[] = [];

  for (const feature of incoming.features) {
    const currentRecord = currentById.get(feature.properties.id);
    if (!currentRecord) {
      ops.push({
        type: "create_feature",
        opId: randomUUID(),
        projectId,
        feature: featureWithVersion(feature, 0),
      });
      continue;
    }
    if (JSON.stringify(sanitizeFeature(currentRecord.feature)) !== JSON.stringify(sanitizeFeature(feature))) {
      ops.push({
        type: "update_feature",
        opId: randomUUID(),
        projectId,
        feature: featureWithVersion(feature, currentRecord.version),
        baseVersion: currentRecord.version,
      });
    }
  }

  for (const record of current.features) {
    if (!incomingById.has(record.id)) {
      ops.push({
        type: "delete_feature",
        opId: randomUUID(),
        projectId,
        featureId: record.id,
        baseVersion: record.version,
      });
    }
  }

  return ops;
}

async function ensureProjectState(projectId: string): Promise<void> {
  const meta = await getObjectText(S3_KEYS.projectMeta(projectId));
  if (meta) return;

  const legacy = await getObjectText(S3_KEYS.projectMapDoc(projectId));
  const migratedAt = new Date().toISOString();
  if (!legacy) {
    await saveProjectMeta(projectId, {
      projectId,
      schemaVersion: 2,
      lastCursor: null,
      migratedAt,
      lastCompactedAt: migratedAt,
    });
    await saveProjectSnapshot(projectId, {
      projectId,
      generatedAt: migratedAt,
      lastCursor: null,
      features: [],
      tombstones: [],
      collection: emptyCollection(),
    });
    return;
  }

  const parsed = JSON.parse(legacy.body) as CairnFeatureCollection;
  const records = parsed.features.map((feature) =>
    makeRecord(projectId, feature.properties.createdBy, featureWithVersion(feature, feature.properties.version || 1), 1, "migration", migratedAt),
  );
  await Promise.all(
    records.map((record) => putObjectText(S3_KEYS.projectFeature(projectId, record.id), JSON.stringify(record))),
  );
  await saveProjectMeta(projectId, {
    projectId,
    schemaVersion: 2,
    lastCursor: null,
    migratedAt,
    lastCompactedAt: migratedAt,
  });
  await saveProjectSnapshot(projectId, {
    projectId,
    generatedAt: migratedAt,
    lastCursor: null,
    features: records,
    tombstones: [],
    collection: toCollection(records),
  });
}

async function loadStoredSnapshot(projectId: string): Promise<ProjectSnapshot | null> {
  const obj = await getObjectText(S3_KEYS.projectSnapshot(projectId));
  if (!obj) return null;
  return JSON.parse(obj.body) as ProjectSnapshot;
}

async function loadProjectMeta(projectId: string): Promise<ProjectStateMeta | null> {
  const obj = await getObjectText(S3_KEYS.projectMeta(projectId));
  if (!obj) return null;
  return JSON.parse(obj.body) as ProjectStateMeta;
}

async function saveProjectSnapshot(projectId: string, snapshot: ProjectSnapshot): Promise<void> {
  await putObjectText(S3_KEYS.projectSnapshot(projectId), JSON.stringify(snapshot));
}

async function saveProjectMeta(projectId: string, meta: ProjectStateMeta): Promise<void> {
  await putObjectText(S3_KEYS.projectMeta(projectId), JSON.stringify(meta));
}

async function readFeatureRecords(keys: string[]): Promise<FeatureRecord[]> {
  const objects = await Promise.all(keys.map((key) => getObjectText(key)));
  return objects
    .filter((value): value is { body: string; etag: string } => Boolean(value))
    .map((value) => JSON.parse(value.body) as FeatureRecord)
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function readTombstones(keys: string[]): Promise<TombstoneRecord[]> {
  const objects = await Promise.all(keys.map((key) => getObjectText(key)));
  return objects
    .filter((value): value is { body: string; etag: string } => Boolean(value))
    .map((value) => JSON.parse(value.body) as TombstoneRecord)
    .sort((a, b) => a.cursor.localeCompare(b.cursor));
}

async function buildProjectSnapshot(projectId: string): Promise<ProjectSnapshot> {
  const meta = await loadProjectMeta(projectId);
  const featureKeys = await listObjectKeys(S3_KEYS.projectFeaturesPrefix(projectId));
  const tombstoneKeys = await listObjectKeys(S3_KEYS.projectTombstonesPrefix(projectId));
  const records = await readFeatureRecords(featureKeys);
  const tombstones = await readTombstones(tombstoneKeys);
  return snapshotFromMaps(
    projectId,
    new Map(records.map((record) => [record.id, record])),
    new Map(tombstones.map((record) => [record.featureId, record])),
    meta?.lastCursor ?? tombstones.at(-1)?.cursor ?? null,
  );
}

function snapshotFromMaps(
  projectId: string,
  featureMap: Map<string, FeatureRecord>,
  tombstoneMap: Map<string, TombstoneRecord>,
  lastCursor: string | null,
): ProjectSnapshot {
  const features = Array.from(featureMap.values()).sort((a, b) => a.id.localeCompare(b.id));
  const tombstones = Array.from(tombstoneMap.values()).sort((a, b) => a.cursor.localeCompare(b.cursor));
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    lastCursor,
    features,
    tombstones,
    collection: toCollection(features),
  };
}

function toCollection(records: FeatureRecord[]): CairnFeatureCollection {
  return {
    type: "FeatureCollection",
    features: records.map((record) => record.feature),
  };
}

function makeRecord(
  projectId: string,
  actor: string,
  feature: CairnFeature,
  version: number,
  opId: string,
  now: string,
  current?: FeatureRecord,
): FeatureRecord {
  const nextFeature = sanitizeFeature(featureWithVersion(feature, version));
  return {
    id: nextFeature.properties.id,
    projectId,
    feature: nextFeature,
    createdAt: current?.createdAt ?? nextFeature.properties.createdAt,
    createdBy: current?.createdBy ?? nextFeature.properties.createdBy,
    updatedAt: now,
    updatedBy: actor,
    version,
    lastOpId: opId,
  };
}

function featureWithVersion(feature: CairnFeature, version: number): CairnFeature {
  return {
    ...feature,
    properties: {
      ...feature.properties,
      version,
    },
  };
}

function nextCursor(): string {
  return `${new Date().toISOString()}_${randomUUID()}`;
}

function cursorFromKey(key: string): string {
  return key.split("/").pop()?.replace(/\.json$/, "") ?? "";
}
