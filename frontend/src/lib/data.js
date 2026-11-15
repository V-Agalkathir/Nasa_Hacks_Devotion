// All data comes from /public/data (contract v2, written by data-pipeline/src/export_web_v2.py).
// Only manifest.json is required; every other file may be missing and degrades to an empty state.
const base = "./data/";
const get = (f) => fetch(base + f).then((r) => {
  if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  return r.json();
});
const EMPTY = { type: "FeatureCollection", features: [] };

export async function loadAll() {
  const manifest = await get("manifest.json");
  const f = manifest.files || {};
  const failed = {};
  const opt = (key, name, fallback) => (name ? get(name).catch(() => { failed[key] = true; return fallback; }) : Promise.resolve(fallback));
  const [areas, cells, timeseries, validation, coastline, boreholes] = await Promise.all([
    opt("areas", f.areas, EMPTY), opt("cells", f.cells, null), opt("timeseries", f.timeseries, null),
    opt("validation", f.validation, null), opt("coastline", f.coastline, EMPTY), opt("boreholes", f.boreholes, EMPTY),
  ]);
  const decoded = cells ? decodeCells(cells) : [];
  // flag squares within ~500 m of a borehole that logged ice-rich ground (known ice nearby)
  const icy = boreholes.features.filter((b) => b.properties.ice_rich).map((b) => b.geometry.coordinates);
  for (const c of decoded) {
    c.iceNear = icy.some(([x, y]) => Math.hypot((x - c.lon) * 35.6, (y - c.lat) * 111) < 0.5);
  }
  return { manifest, areas, boreholes, cells: decoded, byId: Object.fromEntries(decoded.map((c) => [c.id, c])), timeseries, validation, coastline, base, failed };
}

function decodeCells(c) {
  const [hx, hy] = c.half_deg;
  return c.rows.map((r) => {
    const [lon, lat, tier, coring, h, hw, core, sea, wet, cov, ground, mv, flag, id, p10, low, chg, mvy] = r;
    const m = /^C(\d+)_(\d+)$/.exec(id || "");
    return {
      id, col: m ? +m[1] : null, row: m ? +m[2] : null, lon, lat,
      tier: c.codes.tier[tier], coring: c.codes.coring[coring], h, hw, core, sea, wet, cov,
      ground: c.codes.ground[ground], mv, flag: !!flag, p10, low, chg, mvy: mvy || [],
      ring: [[lon - hx, lat - hy], [lon + hx, lat - hy], [lon + hx, lat + hy], [lon - hx, lat + hy], [lon - hx, lat - hy]],
    };
  });
}

export function cellsGeoJSON(cells, cand = new Set(), picks = new Set()) {
  return {
    type: "FeatureCollection",
    features: cells.map((c) => ({
      type: "Feature",
      properties: { id: c.id, tier: c.tier, coring: c.coring || "", h: c.h, sea: c.sea, cand: cand.has(c.id), pick: picks.has(c.id) },
      geometry: { type: "Polygon", coordinates: [c.ring] },
    })),
  };
}

// Outline of a selection: cell edges whose grid neighbour is not selected (spec 3.2).
export function selectionOutline(ids, byId) {
  const set = new Set(ids);
  const lines = [];
  for (const id of ids) {
    const c = byId[id];
    if (!c || c.col == null) continue;
    const [sw, se, ne, nw] = c.ring;
    const n = (dc, dr) => set.has(`C${String(c.col + dc).padStart(3, "0")}_${String(c.row + dr).padStart(3, "0")}`);
    if (!n(0, -1)) lines.push([sw, se]);
    if (!n(1, 0)) lines.push([se, ne]);
    if (!n(0, 1)) lines.push([ne, nw]);
    if (!n(-1, 0)) lines.push([nw, sw]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines } };
}

export const fmtM = (m) => (m == null ? "–" : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
export const fmtDate = (iso) => {
  if (!iso) return "–";
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
