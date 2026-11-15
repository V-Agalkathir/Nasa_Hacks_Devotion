// Ground Check, Part 7 tool logic (ported from the design canvas, Main.dc.html).
// Rules filter 240 m squares; squares that pass and touch (within one 2 km stretch of highway) form
// "places". Places are listed with the same facts and never scored or ranked.

export const HA = 5.76; // one 240 m square in hectares

export const SCENARIO_YEARS = ["2020", "2050", "2100"];
export const SCENARIO_STORMS = [["10", "1-in-10"], ["100", "1-in-100"], ["200", "1-in-200"]];

export const CRIT = [
  { k: "h", f: "h", kind: "min", name: "Height above sea", short: "Height", lead: "At least", min: 0, max: 15, step: 0.5,
    why: "Storm surges here reach 2.6 to 4.2 m above sea, depending on the storm and the year (Baird 2019)." },
  { k: "flood", f: "fl10", kind: "flood", name: "Above the storm flood", short: "Flood", lead: "Dry in",
    why: "Estimate: a square counts as dry if at least 90% of it stays above a storm surge that can reach it from the sea. Levels from Baird (2019), as published by Future Tuktoyaktuk." },
  { k: "sea", f: "sea", kind: "min", name: "Distance from the shore", short: "Shore", lead: "At least", min: 0, max: 3000, step: 50,
    why: "Measured shorelines from 1985 to 2025 show where land has been lost." },
  { k: "hw", f: "hw", kind: "max", name: "Distance to the highway", short: "Highway", lead: "Within", min: 0, max: 6000, step: 100,
    why: "Land further away needs new roads, power and water lines." },
  { k: "town", f: "town", kind: "max", name: "Distance to the town centre", short: "Town", lead: "Within", min: 0, max: 30000, step: 500,
    why: "Straight line from the town core. In 21 interviews for the Nuna Community Voices report (2025), residents suggested about 15 km out at most." },
  { k: "wet", f: "wet", kind: "max", name: "Lakes and ponds nearby", short: "Water", lead: "Under", min: 0, max: 100, step: 5,
    why: "Share of water within 250 m. Wet ground is harder to build on." },
  { k: "cov", f: "cov", kind: "min", name: "Radar can see the ground", short: "Radar", lead: "At least", min: 0, max: 100, step: 5,
    why: "Where the satellite can't see, we know less about movement." },
  { k: "size", f: null, kind: "size", name: "Size of each place", short: "Size", lead: "At least", min: 1, max: 24, step: 1,
    why: "One square is 240 m by 240 m, about 5.8 hectares." },
];
export const DEF = { h: 4, flood: "2100-100", sea: 300, hw: 1000, town: 15000, wet: 40, cov: 70, size: 4 };
export const DON = { h: true, flood: true, sea: true, hw: true, town: true, wet: true, cov: true, size: true };
export const SORTS = [["road", "Along the highway"], ["town", "Closest to town"], ["size", "Largest first"], ["height", "Highest first"], ["shore", "Furthest from shore"]];

export function critOf(k) { return CRIT.find((c) => c.k === k); }

export function decode(T) {
  const c = T.cells, n = c.id.length, g = T.grid;
  const evenKm = T.kms.filter((m) => m[2] % 2 === 0);
  const C = [], key = {};
  for (let i = 0; i < n; i++) {
    const col = c.col[i], row = c.row[i];
    const x = g[0] * col + g[2] * row + g[4], y = g[1] * col + g[3] * row + g[5];
    let sec = 0, bd = 1e9;
    evenKm.forEach((m, j) => { const d = Math.hypot(m[0] - x, m[1] - y); if (d < bd) { bd = d; sec = j; } });
    C.push({ i, id: c.id[i], col, row, x, y, sec, km: evenKm[sec]?.[2] ?? 0,
      h: c.h[i], p10: c.p10[i], hw: c.hw[i], sea: c.sea[i], town: c.town[i], wet: c.wet[i], cov: c.cov[i],
      chg: c.chg[i], mv: Array.isArray(c.mv[i]) ? c.mv[i] : [null, null, null, null, null], dom: c.dom[i],
      fl10: c.fl10?.[i] ?? null, fl50: c.fl50?.[i] ?? null });
    key[col + "_" + row] = i;
  }
  const det = g[0] * g[3] - g[2] * g[1];
  const inv = (x, y) => { const dx = x - g[4], dy = y - g[5]; return [(g[3] * dx - g[2] * dy) / det, (-g[1] * dx + g[0] * dy) / det]; };
  let landD = ""; C.forEach((o) => { landD += sq(o); });
  return { T, C, key, N: n, inv, landD, evenKm, memo: {} };
}

