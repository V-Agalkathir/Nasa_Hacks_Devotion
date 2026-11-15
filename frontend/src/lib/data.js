// All data comes from /public/data — see DATA CONTRACT in the root README.
const base = "./data/";
const get = (f) => fetch(base + f).then((r) => {
  if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  return r.json();
});
const EMPTY = { type: "FeatureCollection", features: [] };

export async function loadAll() {
  const manifest = await get("manifest.json");
  const [zones, timeseries, coastline] = await Promise.all([
    get(manifest.zones),
    get(manifest.timeseries),
    // Coastline is optional: the map still works if the file is missing or empty.
    manifest.coastline ? get(manifest.coastline).catch(() => EMPTY) : Promise.resolve(EMPTY),
  ]);
  return { manifest, zones, timeseries, coastline, base };
}

// One colour per zone, used on the map outlines, labels and chart lines.
export const ZONE_COLORS = { point: "#e67e22", core: "#b07cd8", reindeer: "#4b8fe8" };

// Short display name: "Reindeer Point (relocation site)" -> "Reindeer Point"
export const shortName = (name = "") => name.split(" (")[0];

// Simple, explainable risk label from cumulative summer subsidence (cm). Tune with the team.
export function riskLabel(meanCm) {
  if (meanCm == null) return { label: "No data", color: "#888" };
  if (meanCm > -3) return { label: "Lower-risk ground", color: "#4b7bec" };
  if (meanCm > -6) return { label: "Moderate", color: "#f7b731" };
  return { label: "Higher risk — inspect on the ground", color: "#e67e22" };
}

// Top-centre of a polygon's bounding box: labels sit just above the outline instead of covering it.
export function labelPoint(geometry) {
  const rings = geometry.type === "MultiPolygon" ? geometry.coordinates.flat() : geometry.coordinates;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return [(w + e) / 2, n];
}
