import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CairnFeatureCollection } from "@cairn/types";

export interface QueuedUpload {
  id: string;
  projectId: string;
  featureId: string;
  mediaId: string;
  kind: "photo" | "audio" | "video";
  mimeType: string;
  size: number;
  key?: string;
  thumbKey?: string;
  /** Local blob cached for retries + offline playback. */
  blob: Blob;
  thumbBlob?: Blob;
  status: "pending" | "uploading" | "uploaded" | "error";
  attempts: number;
  lastError?: string;
  createdAt: number;
}

export interface StoredMapDoc {
  projectId: string;
  etag: string;
  collection: CairnFeatureCollection;
  savedAt: number;
  dirty: boolean;
}

export interface StoredRegion {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  minZoom: number;
  maxZoom: number;
  tileCount: number;
  bytes: number;
  createdAt: number;
}

interface CairnDB extends DBSchema {
  queue: { key: string; value: QueuedUpload };
  mapDoc: { key: string; value: StoredMapDoc };
  mediaBlobs: { key: string; value: { key: string; blob: Blob } };
  regions: { key: string; value: StoredRegion };
}

let dbp: Promise<IDBPDatabase<CairnDB>> | null = null;

export function db(): Promise<IDBPDatabase<CairnDB>> {
  if (!dbp) {
    dbp = openDB<CairnDB>("cairn", 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("queue", { keyPath: "id" });
          db.createObjectStore("mapDoc");
          db.createObjectStore("mediaBlobs", { keyPath: "key" });
          db.createObjectStore("regions", { keyPath: "id" });
        }
      },
    });
  }
  return dbp;
}

export async function putQueued(item: QueuedUpload): Promise<void> {
  const d = await db();
  await d.put("queue", item);
}

export async function listQueued(): Promise<QueuedUpload[]> {
  const d = await db();
  return d.getAll("queue");
}

export async function getQueued(id: string): Promise<QueuedUpload | undefined> {
  const d = await db();
  return d.get("queue", id);
}

export async function deleteQueued(id: string): Promise<void> {
  const d = await db();
  await d.delete("queue", id);
}

export async function putMediaBlob(key: string, blob: Blob): Promise<void> {
  const d = await db();
  await d.put("mediaBlobs", { key, blob });
}

export async function getMediaBlob(key: string): Promise<Blob | undefined> {
  const d = await db();
  const rec = await d.get("mediaBlobs", key);
  return rec?.blob;
}

export async function saveMapDoc(projectId: string, doc: StoredMapDoc): Promise<void> {
  const d = await db();
  await d.put("mapDoc", doc, projectId);
}

export async function loadMapDoc(projectId: string): Promise<StoredMapDoc | undefined> {
  const d = await db();
  return d.get("mapDoc", projectId);
}

export async function listRegions(): Promise<StoredRegion[]> {
  const d = await db();
  return d.getAll("regions");
}

export async function putRegion(region: StoredRegion): Promise<void> {
  const d = await db();
  await d.put("regions", region);
}

export async function deleteRegion(id: string): Promise<void> {
  const d = await db();
  await d.delete("regions", id);
}
