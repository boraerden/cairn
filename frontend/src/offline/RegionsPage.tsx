import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { v4 as uuid } from "uuid";
import { OFFLINE_LIMITS } from "../config";
import { deleteRegion, listRegions, putRegion, type StoredRegion } from "./db";
import { downloadRegion, estimateCacheBytes, type TileDownloadProgress } from "./tiles";

export function RegionsPage(): JSX.Element {
  const [regions, setRegions] = useState<StoredRegion[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [progress, setProgress] = useState<TileDownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minZoom, setMinZoom] = useState(10);
  const [maxZoom, setMaxZoom] = useState(14);
  const [name, setName] = useState("");
  const [bboxInput, setBboxInput] = useState("-122.52,37.70,-122.35,37.82");

  const refresh = useCallback(async () => {
    const rs = await listRegions();
    setRegions(rs);
    setTotalBytes(await estimateCacheBytes());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function download() {
    setError(null);
    const parts = bboxInput.split(",").map((s) => Number(s.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      setError("BBox must be: west,south,east,north");
      return;
    }
    const [west, south, east, north] = parts as [number, number, number, number];
    if (totalBytes > OFFLINE_LIMITS.totalMB * 1024 * 1024) {
      setError(`Over total cap (${OFFLINE_LIMITS.totalMB} MB). Delete regions first.`);
      return;
    }
    setProgress({ total: 0, done: 0, bytes: 0 });
    try {
      const { tileCount, bytes } = await downloadRegion(
        [west, south, east, north],
        minZoom,
        maxZoom,
        (p) => {
          setProgress(p);
          if (p.bytes > OFFLINE_LIMITS.perRegionMB * 1024 * 1024) {
            throw new Error(`region exceeds ${OFFLINE_LIMITS.perRegionMB} MB cap`);
          }
        },
      );
      await putRegion({
        id: uuid(),
        name: name || `${west.toFixed(2)},${south.toFixed(2)}`,
        bbox: [west, south, east, north],
        minZoom,
        maxZoom,
        tileCount,
        bytes,
        createdAt: Date.now(),
      });
      setName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  }

  async function remove(id: string) {
    await deleteRegion(id);
    await refresh();
  }

  return (
    <div className="admin-shell">
      <div className="row">
        <h1 style={{ margin: 0 }}>Offline regions</h1>
        <div style={{ flex: 1 }} />
        <Link to="/map">
          <button type="button">Back to map</button>
        </Link>
      </div>

      <div style={{ color: "var(--muted)", fontSize: 13 }}>
        Using {(totalBytes / 1024 / 1024).toFixed(1)} / {OFFLINE_LIMITS.totalMB} MB total · per-region cap{" "}
        {OFFLINE_LIMITS.perRegionMB} MB
      </div>

      <div className="field-row">
        <label>Region name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Presidio trail" />
      </div>
      <div className="field-row">
        <label>BBox (west,south,east,north)</label>
        <input value={bboxInput} onChange={(e) => setBboxInput(e.target.value)} />
      </div>
      <div className="row">
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          Zoom
          <input
            type="number"
            value={minZoom}
            min={0}
            max={20}
            onChange={(e) => setMinZoom(Number(e.target.value))}
            style={{ width: 80, marginLeft: 8 }}
          />
          –
          <input
            type="number"
            value={maxZoom}
            min={0}
            max={20}
            onChange={(e) => setMaxZoom(Number(e.target.value))}
            style={{ width: 80, marginLeft: 8 }}
          />
        </label>
        <button type="button" className="primary" onClick={() => void download()} disabled={progress !== null}>
          {progress ? `Downloading ${progress.done}/${progress.total}` : "Download"}
        </button>
      </div>
      {error ? <div className="error">{error}</div> : null}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Tiles</th>
            <th>Size</th>
            <th>Zoom</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {regions.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.tileCount}</td>
              <td>{(r.bytes / 1024 / 1024).toFixed(1)} MB</td>
              <td>
                {r.minZoom}–{r.maxZoom}
              </td>
              <td>
                <button className="danger" onClick={() => void remove(r.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
