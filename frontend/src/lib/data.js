// All data comes from /public/data (contract v2, written by data-pipeline/src/export_web_v2.py).
const base = "./data/";
const get = (f) => fetch(base + f).then((r) => {
  if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  return r.json();
});
const EMPTY = { type: "FeatureCollection", features: [] };

// The site renders with only manifest.json; every other file is optional and degrades to an empty state.
export async function loadAll() {
  const manifest = await get("manifest.json");
  const f = manifest.files || {};
  const opt = (name, fallback) => (name ? get(name).catch(() => fallback) : Promise.resolve(fallback));
  const [areas, cells, timeseries, validation, coastline] = await Promise.all([
    opt(f.areas, EMPTY), opt(f.cells, null), opt(f.timeseries, null), opt(f.validation, null), opt(f.coastline, EMPTY),
  ]);
  return { manifest, areas, cells: cells ? decodeCells(cells) : [], cellsRaw: cells, timeseries, validation, coastline, base };
}

function decodeCells(c) {
  const [hx, hy] = c.half_deg;
  return c.rows.map((r, i) => {
    const [lon, lat, tier, coring, h, hw, core, sea, wet, cov, ground, mv, flag] = r;
    return {
      id: `cell-${i}`, lon, lat, tier: c.codes.tier[tier], coring: c.codes.coring[coring], h, hw, core, sea, wet, cov,
      ground: c.codes.ground[ground], mv, flag: !!flag,
      ring: [[lon - hx, lat - hy], [lon + hx, lat - hy], [lon + hx, lat + hy], [lon - hx, lat + hy], [lon - hx, lat - hy]],
    };
  });
}

export function cellsToGeoJSON(cells, filter) {
  return {
    type: "FeatureCollection",
    features: cells.map((c) => ({
      type: "Feature", id: c.id,
      properties: { id: c.id, tier: c.tier, coring: c.coring || "", pass: filter ? passes(c, filter) : true },
      geometry: { type: "Polygon", coordinates: [c.ring] },
    })),
  };
}

export const DEFAULT_FILTER = { minHeight: 4, maxHighway: 1000, coast: true, dry: true };

export function passes(c, f) {
  return c.h >= f.minHeight && c.hw <= f.maxHighway && (!f.coast || c.sea > 300) && (!f.dry || c.wet < 0.4);
}

// Colour-blind-safe tokens (Okabe-Ito). "Can't measure" and "not enough data" are hatched grey, never a colour class.
export const TIER = {
  lower: { label: "Lower", color: "#56B4E9", text: "#06212f" },
  moderate: { label: "Moderate", color: "#F0E442", text: "#2a2600" },
  higher: { label: "Higher", color: "#D55E00", text: "#fff" },
  not_enough_data: { label: "Not enough data", color: "#8a8f94", text: "#111" },
};
export const CLASS = {
  stable: { label: "Stable", color: "#0072B2", desc: "Little movement in any summer." },
  seasonal_only: { label: "Seasonal only", color: "#E69F00", desc: "Settles each summer with warmth, no sign of worsening." },
  degrading: { label: "Degrading", color: "#D55E00", desc: "Keeps sinking late in the season or sinks more each year." },
  cant_measure: { label: "Can't measure", color: "#6e6e6e", desc: "Radar signal too noisy. This is not the same as stable." },
};
export const STATUS = {
  pass: { label: "Passed", cls: "st-pass" },
  partial: { label: "Partly passed", cls: "st-partial" },
  fail: { label: "Failed", cls: "st-fail" },
  not_run: { label: "Not run", cls: "st-na" },
  not_available: { label: "Not available", cls: "st-na" },
  pending: { label: "Pending", cls: "st-na" },
  measured: { label: "Measured", cls: "st-measured" },
};
export const NAMED_COLORS = { the_point: "#e67e22", town_core: "#c49bea", reindeer_point: "#6fb3ff" };

export const fmtM = (m) => (m == null ? "—" : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

export function labelPoint(geometry, edge = "top") {
  const rings = geometry.type === "MultiPolygon" ? geometry.coordinates.flat() : geometry.coordinates;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return [(w + e) / 2, edge === "bottom" ? s : n];
}
