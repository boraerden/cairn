import { useRef, useState } from "react";
import type { Attachment } from "@cairn/types";
import { useMediaUpload } from "./useMediaUpload";

interface Props {
  projectId: string;
  featureId: string;
  onAttached: (a: Attachment) => void;
}

const MAX_VIDEO_SECONDS = 60;

export function VideoCapture({ projectId, featureId, onAttached }: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const enqueue = useMediaUpload();
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const { durationMs, posterBlob, width, height } = await extractPosterAndDuration(file);
      if (durationMs && durationMs / 1000 > MAX_VIDEO_SECONDS) {
        alert(`Video too long (max ${MAX_VIDEO_SECONDS}s). Please re-record.`);
        return;
      }
      const attachment = await enqueue({
        projectId,
        featureId,
        kind: "video",
        blob: file,
        ...(posterBlob ? { thumbBlob: posterBlob } : {}),
        mimeType: file.type || "video/mp4",
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
      });
      onAttached(attachment);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? "…" : "Video"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
    </>
  );
}

interface Poster {
  durationMs?: number;
  posterBlob?: Blob;
  width?: number;
  height?: number;
}

function extractPosterAndDuration(file: File): Promise<Poster> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    const cleanup = () => URL.revokeObjectURL(url);

    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined;
      video.currentTime = Math.min(0.5, Math.max(0, (durationMs ?? 1000) / 2 / 1000));
      video.onseeked = () => {
        const canvas = document.createElement("canvas");
        const targetW = 480;
        const scale = targetW / width;
        canvas.width = targetW;
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            cleanup();
            resolve({
              ...(durationMs !== undefined ? { durationMs } : {}),
              ...(blob ? { posterBlob: blob } : {}),
              width,
              height,
            });
          },
          "image/webp",
          0.8,
        );
      };
    };

    video.onerror = () => {
      cleanup();
      resolve({});
    };
  });
}
