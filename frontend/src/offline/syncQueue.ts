import { api } from "../api";
import {
  deleteQueued,
  listQueued,
  putMediaBlob,
  putQueued,
  type QueuedUpload,
} from "./db";

type Listener = (items: QueuedUpload[]) => void;
const listeners = new Set<Listener>();

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  listQueued().then((items) => listener(items));
  return () => listeners.delete(listener);
}

async function notify(): Promise<void> {
  const items = await listQueued();
  for (const fn of listeners) fn(items);
}

export async function enqueueUpload(item: QueuedUpload): Promise<void> {
  await putQueued(item);
  await putMediaBlob(`local:${item.id}`, item.blob);
  if (item.thumbBlob) await putMediaBlob(`local-thumb:${item.id}`, item.thumbBlob);
  await notify();
  void drainQueue();
}

let draining = false;

export async function drainQueue(): Promise<void> {
  if (draining) return;
  if (!navigator.onLine) return;
  draining = true;
  try {
    const items = await listQueued();
    for (const item of items) {
      if (item.status === "uploaded") continue;
      try {
        await uploadOne(item);
      } catch (err) {
        item.status = "error";
        item.attempts += 1;
        item.lastError = err instanceof Error ? err.message : String(err);
        await putQueued(item);
        await notify();
        await wait(backoff(item.attempts));
      }
    }
  } finally {
    draining = false;
  }
}

interface PresignResponse {
  key: string;
  uploadUrl: string;
  thumbKey?: string;
  thumbUploadUrl?: string;
  expiresIn: number;
}

async function uploadOne(item: QueuedUpload): Promise<void> {
  item.status = "uploading";
  await putQueued(item);
  await notify();

  const projectMediaPath = `/projects/${encodeURIComponent(item.projectId)}/media/presign`;

  const presign = await api<PresignResponse>("POST", projectMediaPath, {
    body: {
      projectId: item.projectId,
      featureId: item.featureId,
      mediaId: item.mediaId,
      kind: item.kind,
      mimeType: item.mimeType,
      size: item.size,
      withThumb: Boolean(item.thumbBlob),
    },
  });

  await putBlob(presign.uploadUrl, item.blob, item.mimeType);

  if (presign.thumbUploadUrl && item.thumbBlob) {
    await putBlob(presign.thumbUploadUrl, item.thumbBlob, "image/webp");
  }

  item.key = presign.key;
  if (presign.thumbKey) item.thumbKey = presign.thumbKey;
  item.status = "uploaded";
  await putQueued(item);

  if (presign.key) await putMediaBlob(presign.key, item.blob);
  if (presign.thumbKey && item.thumbBlob) await putMediaBlob(presign.thumbKey, item.thumbBlob);

  await deleteQueued(item.id);
  await notify();
}

function putBlob(url: string, blob: Blob, contentType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`S3 ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("network error"));
    xhr.send(blob);
  });
}

function backoff(attempts: number): number {
  return Math.min(30_000, 1000 * 2 ** attempts);
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void drainQueue());
  window.addEventListener("focus", () => void drainQueue());
  setInterval(() => {
    if (navigator.onLine) void drainQueue();
  }, 30_000);
}
