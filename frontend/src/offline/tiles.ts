import { DEFAULT_STYLE_URL } from "../config";

const TILE_CACHE = "cairn-tiles";

interface StyleSources {
  sources: Record<
    string,
    {
      type?: string;
      url?: string;
      tiles?: string[];
      minzoom?: number;
      maxzoom?: number;
    }
  >;
}

interface TileJson {
  tiles: string[];
  minzoom?: number;
  maxzoom?: number;
}

export interface TileDownloadProgress {
  total: number;
  done: number;
  bytes: number;
}

export async function downloadRegion(
  bbox: [number, number, number, number],
  minZoom: number,
  maxZoom: number,
  onProgress: (p: TileDownloadProgress) => void,
  signal?: AbortSignal,
): Promise<{ tileCount: number; bytes: number }> {
  const tileUrls = await computeTileUrls(bbox, minZoom, maxZoom);
  const cache = await caches.open(TILE_CACHE);
  let bytes = 0;
  let done = 0;
  const concurrency = 6;
  const total = tileUrls.length;

  async function worker(queue: string[]): Promise<void> {
    while (queue.length > 0) {
      if (signal?.aborted) throw new Error("aborted");
      const url = queue.shift();
      if (!url) return;
      try {
        const existing = await cache.match(url);
        if (existing) {
          const blob = await existing.clone().blob();
          bytes += blob.size;
        } else {
          const res = await fetch(url, { signal });
          if (res.ok) {
            await cache.put(url, res.clone());
            const blob = await res.blob();
            bytes += blob.size;
          }
        }
      } catch {
        // swallow: region downloads tolerate individual tile failures
      } finally {
        done += 1;
        onProgress({ total, done, bytes });
      }
    }
  }

  const queue = [...tileUrls];
  await Promise.all(Array.from({ length: concurrency }, () => worker(queue)));
  return { tileCount: total, bytes };
}

export async function deleteCachedTiles(urls: string[]): Promise<void> {
  const cache = await caches.open(TILE_CACHE);
  await Promise.all(urls.map((u) => cache.delete(u)));
}

async function computeTileUrls(
  bbox: [number, number, number, number],
  minZoom: number,
  maxZoom: number,
): Promise<string[]> {
  const styleRes = await fetch(DEFAULT_STYLE_URL);
  const style = (await styleRes.json()) as StyleSources;
  const tileTemplates: { template: string; minzoom: number; maxzoom: number }[] = [];

  for (const src of Object.values(style.sources ?? {})) {
    if (src.tiles?.length) {
      tileTemplates.push({
        template: src.tiles[0]!,
        minzoom: src.minzoom ?? 0,
        maxzoom: src.maxzoom ?? 14,
      });
    } else if (src.url) {
      const res = await fetch(src.url);
      const tj = (await res.json()) as TileJson;
      if (tj.tiles?.length) {
        tileTemplates.push({
          template: tj.tiles[0]!,
          minzoom: tj.minzoom ?? 0,
          maxzoom: tj.maxzoom ?? 14,
        });
      }
    }
  }

  const [west, south, east, north] = bbox;
  const urls = new Set<string>();
  for (const { template, minzoom, maxzoom } of tileTemplates) {
    const zLo = Math.max(minZoom, minzoom);
    const zHi = Math.min(maxZoom, maxzoom);
    for (let z = zLo; z <= zHi; z++) {
      const [xMin, yMax] = lonLatToTile(west, south, z);
      const [xMax, yMin] = lonLatToTile(east, north, z);
      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          urls.add(
            template
              .replace("{z}", String(z))
              .replace("{x}", String(x))
              .replace("{y}", String(y)),
          );
        }
      }
    }
  }
  return Array.from(urls);
}

function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return [clampTile(x, n), clampTile(y, n)];
}

function clampTile(v: number, n: number): number {
  return Math.max(0, Math.min(n - 1, v));
}

export async function estimateCacheBytes(): Promise<number> {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  let bytes = 0;
  for (const req of keys) {
    const res = await cache.match(req);
    if (!res) continue;
    const blob = await res.blob();
    bytes += blob.size;
  }
  return bytes;
}
