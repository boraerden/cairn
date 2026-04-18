import { useCallback } from "react";
import { v4 as uuid } from "uuid";
import type { Attachment, AttachmentKind } from "@cairn/types";
import { useAuth } from "../auth/AuthProvider";
import { enqueueUpload } from "../offline/syncQueue";

interface EnqueueArgs {
  featureId: string;
  kind: AttachmentKind;
  blob: Blob;
  thumbBlob?: Blob;
  mimeType: string;
  durationMs?: number;
  width?: number;
  height?: number;
}

export function useMediaUpload(): (args: EnqueueArgs) => Promise<Attachment> {
  const { user } = useAuth();
  return useCallback(
    async ({ featureId, kind, blob, thumbBlob, mimeType, durationMs, width, height }) => {
      const mediaId = uuid();
      const attachment: Attachment = {
        id: mediaId,
        kind,
        key: `local:${mediaId}`,
        mimeType,
        size: blob.size,
        createdAt: new Date().toISOString(),
        createdBy: user?.email ?? "unknown",
        syncStatus: "pending",
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(thumbBlob ? { thumbKey: `local-thumb:${mediaId}` } : {}),
      };
      await enqueueUpload({
        id: mediaId,
        featureId,
        mediaId,
        kind,
        mimeType,
        size: blob.size,
        blob,
        ...(thumbBlob ? { thumbBlob } : {}),
        status: "pending",
        attempts: 0,
        createdAt: Date.now(),
      });
      return attachment;
    },
    [user],
  );
}
