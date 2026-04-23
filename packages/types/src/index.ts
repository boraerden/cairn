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
  version: number;
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

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  memberEmails: string[];
  lastOpenedBy: Record<string, string>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  memberEmails: string[];
  lastOpenedAt: string | null;
  canManageMembers: boolean;
}

export interface CreateProjectRequest {
  name: string;
}

export interface ProjectMemberRequest {
  email: string;
}

export interface PresignUploadRequest {
  projectId: string;
  featureId: string;
  mediaId: string;
  kind: AttachmentKind;
  mimeType: string;
  size: number;
  withThumb?: boolean;
}

export interface ProjectEvent {
  type: "project-changed";
  projectId: string;
  updatedAt: string;
  cursor?: string;
}

export interface FeatureRecord {
  id: string;
  projectId: string;
  feature: CairnFeature;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  lastOpId: string;
}

export interface TombstoneRecord {
  projectId: string;
  featureId: string;
  deletedAt: string;
  deletedBy: string;
  deleteOpId: string;
  cursor: string;
}

export interface ProjectSnapshot {
  projectId: string;
  generatedAt: string;
  lastCursor: string | null;
  features: FeatureRecord[];
  tombstones: TombstoneRecord[];
  collection: CairnFeatureCollection;
}

export interface CreateFeatureOp {
  type: "create_feature";
  opId: string;
  projectId: string;
  feature: CairnFeature;
}

export interface UpdateFeatureOp {
  type: "update_feature";
  opId: string;
  projectId: string;
  feature: CairnFeature;
  baseVersion: number;
}

export interface DeleteFeatureOp {
  type: "delete_feature";
  opId: string;
  projectId: string;
  featureId: string;
  baseVersion: number;
}

export type ProjectOp = CreateFeatureOp | UpdateFeatureOp | DeleteFeatureOp;

export interface StoredProjectOp {
  cursor: string;
  actor: string;
  appliedAt: string;
  op: ProjectOp;
}

export interface ProjectOpsRequest {
  ops: ProjectOp[];
}

export interface ProjectOpsResponse {
  applied: StoredProjectOp[];
  snapshot: ProjectSnapshot;
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
