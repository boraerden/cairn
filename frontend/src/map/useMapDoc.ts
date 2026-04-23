import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyCollection,
  sanitizeCollection,
  type CairnFeature,
  type CairnFeatureCollection,
  type ProjectOp,
  type ProjectOpsResponse,
  type ProjectSnapshot,
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
  const syncedCollectionRef = useRef<CairnFeatureCollection>(emptyCollection());

  const load = useCallback(async () => {
    setStatus("loading");
    const local = await loadMapDoc(projectId);
    if (local) {
      setCollection(local.collection);
      setEtag(local.etag || null);
      syncedCollectionRef.current = local.baseCollection ?? local.collection;
    }
    try {
      const res = await apiFetch("GET", `/projects/${encodeURIComponent(projectId)}/snapshot`);
      if (res.status === 200) {
        const remote = res.body as ProjectSnapshot;
        setEtag(remote.lastCursor);
        if (local?.dirty) {
          setStatus("ready");
        } else {
          setCollection(remote.collection);
          syncedCollectionRef.current = remote.collection;
          await saveMapDoc(projectId, {
            projectId,
            etag: remote.lastCursor ?? "",
            collection: remote.collection,
            baseCollection: remote.collection,
            savedAt: Date.now(),
            dirty: false,
          });
          setStatus("ready");
        }
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
        baseCollection: syncedCollectionRef.current,
        savedAt: Date.now(),
        dirty: true,
      });
      if (!navigator.onLine) {
        setStatus("offline");
        return;
      }
      const ops = createOps(projectIdRef.current, syncedCollectionRef.current, body);
      if (ops.length === 0) {
        dirtyRef.current = false;
        await saveMapDoc(projectIdRef.current, {
          projectId: projectIdRef.current,
          etag: etagRef.current ?? "",
          collection: body,
          baseCollection: syncedCollectionRef.current,
          savedAt: Date.now(),
          dirty: false,
        });
        setStatus("ready");
        return;
      }
      const res = await apiFetch("POST", `/projects/${encodeURIComponent(projectIdRef.current)}/ops`, {
        body: { ops },
      });
      if (res.status === 200) {
        const payload = res.body as ProjectOpsResponse;
        setCollection(payload.snapshot.collection);
        syncedCollectionRef.current = payload.snapshot.collection;
        setEtag(payload.snapshot.lastCursor);
        await saveMapDoc(projectIdRef.current, {
          projectId: projectIdRef.current,
          etag: payload.snapshot.lastCursor ?? "",
          collection: payload.snapshot.collection,
          baseCollection: payload.snapshot.collection,
          savedAt: Date.now(),
          dirty: false,
        });
        dirtyRef.current = false;
        setStatus("ready");
        channelRef.current?.postMessage({
          projectId: projectIdRef.current,
          source: tabIdRef.current,
          updatedAt: new Date().toISOString(),
          cursor: payload.snapshot.lastCursor,
        });
      } else if (res.status === 409) {
        const current = (res.body as { current?: ProjectSnapshot } | null)?.current;
        if (current) {
          syncedCollectionRef.current = current.collection;
          setCollection(current.collection);
          setEtag(current.lastCursor);
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
        const nextFeature = sanitizeCollection({
          type: "FeatureCollection",
          features: [feature],
        }).features[0] as CairnFeature;
        const next: CairnFeatureCollection =
          idx === -1
            ? { ...prev, features: [...prev.features, nextFeature] }
            : { ...prev, features: prev.features.map((f, i) => (i === idx ? nextFeature : f)) };
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

function createOps(projectId: string, base: CairnFeatureCollection, current: CairnFeatureCollection): ProjectOp[] {
  const baseById = new Map(base.features.map((feature) => [feature.properties.id, feature]));
  const currentById = new Map(current.features.map((feature) => [feature.properties.id, feature]));
  const ops: ProjectOp[] = [];

  for (const feature of current.features) {
    const existing = baseById.get(feature.properties.id);
    if (!existing) {
      ops.push({
        type: "create_feature",
        opId: crypto.randomUUID(),
        projectId,
        feature: withVersion(feature, 0),
      });
      continue;
    }
    if (JSON.stringify(existing) !== JSON.stringify(feature)) {
      ops.push({
        type: "update_feature",
        opId: crypto.randomUUID(),
        projectId,
        feature: withVersion(feature, existing.properties.version),
        baseVersion: existing.properties.version,
      });
    }
  }

  for (const feature of base.features) {
    if (!currentById.has(feature.properties.id)) {
      ops.push({
        type: "delete_feature",
        opId: crypto.randomUUID(),
        projectId,
        featureId: feature.properties.id,
        baseVersion: feature.properties.version,
      });
    }
  }

  return ops;
}

function withVersion(feature: CairnFeature, version: number): CairnFeature {
  return {
    ...feature,
    properties: {
      ...feature.properties,
      version,
    },
  };
}
