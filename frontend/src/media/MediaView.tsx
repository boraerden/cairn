import { useEffect, useState } from "react";
import type { Attachment } from "@cairn/types";
import { api } from "../api";
import { getMediaBlob } from "../offline/db";

interface Props {
  attachment: Attachment;
  onRemove: () => void;
}

export function MediaView({ attachment, onRemove }: Props): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoke: string[] = [];
    let cancelled = false;

    async function resolve(key: string): Promise<string | null> {
      if (key.startsWith("local:") || key.startsWith("local-thumb:")) {
        const blob = await getMediaBlob(key);
        if (!blob) return null;
        const u = URL.createObjectURL(blob);
        revoke.push(u);
        return u;
      }
      const cached = await getMediaBlob(key);
      if (cached) {
        const u = URL.createObjectURL(cached);
        revoke.push(u);
        return u;
      }
      try {
        const res = await api<{ url: string }>("GET", `/media/${encodeURIComponent(key)}`);
        return res.url;
      } catch {
        return null;
      }
    }

    (async () => {
      const u = await resolve(attachment.key);
      if (!cancelled) setUrl(u);
      if (attachment.thumbKey) {
        const t = await resolve(attachment.thumbKey);
        if (!cancelled) setThumbUrl(t);
      }
    })();

    return () => {
      cancelled = true;
      revoke.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [attachment.key, attachment.thumbKey]);

  return (
    <div className="attachment">
      <div className="thumb">{renderThumb(attachment, thumbUrl ?? url)}</div>
      <div>
        <div style={{ fontSize: 13 }}>
          {attachment.kind} · {(attachment.size / 1024).toFixed(0)} KB
          {attachment.durationMs ? ` · ${(attachment.durationMs / 1000).toFixed(1)}s` : ""}
        </div>
        <div className="meta">
          {attachment.key.startsWith("local:") ? "pending upload" : "uploaded"}
        </div>
        {url && attachment.kind === "audio" ? <audio controls src={url} style={{ width: "100%" }} /> : null}
        {url && attachment.kind === "video" ? (
          <video controls src={url} playsInline style={{ width: "100%", maxHeight: 240 }} />
        ) : null}
      </div>
      <button type="button" className="danger" onClick={onRemove} aria-label="Remove">
        ✕
      </button>
    </div>
  );
}

function renderThumb(a: Attachment, src: string | null): JSX.Element {
  if (a.kind === "audio") return <span aria-hidden>♪</span>;
  if (!src) return <span aria-hidden>…</span>;
  if (a.kind === "photo" || a.kind === "video") {
    return <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
  }
  return <span aria-hidden>?</span>;
}
