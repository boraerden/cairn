declare const __API_URL__: string;

export const API_URL: string =
  (typeof __API_URL__ !== "undefined" && __API_URL__) ||
  (import.meta.env.VITE_API_URL as string | undefined) ||
  "";

/** OpenFreeMap bright style — free, no key, vector tiles, MapLibre-native. */
export const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";

export const TILE_HOSTNAMES = ["tiles.openfreemap.org"];

export const OFFLINE_LIMITS = {
  perRegionMB: 200,
  totalMB: 500,
} as const;
