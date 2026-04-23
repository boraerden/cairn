import { useEffect, useRef } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import { TerraDraw } from "terra-draw";
import {
  TerraDrawPointMode,
  TerraDrawLineStringMode,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { CairnFeatureCollection } from "@cairn/types";
import { DEFAULT_STYLE_URL } from "../config";

interface Props {
  collection: CairnFeatureCollection;
  onFeaturesChanged: (features: GeoJSON.Feature[]) => void;
  onFeatureSelected: (id: string | null) => void;
  mode: "select" | "point" | "line" | "polygon";
  deletedFeatureId?: string | null;
}

export function MapView({ collection, onFeaturesChanged, onFeatureSelected, mode, deletedFeatureId = null }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const collectionRef = useRef(collection);
  const onFeaturesChangedRef = useRef(onFeaturesChanged);
  const onFeatureSelectedRef = useRef(onFeatureSelected);

  useEffect(() => {
    collectionRef.current = collection;
  }, [collection]);

  useEffect(() => {
    onFeaturesChangedRef.current = onFeaturesChanged;
  }, [onFeaturesChanged]);

  useEffect(() => {
    onFeatureSelectedRef.current = onFeatureSelected;
  }, [onFeatureSelected]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DEFAULT_STYLE_URL,
      center: [0, 20],
      zoom: 2,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 9 }),
        modes: [
          new TerraDrawSelectMode({
            flags: {
              point: { feature: { draggable: true } },
              linestring: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
              polygon: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
            },
          }),
          new TerraDrawPointMode(),
          new TerraDrawLineStringMode(),
          new TerraDrawPolygonMode(),
        ],
      });
      draw.start();
      draw.setMode("select");
      drawRef.current = draw;

      draw.on("change", () => {
        const snapshot = draw.getSnapshot();
        onFeaturesChangedRef.current(snapshot as GeoJSON.Feature[]);
      });

      draw.on("select", (id) => onFeatureSelectedRef.current(String(id)));
      draw.on("deselect", () => onFeatureSelectedRef.current(null));

      syncIntoDraw(draw, collectionRef.current);
    });

    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;
    syncIntoDraw(draw, collection);
  }, [collection]);

  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;
    const map = { select: "select", point: "point", line: "linestring", polygon: "polygon" } as const;
    draw.setMode(map[mode]);
  }, [mode]);

  useEffect(() => {
    const draw = drawRef.current;
    if (!draw || !deletedFeatureId) return;
    const exists = draw.getSnapshot().some((feature: GeoJSON.Feature) => String(feature.id) === deletedFeatureId);
    if (exists) {
      draw.removeFeatures([deletedFeatureId]);
    }
  }, [deletedFeatureId]);

  return (
    <div className="map-canvas">
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <button
        type="button"
        className="locate-btn"
        onClick={() => locateMe(mapRef.current)}
        title="Locate me"
        aria-label="Locate me"
      >
        ⦿
      </button>
    </div>
  );
}

function syncIntoDraw(draw: TerraDraw, fc: CairnFeatureCollection): void {
  const incoming = fc.features
    .filter((f) => f.geometry && "coordinates" in f.geometry)
    .map((f) => ({
      ...f,
      id: f.properties.id,
      properties: {
        ...f.properties,
        mode: modeForGeometry(f.geometry.type),
      },
    }));
  const existing = draw.getSnapshot();
  const existingById = new Map(existing.map((f: GeoJSON.Feature) => [String(f.id), f]));
  const incomingIds = new Set(incoming.map((f) => String(f.id)));
  const toRemove = existing
    .map((f: GeoJSON.Feature) => String(f.id))
    .filter((id) => !incomingIds.has(id));

  for (const feature of incoming) {
    const current = existingById.get(String(feature.id));
    if (!current) continue;
    if (JSON.stringify(current.geometry) !== JSON.stringify(feature.geometry)) {
      toRemove.push(String(feature.id));
    }
  }

  if (toRemove.length > 0) draw.removeFeatures(toRemove);
  const toAdd = incoming.filter((feature) => !existingById.has(String(feature.id)) || toRemove.includes(String(feature.id)));
  if (toAdd.length > 0) {
    try {
      draw.addFeatures(toAdd as unknown as Parameters<TerraDraw["addFeatures"]>[0]);
    } catch {
      // Terra Draw throws if a feature already exists; safe to ignore.
    }
  }
}

function modeForGeometry(type: GeoJSON.Geometry["type"]): "point" | "linestring" | "polygon" {
  if (type === "LineString") return "linestring";
  if (type === "Polygon") return "polygon";
  return "point";
}

function locateMe(map: MlMap | null): void {
  if (!map || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 15 });
    },
    (err) => console.warn("geolocation error", err),
    { enableHighAccuracy: true, timeout: 10_000 },
  );
}
