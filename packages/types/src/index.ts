import type { Feature, FeatureCollection, Geometry } from "geojson";

export type AttachmentKind = "photo" | "audio" | "video";

export type SyncStatus = "pending" | "uploading" | "uploaded";

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  key: string;
  thumbKey?: string;
  mimeType: string;
  size: number;
  durationMs?: number;
  width?: number;
  height?: number;
  createdAt: string;
  createdBy: string;
  /** Local-only; stripped from server payloads. */
  syncStatus?: SyncStatus;
}

export interface CairnFeatureProperties {
  id: string;
  title: string;
  note: string;
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export type CairnFeature = Feature<Geometry, CairnFeatureProperties>;

export type CairnFeatureCollection = FeatureCollection<Geometry, CairnFeatureProperties>;

export type UserRole = "admin" | "editor";

export interface UserRecord {
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
}

export interface JwtClaims {
  sub: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export const MEDIA_SIZE_LIMITS: Record<AttachmentKind, number> = {
  photo: 10 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  video: 100 * 1024 * 1024,
};

export const ALLOWED_MIME: Record<AttachmentKind, readonly string[]> = {
  photo: ["image/jpeg", "image/webp", "image/png"],
  audio: ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
};

/** Strip local-only fields before persisting to S3. */
export function sanitizeFeature(feature: CairnFeature): CairnFeature {
  const attachments = feature.properties.attachments.map((a) => {
    const { syncStatus: _syncStatus, ...rest } = a;
    return rest satisfies Attachment;
  });
  return {
    ...feature,
    properties: { ...feature.properties, attachments },
  };
}

export function sanitizeCollection(fc: CairnFeatureCollection): CairnFeatureCollection {
  return { ...fc, features: fc.features.map(sanitizeFeature) };
}

export function emptyCollection(): CairnFeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
