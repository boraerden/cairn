import { useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import type { Attachment } from "@cairn/types";
import { useMediaUpload } from "./useMediaUpload";

interface Props {
  featureId: string;
  onAttached: (a: Attachment) => void;
}

export function PhotoCapture({ featureId, onAttached }: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const enqueue = useMediaUpload();
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 2,
        maxWidthOrHeight: 1600,
        useWebWorker: true,
        fileType: "image/webp",
      });
      const thumb = await imageCompression(file, {
        maxSizeMB: 0.12,
        maxWidthOrHeight: 300,
        useWebWorker: true,
        fileType: "image/webp",
      });
      const dims = await readImageDimensions(compressed);
      const attachment = await enqueue({
        featureId,
        kind: "photo",
        blob: compressed,
        thumbBlob: thumb,
        mimeType: "image/webp",
        width: dims.width,
        height: dims.height,
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
        {busy ? "…" : "Photo"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
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

function readImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(dims);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });
}