export const sq = (o) => "M" + (o.col - 0.5) + " " + (o.row - 0.5) + "h1v1h-1z";

export function outline(M, cells) {
  const set = new Set(cells.map((k) => M.C[k].col + "_" + M.C[k].row));
  let d = "";
  for (const k of cells) {
    const o = M.C[k], c = o.col, r = o.row, x0 = c - 0.5, y0 = r - 0.5;
    if (!set.has(c + "_" + (r - 1))) d += "M" + x0 + " " + y0 + "h1";
    if (!set.has(c + "_" + (r + 1))) d += "M" + x0 + " " + (y0 + 1) + "h1";
    if (!set.has((c - 1) + "_" + r)) d += "M" + x0 + " " + y0 + "v1";
    if (!set.has((c + 1) + "_" + r)) d += "M" + (x0 + 1) + " " + y0 + "v1";
  }
  return d;
}

export function floodLevel(T, scen) {
  const [y, s] = String(scen).split("-");
  return T.flood?.levels?.[y]?.[s] ?? null;
}

// effective rule values: a rule that is off gets a value that passes everything
export function eff(cr, on) {
  const e = {};
  CRIT.forEach((c) => { e[c.k] = on[c.k] ? cr[c.k] : (c.kind === "size" ? 1 : c.kind === "flood" ? "" : -1); });
  return e;
}

export function passOne(M, o, k, v) {
  const c = critOf(k);
  if (c.kind === "flood") {
    if (!v) return true;
    const L = floodLevel(M.T, v);
    return L == null || o.fl10 == null || o.fl10 > L;
  }
  if (v < 0) return true;
  if (c.kind === "min") return o[c.f] >= v;
  if (c.kind === "max") return o[c.f] <= v;
  return true;
}

export function fails(M, o, e) { return CRIT.filter((c) => c.f && !passOne(M, o, c.k, e[c.k])).map((c) => c.k); }

const med = (a) => { if (!a.length) return null; const v = a.slice().sort((p, q) => p - q); const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const pct = (a, p) => { if (!a.length) return null; const v = a.slice().sort((x, y) => x - y); return v[Math.floor(p * (v.length - 1))]; };

export function stats(M, cells) {
  const C = M.C, n = cells.length;
  const hs = [], p10 = [], chg = [], mv = [], fl = [];
  let sea = 1e9, hw = 1e9, town = 1e9, wet = 0, cov = 0, sx = 0, sy = 0, bore = 1e9, boreIce = 0;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const secs = {};
  for (const k of cells) {
    const o = C[k];
    hs.push(o.h); p10.push(o.p10); if (o.chg !== null && o.chg !== undefined) chg.push(o.chg);
    o.mv.forEach((v) => { if (v !== null && v !== undefined) mv.push(v); });
    if (o.fl10 != null) fl.push(o.fl10);
    sea = Math.min(sea, o.sea); hw = Math.min(hw, o.hw); town = Math.min(town, o.town);
    for (const b of M.T.boreholes || []) { const d = Math.hypot(b[0] - o.x, b[1] - o.y) * M.T.unit_m; if (d < bore - 1) { bore = d; boreIce = b[2]; } else if (Math.abs(d - bore) <= 1 && b[2]) boreIce = 1; }
    wet += o.wet; cov += o.cov; sx += o.x; sy += o.y; secs[o.sec] = (secs[o.sec] || 0) + 1;
    x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y); x1 = Math.max(x1, o.x); y1 = Math.max(y1, o.y);
  }
  let sec = 0, best = -1; Object.keys(secs).forEach((s) => { if (secs[s] > best) { best = secs[s]; sec = Number(s); } });
  return { n, ha: n * HA, h: med(hs), low: pct(p10, 0.1), sea, chg: chg.length ? med(chg) : null, hw, town,
    wet: wet / n, cov: cov / n, mv: mv.length ? med(mv) : null, flLow: fl.length ? pct(fl, 0.1) : null, bore, boreIce,
    cx: sx / n, cy: sy / n, sec, bb: [x0, y0, x1, y1] };
}

