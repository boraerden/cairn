import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyCollection,
  sanitizeCollection,
  type CairnFeature,
  type CairnFeatureCollection,
} from "@cairn/types";
import { apiFetch, ApiError } from "../api";
import { API_URL } from "../config";
import { loadMapDoc, saveMapDoc } from "../offline/db";

type Status = "loading" | "ready" | "saving" | "conflict" | "offline" | "error";

interface UseMapDoc {
  collection: CairnFeatureCollection;
  etag: string | null;
  status: Status;
  error: string | null;
  upsertFeature: (feature: CairnFeature) => void;
  deleteFeature: (id: string) => void;
  replaceAll: (fc: CairnFeatureCollection) => void;
  flush: () => Promise<void>;
  reload: () => Promise<void>;
}

const SAVE_DEBOUNCE_MS = 1200;
const POLL_MS = 10_000;
const CHANNEL_NAME = "cairn-project-events";

export function useMapDoc(projectId: string): UseMapDoc {
  const [collection, setCollection] = useState<CairnFeatureCollection>(emptyCollection());
  const [etag, setEtag] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const projectIdRef = useRef(projectId);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabIdRef = useRef(Math.random().toString(36).slice(2));

  const load = useCallback(async () => {
    setStatus("loading");
    const local = await loadMapDoc(projectId);
    if (local) {
      setCollection(local.collection);
      setEtag(local.etag || null);
    }
    try {
      const res = await apiFetch("GET", `/projects/${encodeURIComponent(projectId)}/map`);
      if (res.status === 200) {
        const remote = res.body as CairnFeatureCollection;
        setCollection(remote);
        setEtag(res.etag);
        await saveMapDoc(projectId, {
          projectId,
          etag: res.etag ?? "",
          collection: remote,
          savedAt: Date.now(),
          dirty: false,
        });
        setStatus("ready");
      } else if (res.status === 401) {
        setStatus("error");
        setError("unauthorized");
      } else {
        setStatus("error");
        setError(`HTTP ${res.status}`);
      }
    } catch {
      setStatus(local ? "offline" : "error");
    }
  }, [projectId]);

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void flushInternal();
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const flushInternal = useCallback(async () => {
    if (savingRef.current) return;
    if (!dirtyRef.current) return;
    savingRef.current = true;
    setStatus("saving");
    try {
      const body = sanitizeCollection(collectionRef.current);
      await saveMapDoc(projectIdRef.current, {
        projectId: projectIdRef.current,
        etag: etagRef.current ?? "",
        collection: body,
        savedAt: Date.now(),
        dirty: true,
      });
      if (!navigator.onLine) {
        setStatus("offline");
        return;
      }
      const res = await apiFetch("PUT", `/projects/${encodeURIComponent(projectIdRef.current)}/map`, {
        body,
        ifMatch: etagRef.current,
      });
      if (res.status === 200) {
        setEtag(res.etag);
        await saveMapDoc(projectIdRef.current, {
          projectId: projectIdRef.current,
          etag: res.etag ?? "",
          collection: body,
          savedAt: Date.now(),
          dirty: false,
        });
        dirtyRef.current = false;
        setStatus("ready");
        channelRef.current?.postMessage({
          projectId: projectIdRef.current,
          source: tabIdRef.current,
          updatedAt: new Date().toISOString(),
        });
      } else if (res.status === 409) {
        const current = (res.body as { current?: CairnFeatureCollection } | null)?.current;
        if (current) {
          setCollection(current);
          setEtag(res.etag);
          setStatus("conflict");
        } else {
          setStatus("conflict");
        }
      } else {
        setStatus("error");
        setError(`HTTP ${res.status}`);
      }
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      setStatus("offline");
    } finally {
      savingRef.current = false;
      if (dirtyRef.current && status !== "conflict") {
        window.setTimeout(() => void flushInternal(), 300);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const collectionRef = useRef(collection);
  const etagRef = useRef(etag);
  useEffect(() => {
    collectionRef.current = collection;
  }, [collection]);
  useEffect(() => {
    etagRef.current = etag;
  }, [etag]);

  const upsertFeature = useCallback(
    (feature: CairnFeature) => {
      setCollection((prev) => {
        const idx = prev.features.findIndex((f) => f.properties.id === feature.properties.id);
        const next: CairnFeatureCollection =
          idx === -1
            ? { ...prev, features: [...prev.features, feature] }
            : { ...prev, features: prev.features.map((f, i) => (i === idx ? feature : f)) };
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const deleteFeature = useCallback(
    (id: string) => {
      setCollection((prev) => ({ ...prev, features: prev.features.filter((f) => f.properties.id !== id) }));
      scheduleSave();
    },
    [scheduleSave],
  );

  const replaceAll = useCallback(
    (fc: CairnFeatureCollection) => {
      setCollection(fc);
      scheduleSave();
    },
    [scheduleSave],
  );

  const flush = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await flushInternal();
  }, [flushInternal]);

  useEffect(() => {
    const onOnline = () => {
      if (dirtyRef.current) void flushInternal();
      else void load();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushInternal, load]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      const message = event.data as { projectId?: string; source?: string } | null;
      if (!message || message.projectId !== projectId || message.source === tabIdRef.current) return;
      if (!dirtyRef.current && !savingRef.current) void load();
    };
    return () => {
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [load, projectId]);

  useEffect(() => {
    const token = localStorage.getItem("cairn.token");
    if (!token || !API_URL) return;
    const url = `${API_URL}/projects/${encodeURIComponent(projectId)}/events?token=${encodeURIComponent(token)}`;
    const source = new EventSource(url);
    const onProjectChanged = () => {
      if (!dirtyRef.current && !savingRef.current) void load();
    };
    source.addEventListener("project-changed", onProjectChanged);
    return () => {
      source.removeEventListener("project-changed", onProjectChanged);
      source.close();
    };
  }, [load, projectId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine && !dirtyRef.current && !savingRef.current) {
        void load();
      }
    }, POLL_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  return {
    collection,
    etag,
    status,
    error,
    upsertFeature,
    deleteFeature,
    replaceAll,
    flush,
    reload: load,
  };
}
