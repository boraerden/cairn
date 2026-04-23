import { emptyCollection, sanitizeCollection, type CairnFeatureCollection } from "@cairn/types";
import { S3_KEYS } from "./env.js";
import { getObjectText, putObjectText } from "./s3.js";

export interface MapDoc {
  collection: CairnFeatureCollection;
  etag: string;
}

export async function readMapDoc(projectId: string): Promise<MapDoc> {
  const obj = await getObjectText(S3_KEYS.projectMapDoc(projectId));
  if (!obj) {
    return { collection: emptyCollection(), etag: "" };
  }
  const parsed = JSON.parse(obj.body) as CairnFeatureCollection;
  return { collection: parsed, etag: obj.etag };
}

export async function writeMapDoc(
  projectId: string,
  collection: CairnFeatureCollection,
  ifMatchEtag: string | null,
): Promise<{ etag: string; conflict: boolean; current?: MapDoc }> {
  const current = await readMapDoc(projectId);
  if (ifMatchEtag !== null && current.etag && ifMatchEtag !== current.etag) {
    const merged = tryAutoMerge(current.collection, collection);
    if (!merged) {
      return { etag: current.etag, conflict: true, current };
    }
    collection = merged;
  }
  const sanitized = sanitizeCollection(collection);
  const body = JSON.stringify(sanitized);
  const { etag } = await putObjectText(S3_KEYS.projectMapDoc(projectId), body);
  return { etag, conflict: false };
}

/**
 * Auto-merge when the two versions touch disjoint feature ids.
 * Returns null if both sides modify the same feature id (true conflict).
 */
function tryAutoMerge(
  server: CairnFeatureCollection,
  incoming: CairnFeatureCollection,
): CairnFeatureCollection | null {
  const serverById = new Map(server.features.map((f) => [f.properties.id, f]));
  const incomingById = new Map(incoming.features.map((f) => [f.properties.id, f]));

  for (const [id, incomingFeature] of incomingById) {
    const serverFeature = serverById.get(id);
    if (!serverFeature) continue;
    if (serverFeature.properties.updatedAt !== incomingFeature.properties.updatedAt) {
      return null;
    }
  }

  const mergedFeatures = new Map(serverById);
  for (const [id, f] of incomingById) mergedFeatures.set(id, f);
  return { type: "FeatureCollection", features: Array.from(mergedFeatures.values()) };
}
