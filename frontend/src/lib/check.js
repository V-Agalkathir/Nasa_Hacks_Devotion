// The ground check (spec 06 section 3.3): aggregate cells, apply the Part 4 tier rule, evaluate needs.
import { fmtM } from "./data.js";

const median = (a) => {
  const v = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const quantile = (a, q) => {
  const v = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.floor(q * (v.length - 1))))];
};
const mean = (a) => {
  const v = a.filter((x) => x != null && Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

export const DEFAULT_NEED = { minH: 4, maxHwy: 1000, minSea: 300, maxWet: 40, minCov: 70, maxTown: Infinity, minBlock: 1 };

export const PRESETS = [
  { key: "the_point", label: "The Point", named: "the_point" },
  { key: "town_core", label: "Town core", named: "town_core" },
  { key: "reindeer_point", label: "Reindeer Point", named: "reindeer_point" },
  { key: "hwy6", label: "Highway km 6", block: [40, 44, 86, 90] },
  { key: "hwy26", label: "Highway km 26", block: [62, 66, 16, 20] },
];

// Cells a preset selects. Named areas: cells whose centre lies inside the outline's bounding box and
// within ~150 m of it (cheap point-in-polygon on the ring).
export function presetCells(preset, data) {
  if (preset.block) {
    const [c0, c1, r0, r1] = preset.block;
    return data.cells.filter((c) => c.col >= c0 && c.col <= c1 && c.row >= r0 && c.row <= r1).map((c) => c.id).sort();
  }
  const f = data.areas.features.find((x) => x.properties.id === preset.named);
  if (!f) return [];
  const rings = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.map((p) => p[0]) : [f.geometry.coordinates[0]];
  const inside = (x, y, ring) => {
    let ins = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  };
  const hit = data.cells.filter((c) => c.ring.slice(0, 4).some(([x, y]) => rings.some((r) => inside(x, y, r))) ||
    rings.some((r) => r.some(([x, y]) => x >= c.ring[0][0] && x <= c.ring[1][0] && y >= c.ring[0][1] && y <= c.ring[2][1])));
  return hit.map((c) => c.id).sort();
}

export function aggregate(ids, data) {
  const cs = ids.map((id) => data.byId[id]).filter(Boolean);
  if (!cs.length) return null;
  const tiers = { lower: 0, moderate: 0, higher: 0, not_enough_data: 0 };
  cs.forEach((c) => tiers[c.tier]++);
  const years = [2021, 2022, 2023, 2024, 2025];
  const mvy = years.map((y, i) => median(cs.map((c) => c.mvy[i])));
  const cant = cs.filter((c) => c.ground === "cant_measure").length / cs.length;
  return {
    n: cs.length, cells: cs, tiers,
    h: median(cs.map((c) => c.h)), p10: quantile(cs.map((c) => c.p10 ?? c.h), 0.1),
    low: mean(cs.map((c) => c.low)), hasP10: cs.every((c) => c.p10 != null),
    sea: Math.min(...cs.map((c) => c.sea)), hw: Math.min(...cs.map((c) => c.hw)), core: Math.min(...cs.map((c) => c.core)),
    wet: mean(cs.map((c) => c.wet)), cov: mean(cs.map((c) => c.cov)), cant,
    chg: median(cs.map((c) => c.chg)), mv: median(cs.map((c) => c.mv)), mvy, years,
    flagged: cs.filter((c) => c.flag).length,
    prom: cs.filter((c) => c.coring === "promising_unconfirmed").length,
    conf: cs.filter((c) => c.coring === "conflicting_evidence").length,
    heights: cs.map((c) => c.h),
  };
}

// Part 4 tier rule; the ground driver is never counted while Test A fails.
export function tierRule(a) {
  const coast = a.sea <= 100 ? 2 : a.sea <= 300 ? 1 : 0;
  let height;
  if (a.hasP10 && a.low != null) height = a.low >= 0.5 ? 2 : a.p10 < 4 ? 1 : 0;
  else height = a.h < 2.5 ? 2 : a.h < 4 ? 1 : 0;
  const level = Math.max(coast, height);
  const tier = level === 2 ? "higher" : level === 1 ? "moderate" : a.cant >= 0.5 ? "not_enough_data" : "lower";
  return { tier, coast, height };
}

export function reasonFor(t, a) {
  const bits = [];
  if (t.coast) bits.push(t.coast === 2 ? "on the shoreline" : "near the shoreline");
  if (t.height) bits.push(t.height === 2 ? "low-lying" : "partly low-lying");
  if (!bits.length) bits.push(t.tier === "lower" ? "high, inland ground" : "radar can't see the ground");
  const name = { lower: "Lower", moderate: "Moderate", higher: "Higher", not_enough_data: "Not enough data:" }[t.tier];
  let s = `${name} second-move risk: ${bits.join(", ")}. Ground condition is not confirmed by radar; a core is needed before building.`;
  if (!t.coast) s += " The coast is not a factor here, so this tier reflects height and ground only.";
  return s;
}

const glyph = (frac) => (frac === 1 ? "✓" : frac >= 0.5 ? "◐" : "✕");
export const NEED_ROWS = [
  { key: "minH", label: "Height above sea", options: [["Any", 0], ["2.5 m", 2.5], ["4 m", 4], ["6 m", 6], ["8 m or more", 8]],
    test: (c, v) => c.h >= v, value: (a) => `Middle ${a.h?.toFixed(1)} m · lowest tenth ${a.p10?.toFixed(1)} m` },
  { key: "maxHwy", label: "Close to the highway", options: [["Any", Infinity], ["500 m", 500], ["1 km", 1000], ["2 km", 2000]],
    test: (c, v) => c.hw <= v, value: (a) => (a.hw <= 30 ? "The highway runs through it" : `${fmtM(a.hw)} to the highway`) },
  { key: "minSea", label: "Away from the shore", options: [["Any", -1], ["100 m", 100], ["300 m", 300], ["500 m", 500]],
    test: (c, v) => c.sea > v, value: (a) => (a.sea <= 100 ? "On the 2025 shoreline" : `${fmtM(a.sea)} from the 2025 shoreline`) },
  { key: "maxWet", label: "Dry ground", options: [["Any", 101], ["under 40% water", 40], ["under 25%", 25]],
    test: (c, v) => c.wet * 100 < v, value: (a) => `${Math.round(a.wet * 100)}% water or ponds around it` },
  { key: "maxTown", label: "Close to town", options: [["Any", Infinity], ["15 km", 15000], ["10 km", 10000], ["8 km", 8000]],
    test: (c, v) => c.core <= v, value: (a) => (a.core <= 30 ? "In the town core" : `${fmtM(a.core)} from the town core`),
    note: "A planning choice for the council, not a ground fact" },
  { key: "minCov", label: "Radar can see it", options: [["Any", 0], ["half or more", 50], ["70% or more", 70]],
    test: (c, v) => c.cov * 100 >= v, value: (a) => `Radar reads ${Math.round(a.cov * 100)}% of it` },
];

export function needs(a, need) {
  return NEED_ROWS.map((r) => {
    if (!a) return { ...r, glyph: "–" };
    const frac = a.cells.filter((c) => r.test(c, need[r.key])).length / a.cells.length;
    return { ...r, glyph: glyph(frac), frac };
  });
}

export function autoName(ids, data) {
  const a = aggregate(ids, data);
  if (!a) return "Nothing selected";
  const lat = median(a.cells.map((c) => c.lat));
  if (lat > 69.42) return `${ids.length} squares in town`;
  const kmFromTown = Math.round(a.core / 1000);
  return `${ids.length} square${ids.length > 1 ? "s" : ""}, ${kmFromTown} km from the town core`;
}

// Candidate squares for coring (spec "promising, unconfirmed" rule, recomputed live from the needs):
// every need passes, radar reads the square as stable, nothing flagged this season; then keep only
// connected blocks of at least `minBlock` touching squares (room for a subdivision).
export function candidates(cells, need, byId) {
  const ok = new Set(cells.filter((c) => NEED_ROWS.every((r) => r.test(c, need[r.key])) && c.ground === "stable" && !c.flag && !c.iceNear).map((c) => c.id));
  const key = (col, row) => `C${String(col).padStart(3, "0")}_${String(row).padStart(3, "0")}`;
  const seen = new Set(), blocks = [];
  for (const id of ok) {
    if (seen.has(id)) continue;
    const comp = [], st = [id];
    seen.add(id);
    while (st.length) {
      const k = st.pop(); comp.push(k);
      const c = byId[k];
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = key(c.col + dc, c.row + dr);
        if (ok.has(n) && !seen.has(n)) { seen.add(n); st.push(n); }
      }
    }
    blocks.push(comp);
  }
  const kept = blocks.filter((b) => b.length >= (need.minBlock || 1));
  return { ids: new Set(kept.flat()), blocks: kept.sort((a, b) => b.length - a.length) };
}

// Criteria breakdown: squares passing each criterion on its own, and what is left after applying
// them one after another (the funnel from the whole corridor to the candidate blocks).
export function funnel(cells, need, byId) {
  const steps = [];
  let left = cells;
  const add = (label, test, why) => {
    const alone = cells.filter(test).length;
    left = left.filter(test);
    steps.push({ label, alone, left: left.length, why });
  };
  for (const r of NEED_ROWS) {
    const opt = r.options.find(([, v]) => v === need[r.key]);
    add(`${r.label}: ${opt ? opt[0] : need[r.key]}`, (c) => r.test(c, need[r.key]), r.note || "Measured");
  }
  add("Radar reads it as stable", (c) => c.ground === "stable", "Measured; unconfirmed by tests");
  add("Nothing flagged in summer 2025", (c) => !c.flag, "Measured");
  add("No ice-rich borehole within 500 m", (c) => !c.iceNear, "Measured: NWT Permafrost Database");
  const cand = candidates(cells, need, byId);
  steps.push({ label: `In a block of at least ${need.minBlock || 1} touching squares`, alone: null, left: cand.ids.size,
    why: "Room for a subdivision" });
  return { total: cells.length, steps, cand };
}

// One suggested core per ground type among the candidates: group by height band and wetness, then
// take the square nearest the town in each group (cheapest to reach). Each core then speaks for
// every similar square, not just one point.
export function coresByType(cand, byId) {
  const groups = {};
  for (const id of cand.ids) {
    const c = byId[id];
    const hb = c.h < 8 ? "4–8 m" : c.h < 15 ? "8–15 m" : "15 m or more";
    const wb = c.wet < 0.15 ? "dry" : "some ponds";
    const k = `${hb} · ${wb}`;
    (groups[k] ||= []).push(c);
  }
  return Object.entries(groups).map(([type, cs]) => {
    const pick = cs.slice().sort((a, b) => a.core - b.core)[0];
    return { type, n: cs.length, km2: +(cs.length * 0.0576).toFixed(1), pick };
  }).sort((a, b) => b.n - a.n);
}

// Factor-by-factor tier breakdown (for display): measured value, rule, level, then the formula.
export function tierBreakdown(t, a, named) {
  const i = named?.indicators;
  const sea = i ? i.coast.distance_to_sea_m : a.sea;
  const low = i ? i.height.share_below_surge : a.low;
  const p10 = i ? i.height.p10_m : a.p10;
  const mv = i ? i.ground.summer_move_vs_airport_cm : a.mv;
  const rows = [
    { factor: "Coast", value: sea <= 100 ? `${Math.round(sea)} m: on the 2025 shoreline` : `${fmtM(sea)} from the 2025 shoreline`,
      rule: "≤100 m → 2 · 100–300 m → 1 · >300 m → 0", level: t.coast },
    { factor: "Height", value: `${Math.round((low ?? 0) * 100)}% below 2.5 m; lowest tenth ${p10 == null ? "–" : p10.toFixed(1)} m`,
      rule: "≥50% below 2.5 m → 2 · lowest tenth <4 m → 1 · else 0", level: t.height },
    { factor: "Ground (radar)", value: mv == null ? "radar can't see most of it" : `${Math.abs(mv).toFixed(1)} cm/summer ${mv < 0 ? "more" : "less"} than the airport pad`,
      rule: "Shown, not counted: its tests failed", level: null },
  ];
  const level = Math.max(t.coast, t.height);
  const name = { higher: "Higher", moderate: "Moderate", lower: "Lower", not_enough_data: "Not enough data" }[t.tier];
  const formula = `max(Coast ${t.coast}, Height ${t.height}) = ${level} → ${name}` + (t.tier === "not_enough_data" ? " (radar can't see most of the land)" : "");
  return { rows, formula };
}
