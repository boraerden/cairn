import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { v4 as uuid } from "uuid";
import type { CairnFeature, CairnFeatureProperties, ProjectSummary } from "@cairn/types";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthProvider";
import { FeatureEditor } from "../editor/FeatureEditor";
import { useMapDoc } from "./useMapDoc";
import { MapView } from "./MapView";
import { useQueueStatus } from "../offline/useQueueStatus";
import { rememberLastProject } from "../projects/ProjectsPage";

type Mode = "select" | "point" | "line" | "polygon";

export function MapPage(): JSX.Element {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const safeProjectId = projectId ?? "";
  const { collection, status, error: mapError, upsertFeature, deleteFeature } = useMapDoc(safeProjectId);
  const queue = useQueueStatus(safeProjectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("select");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const opened = await api<ProjectSummary>("POST", `/projects/${encodeURIComponent(projectId)}/open`);
        if (!cancelled) {
          setProject(opened);
          setPageError(null);
          rememberLastProject(opened.id);
        }
      } catch (err) {
        if (!cancelled) {
          setPageError(err instanceof ApiError ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!selectedId) return;
    if (!collection.features.some((feature) => feature.properties.id === selectedId)) {
      setSelectedId(null);
      setSheetOpen(false);
    }
  }, [collection.features, selectedId]);

  if (!projectId) return <Navigate to="/projects" replace />;
  if (pageError) {
    return (
      <div className="admin-shell">
        <div className="error">{pageError}</div>
        <Link to="/projects">Back to projects</Link>
      </div>
    );
  }

  const selectedFeature = useMemo(
    () => collection.features.find((f) => f.properties.id === selectedId) ?? null,
    [collection, selectedId],
  );

  const handleDrawChange = useCallback(
    (features: GeoJSON.Feature[]) => {
      const existingById = new Map(collection.features.map((f) => [f.properties.id, f]));
      let createdFeatureId: string | null = null;
      for (const raw of features) {
        const id = String(raw.id ?? "");
        if (!id) continue;
        const existing = existingById.get(id);
        const now = new Date().toISOString();
        const properties: CairnFeatureProperties = existing
          ? { ...existing.properties, updatedAt: now }
          : {
              id,
              title: "",
              note: "",
              attachments: [],
              createdAt: now,
              updatedAt: now,
              createdBy: user?.email ?? "unknown",
            };
        if (!existing) createdFeatureId = id;
        const next: CairnFeature = {
          type: "Feature",
          id,
          geometry: raw.geometry as CairnFeature["geometry"],
          properties,
        };
        if (JSON.stringify(existing) !== JSON.stringify(next)) {
          upsertFeature(next);
        }
      }
      if (createdFeatureId) {
        setSelectedId(createdFeatureId);
        setSheetOpen(true);
      }
    },
    [collection, upsertFeature, user],
  );

  const handleSelected = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setSheetOpen(true);
  }, []);

  const handleUpdate = useCallback(
    (feature: CairnFeature) => {
      upsertFeature({
        ...feature,
        properties: { ...feature.properties, updatedAt: new Date().toISOString() },
      });
    },
    [upsertFeature],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteFeature(id);
      setSelectedId(null);
      setSheetOpen(false);
    },
    [deleteFeature],
  );

  const quickAddPhoto = useCallback(async () => {
    if (!navigator.geolocation) return alert("Geolocation not available");
    navigator.geolocation.getCurrentPosition((pos) => {
      const id = uuid();
      const now = new Date().toISOString();
      const feature: CairnFeature = {
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: [pos.coords.longitude, pos.coords.latitude] },
        properties: {
          id,
          title: "",
          note: "",
          attachments: [],
          createdAt: now,
          updatedAt: now,
          createdBy: user?.email ?? "unknown",
        },
      };
      upsertFeature(feature);
      setSelectedId(id);
      setSheetOpen(true);
    });
  }, [upsertFeature, user]);

  return (
    <div className="map-shell">
      <div className="map-header">
        <span className="title">{project?.name ?? "Cairn"}</span>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          {status}
          {mapError ? ` · ${mapError}` : ""}
          {queue.length > 0 ? ` · ${queue.length} pending` : ""}
        </span>
        <div className="spacer" />
        <div className="row">
          <button onClick={() => setMode("select")} className={mode === "select" ? "primary" : ""}>
            Select
          </button>
          <button onClick={() => setMode("point")} className={mode === "point" ? "primary" : ""}>
            Point
          </button>
          <button onClick={() => setMode("line")} className={mode === "line" ? "primary" : ""}>
            Line
          </button>
          <button onClick={() => setMode("polygon")} className={mode === "polygon" ? "primary" : ""}>
            Polygon
          </button>
          <Link to="/projects">
            <button type="button">Projects</button>
          </Link>
          <Link to={`/projects/${encodeURIComponent(projectId)}/regions`}>
            <button type="button">Regions</button>
          </Link>
          {user?.role === "admin" ? (
            <Link to="/admin">
              <button type="button">Admin</button>
            </Link>
          ) : null}
          <button onClick={logout}>Sign out</button>
        </div>
      </div>

      <MapView
        collection={collection}
        onFeaturesChanged={handleDrawChange}
        onFeatureSelected={handleSelected}
        mode={mode}
      />

      <div className="fab">
        <button onClick={quickAddPhoto} title="Drop pin at my location" aria-label="Drop pin here">
          +
        </button>
      </div>

      <aside className="editor-panel">
        {selectedFeature ? (
          <FeatureEditor
            projectId={projectId}
            feature={selectedFeature}
            onChange={handleUpdate}
            onDelete={handleDelete}
          />
        ) : (
          <EmptyState />
        )}
      </aside>

      <aside className={`bottom-sheet ${sheetOpen ? "open" : ""}`}>
        <button
          type="button"
          onClick={() => setSheetOpen((v) => !v)}
          style={{ border: "none", background: "transparent", padding: 0, minHeight: 32 }}
          aria-label="Toggle editor"
        >
          <div className="grabber" />
          <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            {selectedFeature ? selectedFeature.properties.title || "Untitled feature" : "No feature selected"}
          </div>
        </button>
        <div className="sheet-content">
          {selectedFeature ? (
            <FeatureEditor
              projectId={projectId}
              feature={selectedFeature}
              onChange={handleUpdate}
              onDelete={handleDelete}
            />
          ) : (
            <EmptyState />
          )}
        </div>
      </aside>
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.5 }}>
      <p>
        Pick a drawing mode from the toolbar, or tap the <strong>+</strong> button to drop a pin at your current
        location. Selecting a feature opens its editor here.
      </p>
      <p>Everything saves automatically and queues when offline.</p>
    </div>
  );
}