export function places(M, e) {
  const mk = JSON.stringify(e);
  if (M.memo[mk]) return M.memo[mk];
  const C = M.C, key = M.key;
  const pass = C.map((o) => fails(M, o, e).length === 0);
  const seen = new Uint8Array(C.length), groups = [];
  for (let i = 0; i < C.length; i++) {
    if (!pass[i] || seen[i]) continue;
    const st = [i], m = []; seen[i] = 1;
    while (st.length) {
      const k = st.pop(); m.push(k); const o = C[k];
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = key[(o.col + d[0]) + "_" + (o.row + d[1])];
        if (q !== undefined && pass[q] && !seen[q] && C[q].sec === o.sec) { seen[q] = 1; st.push(q); }
      }
    }
    groups.push(m.sort((a, b) => a - b));
  }
  const min = e.size > 0 ? e.size : 1;
  const big = groups.filter((g) => g.length >= min), small = groups.filter((g) => g.length < min);
  const list = big.map((cells) => Object.assign({ cells, id: "p" + cells[0] }, stats(M, cells)));
  list.sort((a, b) => (a.sec - b.sec) || (a.town - b.town));
  const LET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const of = {};
  list.forEach((p, j) => {
    p.letter = j < 26 ? LET[j] : LET[Math.floor(j / 26) - 1] + LET[j % 26];
    Object.assign(p, where(M, p));
    p.cells.forEach((k) => { of[k] = p.id; });
  });
  const r = { list, of, smallCells: [].concat(...small), inList: list.reduce((s, p) => s + p.n, 0), pass };
  M.memo[mk] = r;
  return r;
}

export function where(M, p) {
  const m = M.evenKm[p.sec] || [p.cx, p.cy, 0];
  const title = m[2] === 0 ? "Edge of town" : "Highway km " + m[2];
  const side = p.hw <= 300 ? "Beside the highway" : dist(p.hw) + " " + (p.cx < m[0] ? "west" : "east") + " of the highway";
  let bx = 0, by = 0, bd = 1e9;
  p.cells.forEach((k) => { const o = M.C[k]; const d = Math.hypot(o.x - p.cx, o.y - p.cy); if (d < bd) { bd = d; bx = o.x; by = o.y; } });
  return { title, side, km: m[2], bx, by };
}

// ---------- words ----------
export function dist(m) { return m < 1000 ? Math.round(m / 10) * 10 + " m" : (Math.round(m / 100) / 10).toFixed(1) + " km"; }
export function ha(v) { return v >= 100 ? Math.round(v) + " ha" : (Math.round(v * 10) / 10) + " ha"; }
export function mvTxt(v) {
  if (v === null || v === undefined) return "No radar reading";
  if (Math.abs(v) < 0.05) return "Same as the airport pad";
  return Math.abs(v).toFixed(1) + " cm " + (v < 0 ? "more" : "less") + " than the airport pad";
}
export function chgTxt(v, sea) {
  if (v === null || v === undefined) return sea > 2000 ? "Inland: coast not a factor" : "No measured shoreline beside it";
  if (Math.abs(v) <= 15) return "Steady within ±15 m since 2005";
  return "Moved " + Math.round(Math.abs(v)) + " m " + (v > 0 ? "inland" : "seaward") + " since 2005";
}
export function scenTxt(T, scen) {
  const [y, s] = String(scen).split("-");
  const L = floodLevel(T, scen);
  return `a 1-in-${s}-year storm, ${y}` + (L != null ? ` (${L.toFixed(1)} m)` : "");
}
export function floodTxt(T, flLow, scen) {
  if (flLow == null) return "No flood estimate";
  const L = floodLevel(T, scen);
  if (L == null) return `Water from the sea would reach it at about ${flLow.toFixed(1)} m`;
  return flLow > L ? `Stays dry in ${scenTxt(T, scen)}` : `Part floods in ${scenTxt(T, scen)}`;
}
export function valTxt(T, k, v) {
  if (k === "h") return Number(v).toFixed(1) + " m";
  if (k === "wet" || k === "cov") return v + "%";
  if (k === "size") return v + " square" + (v === 1 ? "" : "s") + " · " + ha(v * HA);
  if (k === "flood") return scenTxt(T, v);
  return dist(v);
}
