import { ALLOWED_MIME, MEDIA_SIZE_LIMITS, type AttachmentKind, type PresignUploadRequest } from "@cairn/types";
import { env, S3_KEYS } from "./env.js";
import { presignGet, presignPut } from "./s3.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PresignRequest extends PresignUploadRequest {}

export interface PresignResponse {
  key: string;
  uploadUrl: string;
  thumbKey?: string;
  thumbUploadUrl?: string;
  maxBytes: number;
  expiresIn: number;
}

function extForMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/png": "png",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  return map[mime] ?? "bin";
}

export function validatePresignRequest(req: PresignRequest): void {
  if (!UUID_RE.test(req.projectId)) throw new Error("projectId must be a uuid");
  if (!UUID_RE.test(req.featureId)) throw new Error("featureId must be a uuid");
  if (!UUID_RE.test(req.mediaId)) throw new Error("mediaId must be a uuid");
  if (!["photo", "audio", "video"].includes(req.kind)) throw new Error("invalid kind");
  const allowed = ALLOWED_MIME[req.kind];
  if (!allowed.includes(req.mimeType)) {
    throw new Error(`mimeType ${req.mimeType} not allowed for ${req.kind}`);
  }
  const max = MEDIA_SIZE_LIMITS[req.kind];
  if (!Number.isFinite(req.size) || req.size <= 0 || req.size > max) {
    throw new Error(`size out of range (max ${max} bytes for ${req.kind})`);
  }
}

export async function presignUpload(req: PresignRequest): Promise<PresignResponse> {
  validatePresignRequest(req);
  const ext = extForMime(req.mimeType);
  const key = `${S3_KEYS.projectMediaPrefix(req.projectId)}${req.featureId}/${req.mediaId}.${ext}`;
  const ttl = env.PRESIGN_PUT_TTL_SECONDS;
  const uploadUrl = await presignPut(key, req.mimeType, ttl);

  const base: PresignResponse = {
    key,
    uploadUrl,
    maxBytes: MEDIA_SIZE_LIMITS[req.kind],
    expiresIn: ttl,
  };

  if (req.withThumb && (req.kind === "photo" || req.kind === "video")) {
    const thumbKey = `${S3_KEYS.projectMediaPrefix(req.projectId)}${req.featureId}/${req.mediaId}.thumb.webp`;
    const thumbUploadUrl = await presignPut(thumbKey, "image/webp", ttl);
    base.thumbKey = thumbKey;
    base.thumbUploadUrl = thumbUploadUrl;
  }

  return base;
}

export async function presignRead(projectId: string, key: string): Promise<string> {
  if (!key.startsWith(S3_KEYS.projectMediaPrefix(projectId))) throw new Error("key outside project media prefix");
  return presignGet(key, env.PRESIGN_GET_TTL_SECONDS);
}
