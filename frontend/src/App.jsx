// Ground Check, Part 7: the land screening tool, built to the design canvas (Main.dc.html).
// Data: public/data/tool.json (written by data-pipeline/src/export_tool_v3.py). Nothing here is ranked.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as G from "./lib/tool.js";
import "./tool.css";
import Sources from "./components/Sources.jsx";
import Views from "./components/Views.jsx";

const BASE = "./data/";
const get = (f) => fetch(BASE + f).then((r) => { if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json(); });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDay = (iso) => { if (!iso) return ""; const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

export default function App({ view = "advanced" }) {
  const [M, setM] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    document.body.classList.add("gk-lock");
    get("manifest.json")
      .then((m) => { setManifest(m); return get(m.files?.tool || "tool.json"); })
      .then((T) => setM(G.decode(T)))
      .catch((e) => setErr(String(e.message || e)));
    return () => document.body.classList.remove("gk-lock");
  }, []);
  if (err) return <div className="gk"><div className="gk-wait"><h1>The map data didn’t load</h1><p>{err}</p><p>Reload the page to try again.</p></div></div>;
  if (!M) return <div className="gk"><div className="gk-wait" role="status"><p>Loading the map…</p></div></div>;
  return <Tool M={M} manifest={manifest || {}} view={view} />;
}

// ---------- small pieces ----------
const Ic = ({ d, children }) => <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">{d ? <path d={d} /> : children}</svg>;
const InfoIc = () => <Ic><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></Ic>;
const SatIc = () => <Ic><path d="M4 20c0-5 4-9 9-9" /><path d="M4 16c0-3 2.5-5 5-5" /><circle cx="4.5" cy="19.5" r=".6" /><path d="M14 4l6 6-3 3-6-6z" /><path d="M13 11l-2-2" /></Ic>;
const PrintIc = () => <Ic><path d="M7 9V4h10v5" /><rect x="4" y="9" width="16" height="7" rx="2" /><path d="M7 14h10v6H7z" /></Ic>;
const Brand = () => (
  <svg width="30" height="30" viewBox="0 0 34 34" aria-hidden="true"><rect x="1" y="1" width="32" height="32" rx="9" fill="#FFFFFF" /><path d="M7 23c4-1 6-5 10-5s6 3 10 2" fill="none" stroke="#274C77" strokeWidth="2.4" strokeLinecap="round" /><path d="M7 16.5c4-1 5-6 10-6s6 3 10 2" fill="none" stroke="#6096BA" strokeWidth="2.4" strokeLinecap="round" /><path d="M7 27.5h20" stroke="#13243A" strokeWidth="2.4" strokeLinecap="round" /></svg>
);
const Switch = ({ on, onChange, label }) => (
  <label className="gk-switch"><input type="checkbox" checked={on} onChange={onChange} aria-label={label} /><span /></label>
);
const NO_STRIP = { show: false };

function airportCentre(d) {
  const n = (d || "").match(/-?\d+(\.\d+)?/g)?.map(Number) || [];
  let sx = 0, sy = 0, k = 0;
  for (let i = 0; i + 1 < n.length; i += 2) { sx += n[i]; sy += n[i + 1]; k++; }
  return k ? [sx / k, sy / k] : null;
}

function Tool({ M, manifest, view }) {
  const T = M.T, C = M.C;
  const [cr, setCr] = useState({ ...G.DEF });
  const [on, setOn] = useState({ ...G.DON });
  const [note, setNote] = useState("");
  const [sort, setSort] = useState("road");
  const [sel, setSel] = useState("");
  const [hov, setHov] = useState("");
  const [pins, setPins] = useState([]);
  const [zoom, setZoom] = useState("region");
  const [named, setNamed] = useState("");
  const [cell, setCell] = useState(-1);
  const [tab, setTab] = useState("places");
  const [mtab, setMtab] = useState("rules");
  const [about, setAbout] = useState(false);
  const [more, setMore] = useState(false);
  const simple = view === "simple";
  const [showFlood, setShowFlood] = useState(true);
  const [printing, setPrinting] = useState(null);
  const [asp, setAsp] = useState(0.8);
  const mapBox = useRef(null);
  const rightScroll = useRef(null);
  useEffect(() => { if (rightScroll.current) rightScroll.current.scrollTop = 0; }, [sel, tab, view]);
  // Simple opens on its list; Advanced on its rules (phone tabs)
  useEffect(() => { setMtab(view === "simple" ? "list" : "rules"); }, [view]);

  useEffect(() => {
    const el = mapBox.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); if (r.width && r.height) setAsp(r.width / r.height); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);
  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => { window.print(); setPrinting(null); }, 60);
    return () => clearTimeout(t);
  }, [printing]);

  // fixed geometry: histograms per rule, the town box, label positions
  const geo = useMemo(() => {
    const H = {};
    G.CRIT.forEach((c) => {
      if (c.kind !== "min" && c.kind !== "max") return;
      const nb = 24, w = (c.max - c.min) / nb, counts = new Array(nb).fill(0);
      C.forEach((o) => { const b = Math.min(nb - 1, Math.max(0, Math.floor((o[c.f] - c.min) / w))); counts[b]++; });
      H[c.k] = { counts, w, max: Math.max(...counts) };
    });
    const nm = T.named || {};
    const pts = ["the_point", "town_core", "reindeer_point"].map((k) => nm[k]?.c).filter(Boolean);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const town = pts.length ? [Math.min(...xs) - 50, Math.min(...ys) - 30, Math.max(...xs) - Math.min(...xs) + 100, Math.max(...ys) - Math.min(...ys) + 70] : [0, 0, T.W, T.H];
    const inView = T.kms.filter((k) => k[1] <= T.H - 8);
    const end = inView[inView.length - 1] || [T.W / 2, T.H];
    return { H, town, air: airportCentre(T.airport), end };
  }, [M]);

  const E = useMemo(() => G.eff(cr, on), [cr, on]);
  const ek = JSON.stringify(E);
  const P = G.places(M, E), list = P.list;
  const count = (cr1, on1) => G.places(M, G.eff(cr1, on1)).list.length;
  const L = G.floodLevel(T, cr.flood);

  const apply = (cr1, on1, label) => {
    const b = count(cr, on), a = count(cr1, on1);
    setNote(`${label}: ${b} → ${a} place${a === 1 ? "" : "s"}`);
    const P1 = G.places(M, G.eff(cr1, on1));
    const keep = P1.list.find((p) => p.id === sel) ? sel : "";
    setCr(cr1); setOn(on1); setSel(keep);
    if (!keep && zoom === "place") setZoom("region");
  };
  const toggle = (c) => () => { const v = !on[c.k]; apply(cr, { ...on, [c.k]: v }, c.short + (v ? " rule on" : " rule off")); };
  const change = (c) => (e) => { const v = Number(e.target.value); apply({ ...cr, [c.k]: v }, on, `${c.short} ${c.lead.toLowerCase()} ${G.valTxt(T, c.k, v)}`); };
  const setScen = (y, s) => {
    const [y0, s0] = cr.flood.split("-"); const v = `${y || y0}-${s || s0}`;
    if (v === cr.flood) return;
    const [yy, ss] = v.split("-");
    apply({ ...cr, flood: v }, on, `Flood ${yy} · 1-in-${ss} storm`);
  };
  const reset = () => apply({ ...G.DEF }, { ...G.DON }, "Starting point");
  const pick = (id) => { setSel(id); setNamed(""); setTab("places"); setMtab("list"); if (simple) setZoom("place"); };
  const back = () => { setSel(""); if (zoom === "place") setZoom("region"); };
  const pinned = (id) => !!pins.find((q) => q.id === id);
  const selP = list.find((p) => p.id === sel);
  const pinSel = () => {
    const p = selP; if (!p) return;
    if (pinned(p.id)) { setPins(pins.filter((q) => q.id !== p.id)); return; }
    if (pins.length >= 3) return;
    setPins([...pins, { id: p.id, letter: p.letter, title: p.title, cells: p.cells.slice(), ck: ek }]);
  };

  // ---------- rules panel ----------
  const keepShare = (c, v) => { let k = 0; C.forEach((o) => { if (G.passOne(M, o, c.k, v)) k++; }); return Math.round((k / M.N) * 100); };
  const activeN = G.CRIT.filter((c) => on[c.k]).length;
  const isDef = JSON.stringify(cr) === JSON.stringify(G.DEF) && JSON.stringify(on) === JSON.stringify(G.DON);

  // ---------- list ----------
  const ordered = list.slice();
  if (sort === "town") ordered.sort((a, b) => a.town - b.town);
  if (sort === "size") ordered.sort((a, b) => b.n - a.n);
  if (sort === "height") ordered.sort((a, b) => b.h - a.h);
  if (sort === "shore") ordered.sort((a, b) => b.sea - a.sea);
  const relax = list.length ? [] : G.CRIT.filter((c) => on[c.k]).map((c) => {
    const n = count(cr, { ...on, [c.k]: false });
    return { k: c.k, txt: "Turn off " + c.short.toLowerCase(), n: n + " place" + (n === 1 ? "" : "s"), go: toggle(c) };
  });

  // ---------- facts ----------
  const rng = (f) => { const v = list.map((p) => p[f]); return [Math.min(...v), Math.max(...v)]; };
  const strip = (f, v, fm) => {
    if (list.length < 2 || v == null) return NO_STRIP;
    const r = rng(f), pos = r[1] - r[0] < 1e-9 ? 50 : Math.round(((v - r[0]) / (r[1] - r[0])) * 100);
    return { show: true, pos: Math.max(0, Math.min(100, pos)), lo: fm(r[0]), hi: fm(r[1]) };
  };
  const dm = (v) => G.dist(v), pc = (v) => Math.round(v) + "%";
  const scenShort = (() => { const [y, s] = cr.flood.split("-"); return `1-in-${s} storm, ${y}`; })();
  const floodFact = (t) => {
    if (t.flLow == null || L == null) return { val: "—", sub: "No flood estimate" };
    const dry = t.flLow > L;
    return { val: dry ? "Stays dry" : "Part floods", sub: `In a ${scenShort} (${L.toFixed(1)} m). Sea water reaches its lowest tenth at about ${t.flLow.toFixed(1)} m · estimate` };
  };
  const boreFact = (t) => (t.bore > 3000
    ? { val: "None near", sub: "No highway borehole within 3 km" }
    : { val: G.dist(t.bore), sub: t.boreIce ? "That log found ice-rich ground" : "That log found no ice-rich ground" });
  const factsOf = (p, withStrips) => {
    const s = withStrips ? strip : () => NO_STRIP;
    const ff = floodFact(p), bf = boreFact(p);
    return [
      { lbl: "Size", val: p.n + " squares", sub: G.ha(p.ha), s: s("n", p.n, (v) => v + " sq") },
      { lbl: "Middle height", val: p.h.toFixed(1) + " m", sub: "Lowest tenth " + p.low.toFixed(1) + " m", s: s("h", p.h, (v) => v.toFixed(1) + " m") },
      { lbl: "Storm flood", val: ff.val, sub: ff.sub, s: NO_STRIP },
      { lbl: "Shore", val: G.dist(p.sea), sub: G.chgTxt(p.chg, p.sea), s: s("sea", p.sea, dm) },
      { lbl: "Highway", val: p.hw <= 50 ? "Touches it" : G.dist(p.hw), sub: "At about km " + p.km, s: s("hw", p.hw, dm) },
      { lbl: "Town centre", val: G.dist(p.town), sub: "Straight line", s: s("town", p.town, dm) },
      { lbl: "Lakes and ponds", val: Math.round(p.wet) + "%", sub: "Of land within 250 m", s: s("wet", p.wet, pc) },
      { lbl: "Radar sees", val: Math.round(p.cov) + "%", sub: "Of the ground", s: s("cov", p.cov, pc) },
      { lbl: "Nearest borehole", val: bf.val, sub: bf.sub, s: NO_STRIP },
      { lbl: "Summer movement", val: p.mv == null ? "—" : Math.abs(p.mv).toFixed(1) + " cm", sub: G.mvTxt(p.mv) + " · unconfirmed", s: NO_STRIP, un: true },
    ];
  };

  // ---------- map ----------
  const vb = (() => {
    if (zoom === "town") return fit(geo.town, asp);
    if (zoom === "place" && selP) {
      const b = selP.bb, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
      return fit([cx - Math.max(b[2] - b[0] + 30, 60) / 2, cy - Math.max(b[3] - b[1] + 30, 60) / 2, Math.max(b[2] - b[0] + 30, 60), Math.max(b[3] - b[1] + 30, 60)], asp);
    }
    return [0, 0, T.W, T.H];
  })();
  const z = vb[2] / T.W;
  const fs = 9 * Math.min(z, 1.4), fsS = 7.5 * Math.min(z, 1.4);
  const layers = useMemo(() => {
    let optD = "", smallD = "";
    list.forEach((p) => p.cells.forEach((k) => { optD += G.sq(C[k]); }));
    P.smallCells.forEach((k) => { smallD += G.sq(C[k]); });
    return { optD, smallD };
  }, [ek]);
  const floodD = useMemo(() => {
    if (L == null) return "";
    let d = ""; C.forEach((o) => { if (o.fl50 != null && o.fl50 < L) d += G.sq(o); });
    return d;
  }, [M, L]);
  const hovP = list.find((p) => p.id === hov && p.id !== sel);
  const inV = (x, y) => x >= vb[0] && x <= vb[0] + vb[2] && y >= vb[1] && y <= vb[1] + vb[3];
  const zz = Math.max(Math.min(z, 1.4), 0.3);
  const badges = list.filter((p) => inV(p.bx, p.by)).map((p) => {
    const act = p.id === sel, hv = p.id === hov;
    const r = 6.4 * zz * (act || hv ? 1.2 : 1);
    return { id: p.id, x: p.bx, y: p.by, r, t: p.letter, fill: act ? "#13243A" : "#FFFFFF", ink: act ? "#FFFFFF" : "#13243A", fs: r * (p.letter.length > 1 ? 0.85 : 1.1), sw: 1.3 * zz };
  });
  const kms = T.kms.filter((k) => k[2] > 0 && (z > 0.9 ? k[2] % 4 === 0 : true) && inV(k[0], k[1]));
  const kmLen = z > 0.9 ? 5 : z > 0.35 ? 1 : 0.5;
  const sc = { x1: vb[0] + vb[2] * 0.05, y: vb[1] + vb[3] * 0.975, ty: vb[1] + vb[3] * 0.965 };
  const unitsPerKm = 1000 / T.unit_m;
  const nm = named ? T.named[named] : null;

  const toMap = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = Math.min(r.width / vb[2], r.height / vb[3]);
    const ox = (r.width - vb[2] * k) / 2, oy = (r.height - vb[3] * k) / 2;
    return [vb[0] + (e.clientX - r.left - ox) / k, vb[1] + (e.clientY - r.top - oy) / k];
  };
  const cellAt = (p) => { const q = M.inv(p[0], p[1]); const k = M.key[Math.round(q[0]) + "_" + Math.round(q[1])]; return k === undefined ? -1 : k; };
  const onMapClick = (e) => { const k = cellAt(toMap(e)); const id = k >= 0 ? P.of[k] : undefined; setCell(k); if (id) { setSel(id); setNamed(""); setTab("places"); } };
  const onMapMove = (e) => { const k = cellAt(toMap(e)); if (k === cell) return; setCell(k); setHov(k >= 0 && P.of[k] ? P.of[k] : ""); };
  const onMapLeave = () => { setCell(-1); setHov(""); };

  let cellTxt = "Point at the map to read any square.", cellHead = "";
  if (cell >= 0 && C[cell]) {
    const o = C[cell], f = G.fails(M, o, E);
    const fl = L != null && o.fl50 != null && o.fl50 < L ? " · floods in the storm" : "";
    cellTxt = `${o.h.toFixed(1)} m high · shore ${G.dist(o.sea)} · highway ${G.dist(o.hw)} · town ${G.dist(o.town)} · water ${o.wet}% · radar ${o.cov}%${fl}`;
    if (P.of[cell]) cellHead = "Place " + list.find((q) => q.id === P.of[cell]).letter;
    else if (!f.length) cellHead = "Fits, piece too small";
    else cellHead = "Misses " + f.map((k) => G.critOf(k).short.toLowerCase()).join(", ");
  }

  // ---------- named places ----------
  const namedCards = ["the_point", "town_core", "reindeer_point"].filter((id) => T.named?.[id]).map((id) => {
    const q = T.named[id];
    const val = { h: q.h, sea: q.sea, hw: q.hw, town: q.town, wet: q.wet * 100, cov: q.cov * 100 };
    const show = { h: q.h.toFixed(1) + " m", sea: G.dist(q.sea), hw: G.dist(q.hw), town: G.dist(q.town), wet: Math.round(q.wet * 100) + "%", cov: Math.round(q.cov * 100) + "%" };
    const rows = G.CRIT.filter((c) => c.f && on[c.k]).map((c) => {
      let ok, v;
      if (c.kind === "flood") { ok = q.fl10 == null || L == null || q.fl10 > L; v = q.fl10 == null ? "no estimate" : `water from ${q.fl10.toFixed(1)} m`; }
      else { ok = c.kind === "min" ? val[c.k] >= cr[c.k] : val[c.k] <= cr[c.k]; v = show[c.k]; }
      return { k: c.k, lbl: c.short, val: v, ask: c.kind === "flood" ? `dry in a ${scenShort}` : c.lead.toLowerCase() + " " + G.valTxt(T, c.k, cr[c.k]), ok };
    });
    const met = rows.filter((r) => r.ok).length;
    return { id, name: q.name, rows, sum: rows.length ? `${met} of ${rows.length} rules met` : "No rules on" };
  });

  // ---------- compare ----------
  const pinStats = pins.map((q) => ({ q, st: G.stats(M, q.cells), old: q.ck !== ek || !list.find((p) => p.id === q.id) }));
  const CMP = [
    ["Size", (t) => t.n + " sq · " + G.ha(t.ha)],
    ["Middle height", (t) => t.h.toFixed(1) + " m"],
    ["Lowest tenth", (t) => t.low.toFixed(1) + " m"],
    ["Storm flood · " + scenShort, (t) => floodFact(t).val],
    ["Shore", (t) => G.dist(t.sea)],
    ["Shoreline", (t) => G.chgTxt(t.chg, t.sea)],
    ["Highway", (t) => G.dist(t.hw)],
    ["Town centre", (t) => G.dist(t.town)],
    ["Lakes and ponds", (t) => Math.round(t.wet) + "%"],
    ["Radar sees", (t) => Math.round(t.cov) + "%"],
    ["Nearest borehole", (t) => { const b = boreFact(t); return t.bore > 3000 ? b.val : `${b.val} · ${t.boreIce ? "ice-rich" : "no ice-rich ground"}`; }],
    ["Summer movement · unconfirmed", (t) => G.mvTxt(t.mv)],
  ];
  const cols = { gridTemplateColumns: `repeat(${Math.max(1, pins.length)}, minmax(0, 1fr))` };

  const fr = manifest.freshness || {};
  const lp = fr.latest_pass || {};
  const countWord = list.length === 1 ? "place fits" : "places fit";
  const gridTf = `matrix(${T.grid.join(" ")})`;
  const tc = T.named?.town_core?.c, pt = T.named?.the_point?.c, rp = T.named?.reindeer_point?.c;
  const mapSvg = (
          <svg className="gk-map" viewBox={vb.map((q) => q.toFixed(1)).join(" ")} role="img"
            aria-label="Map from Tuktoyaktuk south along the highway. Dark blue land fits your rules and is listed, with a letter for each place. Mid blue fits but is smaller than your minimum size. Hatched land floods in the chosen storm. The Places panel lists the same places as buttons."
            onClick={onMapClick} onPointerMove={onMapMove} onPointerLeave={onMapLeave}>
            <defs>
              <pattern id="gk-hatch" patternUnits="userSpaceOnUse" width="0.3" height="0.3" patternTransform="rotate(45)">
                <rect width="0.3" height="0.3" fill="#E4F0FA" /><path d="M0 0.15H0.3" stroke="#6096BA" strokeWidth="0.09" />
              </pattern>
            </defs>
            <rect x="-400" y="-400" width={T.W + 800} height={T.H + 800} fill="#BCDAF2" />
            <g transform={gridTf}>
              <path d={M.landD} fill="#F6F7F4" />
              {showFlood && floodD && <path d={floodD} fill="url(#gk-hatch)" />}
              <path d={layers.smallD} fill="#6096BA" />
              <path d={layers.optD} fill="#274C77" />
              {hovP && <path d={G.outline(M, hovP.cells)} fill="none" stroke="#13243A" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />}
              {selP && <g><path d={G.outline(M, selP.cells)} fill="none" stroke="#FFFFFF" strokeWidth="5.5" vectorEffect="non-scaling-stroke" /><path d={G.outline(M, selP.cells)} fill="none" stroke="#13243A" strokeWidth="2.4" vectorEffect="non-scaling-stroke" /></g>}
            </g>
            <path d={T.roads} fill="none" stroke="#8B8C89" strokeWidth="0.8" opacity=".75" vectorEffect="non-scaling-stroke" />
            <path d={T.hwy} fill="none" stroke="#13243A" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <path d={T.hwy} fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <path d={T.airport} fill="#FFFFFF" fillOpacity=".6" stroke="#46566A" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
            {nm && <g><path d={nm.d} fill="#A3CEF1" fillOpacity=".6" stroke="#FFFFFF" strokeWidth="4" vectorEffect="non-scaling-stroke" /><path d={nm.d} fill="none" stroke="#13243A" strokeWidth="2" strokeDasharray="5 3" vectorEffect="non-scaling-stroke" /></g>}
            <g fontFamily="Atkinson Hyperlegible Next, Verdana, sans-serif" fontWeight="700" stroke="#FFFFFF" strokeWidth={2.2 * Math.min(z, 1.4)} paintOrder="stroke" strokeLinejoin="round">
              {kms.map((k) => <g key={k[2]}><circle cx={k[0]} cy={k[1]} r={1.8 * Math.max(Math.min(z, 1.4), 0.4)} fill="#13243A" /><text x={k[0] + 5 * z + 1} y={k[1] + 2.6 * z} fontSize={fsS} fill="#13243A">km {k[2]}</text></g>)}
              {z > 0.9 && tc && <g>
                <text x={tc[0] - 150} y={tc[1] + 90} fontSize={fs} fontStyle="italic" fontWeight="400" fill="#274C77">Beaufort Sea</text>
                <text x={tc[0] + 12} y={tc[1] + 4} fontSize={fs} fill="#13243A">Tuktoyaktuk</text>
                <text x={geo.end[0] + 8} y={Math.min(geo.end[1], T.H - 14)} fontSize={fsS} fill="#13243A">To Inuvik</text>
              </g>}
              {z <= 0.9 && <g>
                {tc && <text x={tc[0] + 48} y={tc[1] - 14} fontSize={fs} fontStyle="italic" fontWeight="400" fill="#274C77">Kugmallit Bay</text>}
                {pt && <text x={pt[0]} y={pt[1] - 7} textAnchor="middle" fontSize={fsS} fill="#13243A">The Point</text>}
                {tc && <text x={tc[0] + 9} y={tc[1] + 3} fontSize={fsS} fill="#13243A">Town core</text>}
                {rp && <text x={rp[0] + 9} y={rp[1] + 3} fontSize={fsS} fill="#13243A">Reindeer Point</text>}
                {geo.air && <text x={geo.air[0] - 9} y={geo.air[1] + 3} textAnchor="end" fontSize={fsS} fill="#46566A">Airport</text>}
              </g>}
              <path d={`M${sc.x1} ${sc.y}H${sc.x1 + kmLen * unitsPerKm}`} stroke="#13243A" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
              <text x={sc.x1} y={sc.ty} fontSize={fsS} fill="#13243A">{kmLen} km</text>
            </g>
            {badges.map((b) => <g key={b.id}><circle cx={b.x} cy={b.y} r={b.r} fill={b.fill} stroke="#13243A" strokeWidth={b.sw} /><text x={b.x} y={b.y + b.r * 0.36} textAnchor="middle" fontSize={b.fs} fontWeight="700" fontFamily="Geologica, system-ui, sans-serif" fill={b.ink}>{b.t}</text></g>)}
          </svg>
  );

  // ---------- Simple view (design: map + one Places panel, three rules on the map, the rest behind "More rules") ----------
  if (simple) {
    const SHORT = { h: "Height", flood: "Storm flood", sea: "From the shore", hw: "To the highway", town: "To town", wet: "Lakes and ponds", cov: "Radar sees", size: "Place size" };
    const MAIN = ["h", "sea", "hw"];
    const ruleVal = (c) => (c.kind === "flood" ? `Dry · ${cr.flood.replace("-", " · 1-in-")}` : c.k === "size" ? "At least " + G.ha(cr.size * G.HA) : `${c.lead} ${G.valTxt(T, c.k, cr[c.k])}`);
    const moreRules = G.CRIT.filter((c) => !MAIN.includes(c.k));
    const moreOnN = moreRules.filter((c) => on[c.k]).length;
    const slider = (c) => <input id={"sp-r-" + c.k} className="gk-range" type="range" min={c.min} max={c.max} step={c.step} value={cr[c.k]} disabled={!on[c.k]} onChange={change(c)} />;
    const sw = (c) => <Switch on={!!on[c.k]} onChange={toggle(c)} label={`Use the ${SHORT[c.k]} rule`} />;
    const [yy, ss] = cr.flood.split("-");
    const Chev = () => <svg className="ic sp-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>;
    const ff = selP ? floodFact(selP) : null;
    return (
      <div className="gk">
        <div className="gk-app sp-app">
          <header className="gk-bar">
            <div className="gk-brand"><Brand /><b>Ground Check</b></div>
            <span className="div" />
            <span className="ctx">Tuktoyaktuk · where the land fits your rules</span>
            <Views on="simple" />
            <button type="button" className="gk-barbtn" onClick={() => setAbout(true)}><InfoIc /><span>About the data</span></button>
          </header>

          <div className="gk-mapw" ref={mapBox}>
            {mapSvg}
            <div className="gk-ov gk-tools sp-zoom">
              <div className="gk-seg" role="group" aria-label="Map view">
                <button type="button" aria-pressed={zoom === "region"} onClick={() => setZoom("region")}>Whole area</button>
                <button type="button" aria-pressed={zoom === "town"} onClick={() => setZoom("town")}>Town</button>
              </div>
            </div>
            <div className="gk-ov sp-key">
              <span><i style={{ background: "#274C77" }} />Fits</span>
              <span><i style={{ background: "#6096BA" }} />Fits, too small to list</span>
              {showFlood && on.flood && <span><i className="h" />Floods in the storm</span>}
            </div>
            {cellHead && <div className="gk-ov gk-readout sp-read num" aria-live="polite"><b>{cellHead}</b><span>{cellTxt}</span></div>}
          </div>

          <section className={"sp-rules" + (mtab === "rules" ? " m-on" : "")} aria-labelledby="sp-rules-h">
            <div className="sp-rh"><h2 id="sp-rules-h">Your rules</h2>{!isDef && <button type="button" className="sp-link" onClick={reset}>Reset</button>}</div>
            {G.CRIT.filter((c) => MAIN.includes(c.k)).map((c) => (
              <div key={c.k} className={on[c.k] ? "sp-rule" : "sp-rule is-off"}>
                <div className="sp-rl"><label htmlFor={"sp-r-" + c.k}>{SHORT[c.k]}</label><span className="sp-rv"><b className="num">{on[c.k] ? ruleVal(c) : "Off"}</b>{!on[c.k] && sw(c)}</span></div>
                {slider(c)}
              </div>
            ))}
            <button type="button" className="sp-more" aria-expanded={more} onClick={() => setMore(!more)}><span>{more ? "Fewer rules" : `More rules · ${moreOnN} of ${moreRules.length} on`}</span><Ic d={more ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} /></button>
            {more && <div className="sp-extra">
              {moreRules.map((c) => (
                <div key={c.k} className={on[c.k] ? "sp-rule" : "sp-rule is-off"}>
                  <div className="sp-rl"><label htmlFor={"sp-r-" + c.k}>{SHORT[c.k]}</label><span className="sp-rv"><b className="num">{on[c.k] ? ruleVal(c) : "Off"}</b>{sw(c)}</span></div>
                  {c.kind === "flood" ? (
                    <div className="sp-flood">
                      <div className="gk-fseg"><span>Year</span><div className="gk-seg" role="group" aria-label="Flood year">{G.SCENARIO_YEARS.map((y) => <button key={y} type="button" disabled={!on.flood} aria-pressed={yy === y} onClick={() => setScen(y, null)}>{y}</button>)}</div></div>
                      <div className="gk-fseg"><span>Storm</span><div className="gk-seg" role="group" aria-label="Storm size">{G.SCENARIO_STORMS.map(([k2, t]) => <button key={k2} type="button" disabled={!on.flood} aria-pressed={ss === k2} onClick={() => setScen(null, k2)}>{t}</button>)}</div></div>
                    </div>
                  ) : slider(c)}
                </div>
              ))}
            </div>}
          </section>

          <nav className="gk-mtabs" role="tablist" aria-label="Panels">
            <button type="button" role="tab" aria-selected={mtab === "list"} onClick={() => setMtab("list")}>Places · {list.length}</button>
            <button type="button" role="tab" aria-selected={mtab === "rules"} onClick={() => setMtab("rules")}>Rules</button>
          </nav>

          <aside className={"gk-right" + (mtab === "list" ? " m-on" : "")} aria-label="Places">
            <div className="gk-scroll" ref={rightScroll}>
              {!selP && <div>
                <div className="sp-head">
                  <div className="sp-big num" aria-live="polite"><b>{list.length}</b><span>{list.length === 1 ? "place fits your rules" : "places fit your rules"}</span></div>
                  <p className="sp-note num">{note || "Move a rule on the map. The list updates as you go."}</p>
                </div>
                {list.length > 0 && <div>
                  <p className="sp-order">Listed along the highway from town. Not ranked. <a href="#advanced">Sort, compare and more in Advanced</a></p>
                  {list.map((p) => (
                    <button key={p.id} type="button" className={"gk-row" + (hov === p.id ? " is-hov" : "")} onClick={() => pick(p.id)} onMouseEnter={() => setHov(p.id)} onMouseLeave={() => setHov("")}>
                      <span className="gk-let">{p.letter}</span>
                      <span className="gk-rt"><b>{p.title}</b><span>{p.h.toFixed(1)} m high · {G.ha(p.ha)} · {p.hw <= 300 ? "by the highway" : G.dist(p.hw) + " off the highway"}</span></span>
                      <Chev />
                    </button>
                  ))}
                </div>}
                {list.length === 0 && <div className="gk-empty">
                  <h3>No place fits all of these at once</h3>
                  <p>Turning off one rule would bring back:</p>
                  <div className="gk-relax">{relax.map((x) => <button key={x.k} type="button" onClick={x.go}><span>{x.txt}</span><b className="num">{x.n}</b></button>)}</div>
                </div>}
              </div>}
              {selP && <div>
                <div className="gk-dh"><button type="button" className="gk-back" onClick={back}><Ic d="M15 6l-6 6 6 6" />All {list.length} places</button></div>
                <div className="gk-dt"><span className="gk-let" aria-hidden="true">{selP.letter}</span><div><h3>Place {selP.letter} · {selP.title}</h3><p>{selP.side}</p></div></div>
                <div className="sp-tiles">
                  <div className="sp-tile"><span className="gk-m">Size</span><b className="num">{G.ha(selP.ha)}</b><small>{selP.n} squares of 240 m</small></div>
                  <div className="sp-tile"><span className="gk-m">Height</span><b className="num">{selP.h.toFixed(1)} m</b><small>Lowest tenth {selP.low.toFixed(1)} m</small></div>
                  <div className="sp-tile"><span className="gk-m">From the shore</span><b className="num">{G.dist(selP.sea)}</b><small>{G.chgTxt(selP.chg, selP.sea)}</small></div>
                  <div className="sp-tile"><span className="gk-m">To town</span><b className="num">{G.dist(selP.town)}</b><small>{selP.hw <= 50 ? `On the highway, km ${selP.km}` : `${G.dist(selP.hw)} to the highway`}</small></div>
                </div>
                <div className="sp-mv sp-fl"><span className="gk-m">Storm flood · estimate</span><b className="num">{ff.val}</b><small>{ff.sub.replace(/ · estimate$/, "")}</small></div>
                <div className="sp-mv"><span className="gk-m is-un">Summer movement · unconfirmed</span><b className="num">{G.mvTxt(selP.mv)}</b><a className="sp-in" href="#nisar">How good is the radar? Research view<Ic d="M9 6l6 6-6 6" /></a></div>
                <a className="sp-deep" href="#advanced"><span><b>See every fact</b><small>Every fact, nearest borehole, range among places, compare and print in Advanced</small></span><Ic d="M9 6l6 6-6 6" /></a>
                <p className="sp-core">Every place still needs a drilled core before anything is built.</p>
              </div>}
            </div>
          </aside>

          <footer className="gk-status">
            <span className="gk-m">Measured</span>
            <span className="gk-m is-un">Unconfirmed</span>
            <span className="sep" />
            <span>Not ranked · student prototype, not endorsed by the Hamlet</span>
            <span className="sep opt" />
            <button type="button" className="gk-stlink" onClick={() => setAbout("sources")}>Sources</button>
            <span className="r">{lp.date ? `Last radar pass used: ${fmtDay(lp.date)}, Sentinel-1` : ""}</span>
          </footer>

          {about && <About T={T} focus={about} onClose={() => setAbout(false)} />}
        </div>
      </div>
    );
  }

  return (
    <div className="gk">
      <div className="gk-app">
        <header className="gk-bar">
          <div className="gk-brand"><Brand /><b>Ground Check</b></div>
          <span className="div" />
          <span className="ctx">Tuktoyaktuk · land screening tool</span>
          <Views on="advanced" />
          <div className="gk-sum" aria-live="polite"><span className="num"><b>{list.length}</b> <span className="t">{countWord}</span></span><span className="l">Not ranked</span></div>
          <button type="button" className="gk-barbtn" onClick={() => setAbout(true)}><InfoIc /><span>About the data</span></button>
        </header>

        <aside className={"gk-left" + (mtab === "rules" ? " m-on" : "")} aria-label="Rules">
          <div className="gk-ph">
            <div><h2>Your rules</h2><small className="num">{activeN} of {G.CRIT.length} on</small></div>
            {!isDef && <button type="button" className="gk-btn" onClick={reset}><Ic><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4h4" /></Ic>Reset</button>}
          </div>
          <div className="gk-note num" aria-live="polite"><Ic d="M5 12h14M13 6l6 6-6 6" /><span>{note || "Move any slider. The map and list update as you go."}</span></div>
          <div className="gk-scroll">
            {G.CRIT.map((c) => {
              const isOn = !!on[c.k], v = cr[c.k], id = "gk-r-" + c.k;
              if (c.kind === "flood") {
                const [yy, ss] = v.split("-");
                return (
                  <div key={c.k} className={isOn ? "gk-rule" : "gk-rule is-off"}>
                    <div className="gk-rh"><h3 id={id}>{c.name}</h3><Switch on={isOn} onChange={toggle(c)} label={`Use the ${c.name} rule`} /></div>
                    <div className="gk-rv"><b className="num">{yy} · 1-in-{ss} · {L != null ? L.toFixed(1) + " m" : "—"}</b><span className="num">{isOn ? `keeps ${keepShare(c, v)}% of land` : "not used"}</span></div>
                    <div className="gk-fseg"><span>Year</span><div className="gk-seg" role="group" aria-label="Flood year">{G.SCENARIO_YEARS.map((y) => <button key={y} type="button" disabled={!isOn} aria-pressed={yy === y} onClick={() => setScen(y, null)}>{y}</button>)}</div></div>
                    <div className="gk-fseg"><span>Storm</span><div className="gk-seg" role="group" aria-label="Storm size">{G.SCENARIO_STORMS.map(([s, t]) => <button key={s} type="button" disabled={!isOn} aria-pressed={ss === s} onClick={() => setScen(null, s)}>{t}</button>)}</div></div>
                    <p className="gk-why">{c.why} {T.flood?.url && <a href={T.flood.url} target="_blank" rel="noreferrer">Source</a>}</p>
                  </div>
                );
              }
              const Hh = geo.H[c.k];
              const bars = Hh ? Hh.counts.map((n, b) => {
                const mid = c.min + (b + 0.5) * Hh.w;
                const ok = !isOn || (c.kind === "min" ? mid >= v : mid <= v);
                const hgt = n === 0 ? 0 : Math.max(8, Math.round(Math.sqrt(n / Hh.max) * 100));
                return { height: hgt + "%", background: ok ? (isOn ? "#274C77" : "#9DB3C9") : "#D3D6D1" };
              }) : null;
              const keep = c.kind === "size" ? (isOn ? "smaller pieces not listed" : "not used") : (isOn ? `keeps ${keepShare(c, v)}% of land` : "not used");
              const lo = c.k === "h" ? "0 m" : c.k === "size" ? "1" : c.k === "wet" || c.k === "cov" ? "0%" : "0";
              const hi = c.k === "h" ? "15 m" : c.k === "size" ? "24" : c.k === "wet" || c.k === "cov" ? "100%" : c.max / 1000 + " km";
              return (
                <div key={c.k} className={isOn ? "gk-rule" : "gk-rule is-off"}>
                  <div className="gk-rh"><h3 id={id}>{c.name}</h3><Switch on={isOn} onChange={toggle(c)} label={`Use the ${c.name} rule`} /></div>
                  <div className="gk-rv"><b className="num">{c.lead} {G.valTxt(T, c.k, v)}</b><span className="num">{keep}</span></div>
                  {bars && <div className="gk-hist" aria-hidden="true">{bars.map((st, i) => <i key={i} style={st} />)}</div>}
                  <input className="gk-range" type="range" min={c.min} max={c.max} step={c.step} value={v} disabled={!isOn} onChange={change(c)} aria-labelledby={id} />
                  <div className="gk-hax"><span>{lo}</span><span>{hi}</span></div>
                  <p className="gk-why">{c.why}</p>
                </div>
              );
            })}
          </div>
        </aside>

        <div className="gk-mapw" ref={mapBox}>
          {mapSvg}
          <div className="gk-ov gk-tools">
            <div className="gk-seg" role="group" aria-label="Map view">
              <button type="button" aria-pressed={zoom === "region"} onClick={() => setZoom("region")}>Whole area</button>
              <button type="button" aria-pressed={zoom === "town"} onClick={() => setZoom("town")}>Town</button>
              <button type="button" aria-pressed={zoom === "place"} disabled={!selP} onClick={() => selP && setZoom("place")}>Selected place</button>
            </div>
            <span className="gk-tsep" />
            <div className="gk-seg"><button type="button" aria-pressed={showFlood} onClick={() => setShowFlood(!showFlood)}>Storm flood</button></div>
          </div>
          {nm && <div className="gk-ov gk-chipov"><span>Outlined: {nm.name}</span><button type="button" onClick={() => setNamed("")} aria-label="Remove the outline"><Ic d="M6 6l12 12M18 6L6 18" /></button></div>}
          <div className="gk-ov gk-legend">
            <span><i style={{ background: "#274C77" }} />Fits, listed</span>
            <span><i style={{ background: "#6096BA" }} />Fits, too small</span>
            <span><i style={{ background: "#F6F7F4", boxShadow: "inset 0 0 0 1.5px #B6C1CB" }} />Doesn’t fit</span>
            {showFlood && <span><i className="h" />Floods: {scenShort}</span>}
            <span><i style={{ background: "#BCDAF2", boxShadow: "inset 0 0 0 1.5px #B6C1CB" }} />Water</span>
            <span><i className="l" />Highway</span>
          </div>
          <div className="gk-ov gk-readout num" aria-live="polite">{cellHead && <b>{cellHead}</b>}<span>{cellTxt}</span></div>
        </div>

        <nav className="gk-mtabs" role="tablist" aria-label="Panels">
          <button type="button" role="tab" aria-selected={mtab === "rules"} onClick={() => setMtab("rules")}>Rules</button>
          <button type="button" role="tab" aria-selected={mtab === "list"} onClick={() => setMtab("list")}>Places · {list.length}</button>
        </nav>

        <aside className={"gk-right" + (mtab === "list" ? " m-on" : "")} aria-label="Places">
          <div className="gk-tabs" role="tablist" aria-label="Places panel">
            <button type="button" role="tab" aria-selected={tab === "places"} onClick={() => setTab("places")}>Places <i className="num">{list.length}</i></button>
            <button type="button" role="tab" aria-selected={tab === "named"} onClick={() => setTab("named")}>Named places</button>
            <button type="button" role="tab" aria-selected={tab === "compare"} onClick={() => setTab("compare")}>Compare <i className="num">{pins.length}</i></button>
          </div>

          {tab === "places" && <div className="gk-scroll" ref={rightScroll}>
            {!selP && <div>
              <div className="gk-lh">
                <div className="gk-lh1">
                  <div className="gk-cnt"><b className="num">{list.length}</b><span>{countWord}</span></div>
                  <span className="gk-selw"><select aria-label="Order of the list" value={sort} onChange={(e) => setSort(e.target.value)}>{G.SORTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5" /></svg></span>
                </div>
                <small className="num">{P.inList} squares · {Math.round((P.inList * G.HA) / 10) / 10} km²</small>
                <p className="gk-unr"><InfoIc /><span>Not ranked. Letters follow the highway from town. No place is scored or recommended.</span></p>
              </div>
              {list.length > 0 && <div>
                <div className="gk-cols" aria-hidden="true"><span /><span>Place</span><span>Height</span><span>Shore</span><span>Town</span></div>
                {ordered.map((p) => (
                  <button key={p.id} type="button" className={"gk-row" + (hov === p.id ? " is-hov" : "") + (pinned(p.id) ? " is-pin" : "")}
                    onClick={() => pick(p.id)} onMouseEnter={() => setHov(p.id)} onMouseLeave={() => setHov("")}>
                    <span className="gk-let">{p.letter}</span>
                    <span className="gk-rt"><b>{p.title}</b><span>{p.side} · {p.n} sq · {G.ha(p.ha)}</span></span>
                    <span className="gk-rn num">{p.h.toFixed(1)} m</span><span className="gk-rn num">{G.dist(p.sea)}</span><span className="gk-rn num">{G.dist(p.town)}</span>
                  </button>
                ))}
              </div>}
              {list.length === 0 && <div className="gk-empty">
                <h3>No place fits all of these at once</h3>
                <p>Turning off one rule would bring back:</p>
                <div className="gk-relax">{relax.map((x) => <button key={x.k} type="button" onClick={x.go}><span>{x.txt}</span><b className="num">{x.n}</b></button>)}</div>
              </div>}
            </div>}
            {selP && <Detail M={M} p={selP} facts={factsOf(selP, true)} zoomOn={zoom === "place"} isPin={pinned(selP.id)} pinDis={!pinned(selP.id) && pins.length >= 3}
              onBack={back} onZoom={() => setZoom("place")} onPin={pinSel} onPrint={() => setPrinting("place")} gridTf={gridTf} />}
          </div>}

          {tab === "named" && <div className="gk-scroll">
            <p className="gk-unr gk-unr-bar"><InfoIc /><span>Places people often mention, checked against your rules so the reason they’re in or out is clear.</span></p>
            {namedCards.map((n) => (
              <div key={n.id} className="gk-nc">
                <div className="gk-nc1"><div><h3>{n.name}</h3><span className="s num">{n.sum}</span></div>
                  <button type="button" className="gk-btn" aria-pressed={named === n.id} onClick={() => { setNamed(named === n.id ? "" : n.id); setZoom("town"); }}>{named === n.id ? "Outlined" : "Outline on map"}</button></div>
                <div className="gk-nrows">{n.rows.map((r) => <div key={r.k} className={r.ok ? "gk-nr is-ok" : "gk-nr is-no"}><span className="l">{r.lbl}</span><span className="a num"><b>{r.val}</b> · rule: {r.ask}</span><span className="gk-tag">{r.ok ? "Meets" : "Misses"}</span></div>)}</div>
              </div>
            ))}
          </div>}

          {tab === "compare" && <div className="gk-scroll">
            {!pins.length && <p className="gk-cmpempty">Open a place and press <b>Add to comparison</b>. Up to three places sit here side by side, with no total and no winner.</p>}
            {pins.length > 0 && <div>
              <div className="gk-cmph" style={cols}>
                {pinStats.map((x) => <div key={x.q.id}><span className="gk-let">{x.q.letter}</span><b>{x.q.title}</b>{x.old && <small>Saved under earlier rules</small>}<button type="button" onClick={() => setPins(pins.filter((q) => q.id !== x.q.id))}>Remove</button></div>)}
              </div>
              {CMP.map(([lbl, fn]) => <div key={lbl} className="gk-cr"><span>{lbl}</span><div style={cols}>{pinStats.map((x) => <span key={x.q.id} className="num">{fn(x.st)}</span>)}</div></div>)}
              <div className="gk-cmpbtns"><button type="button" className="gk-btn" onClick={() => setPrinting("compare")}><PrintIc />Print summary</button><button type="button" className="gk-btn" onClick={() => setPins([])}>Clear comparison</button></div>
            </div>}
          </div>}
        </aside>

        <footer className="gk-status">
          <span className="gk-m">Measured</span>
          <span className="gk-m is-un">Unconfirmed</span>
          <span className="sep" />
          <span>Nothing here is ranked or recommended</span>
          <span className="sep opt" />
          <span className="opt">Student prototype · not endorsed by the Hamlet</span>
          <button type="button" className="gk-stlink" onClick={() => setAbout("sources")}>Sources</button>
          <span className="sep" />
          <span className="r">{lp.date ? `Last radar pass used: ${fmtDay(lp.date)}, Sentinel-1. ` : ""}Checks for new passes every 12 days, June to September.</span>
        </footer>

        {about && <About T={T} focus={about} onClose={() => setAbout(false)} />}
      </div>
      {printing && <PrintSheet M={M} kind={printing} place={selP} pins={pinStats} facts={factsOf} cmp={CMP} cr={cr} on={on} scenShort={scenShort} gridTf={gridTf} />}
    </div>
  );
}

function fit(b, asp) {
  let [x, y, w, h] = b;
  const cx = x + w / 2, cy = y + h / 2;
  if (w / h > asp) h = w / asp; else w = h * asp;
  return [cx - w / 2, cy - h / 2, w, h];
}

function thumbOf(M, p) {
  const b = p.bb;
  const s = Math.max(44, b[2] - b[0] + 18, b[3] - b[1] + 18), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  const v = [cx - s * 0.9, cy - s / 2, s * 1.8, s];
  let land = "", mine = "";
  const set = new Set(p.cells);
  M.C.forEach((o) => {
    if (o.x < v[0] - 4 || o.x > v[0] + v[2] + 4 || o.y < v[1] - 4 || o.y > v[1] + v[3] + 4) return;
    if (set.has(o.i)) mine += G.sq(o); else land += G.sq(o);
  });
  return { vb: v.map((q) => q.toFixed(1)).join(" "), land, mine, edge: G.outline(M, p.cells) };
}

function Fact({ f }) {
  return (
    <div className={"gk-fact" + (f.s.show ? " has-strip" : "")}>
      <span className={f.un ? "gk-m is-un" : "gk-m"}>{f.lbl}</span><b className="num">{f.val}</b>
      <small>{f.sub}</small>
      {f.s.show && <span className="gk-strip" aria-label={`Among the listed places, from ${f.s.lo} to ${f.s.hi}`}><i style={{ left: f.s.pos + "%" }} /><em className="num">{f.s.lo}</em><em className="r num">{f.s.hi}</em></span>}
    </div>
  );
}

function Detail({ M, p, facts, zoomOn, isPin, pinDis, onBack, onZoom, onPin, onPrint, gridTf }) {
  const t = useMemo(() => thumbOf(M, p), [M, p.id]);
  const T = M.T;
  return (
    <div>
      <div className="gk-dh"><button type="button" className="gk-back" onClick={onBack}><Ic d="M15 6l-6 6 6 6" />All places</button></div>
      <div className="gk-thumb">
        <svg viewBox={t.vb} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
          <rect x="-400" y="-400" width={T.W + 800} height={T.H + 800} fill="#BCDAF2" />
          <g transform={gridTf}><path d={t.land} fill="#F6F7F4" /><path d={t.mine} fill="#274C77" /><path d={t.edge} fill="none" stroke="#13243A" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></g>
          <path d={T.hwy} fill="none" stroke="#13243A" strokeWidth="4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={T.hwy} fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span>km {p.km}</span>
      </div>
      <div className="gk-dt"><span className="gk-let" aria-hidden="true">{p.letter}</span><div><h3>Place {p.letter} · {p.title}</h3><p>{p.side}</p></div></div>
      <div className="gk-dbtns">
        <button type="button" className="gk-btn" aria-pressed={zoomOn} onClick={onZoom}><Ic><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5M11 8v6M8 11h6" /></Ic>Zoom to place</button>
        <button type="button" className="gk-btn gk-btn-pri" aria-pressed={isPin} disabled={pinDis} onClick={onPin}><Ic><rect x="3" y="5" width="7" height="14" rx="2" /><rect x="14" y="5" width="7" height="14" rx="2" /></Ic>{isPin ? "In comparison" : "Add to comparison"}</button>
        <button type="button" className="gk-btn" onClick={onPrint}><PrintIc />Print summary</button>
      </div>
      {facts.map((f) => <Fact key={f.lbl} f={f} />)}
      <p className="gk-dnote">The line under a number shows where this place sits among the places listed, from lowest to highest. Neither end is better. Every place still needs a drilled core before anything is built.</p>
    </div>
  );
}

const WEIGH = ["Inuvialuit lands and harvesting areas", "Cultural, burial and gathering places", "What families want", "Cost to build and service", "Gravel and water sources", "Knowledge held by Elders and land users"];
const FINE = "Contains information licensed under the Open Government Licence – Canada. Contains modified Copernicus Sentinel data (2021–2025). Landsat imagery courtesy of the U.S. Geological Survey. NISAR data courtesy of NASA/JPL-Caltech and ISRO, via the Alaska Satellite Facility. Storm-surge levels from Baird (2019) for the Government of the Northwest Territories, as published by Future Tuktoyaktuk. Map data © OpenStreetMap contributors.";

function About({ T, focus, onClose }) {
  const x = useRef(null);
  useEffect(() => {
    x.current?.focus();
    if (focus === "sources") document.getElementById("gk-sources")?.scrollIntoView({ block: "start" });
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="gk-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gk-dlg" role="dialog" aria-modal="true" aria-labelledby="gk-about-h">
        <button type="button" className="gk-x" onClick={onClose} aria-label="Close" ref={x}><Ic d="M6 6l12 12M18 6L6 18" /></button>
        <h2 id="gk-about-h">About the data</h2>
        <p>What the numbers can and can’t tell you. Every place still needs someone to check the ground in person.</p>
        <div className="gk-know">
          <div><h3>Measured</h3><ul>
            <li><b>Height</b> from Natural Resources Canada’s elevation model (HRDEM, built from ArcticDEM).</li>
            <li><b>Shorelines</b> from Landsat images, 1985 to 2025, about ±15 m.</li>
            <li><b>Highway, roads and lakes</b> from open map data.</li>
            <li><b>Highway boreholes</b>: 11 logs from the NWT Permafrost Database.</li>
          </ul></div>
          <div><h3>Estimated or unconfirmed</h3><ul>
            <li><b>Storm flood</b>: published surge levels (Baird 2019) laid over our height model. {T.flood?.datum_note}.</li>
            <li><b>Summer ground movement</b> from Sentinel-1 radar, against the airport pad. Our checks of it against other measurements did not agree, so it stays unconfirmed.</li>
            <li>In 2022 to 2024 the radar read only about a quarter of the land.</li>
          </ul></div>
          <div><h3>Not known</h3><ul>
            <li><b>Ice in the ground</b> between the boreholes. Only a drilled core can tell.</li>
            <li>Movement at house scale. This works for neighbourhoods only.</li>
            <li><b>NISAR</b> is checked automatically. Summer 2026 was early, provisional data and gave no usable series. Validated data began on 21 Oct 2026, so summer 2027 is the first full test. <a href="#nisar">See the researcher view</a>.</li>
          </ul></div>
        </div>
        <div className="gk-starts">
          <h3>Where the starting rules come from</h3>
          <ul>
            <li><b>Within 15 km of town</b>: residents interviewed for the Nuna Community Voices report (2025) suggested about 15 km out at most.</li>
            <li><b>Dry in a 1-in-100 storm in 2100</b>: the flood levels used in the Tuktoyaktuk coastal study. Try other years and storms.</li>
            <li>The other starting values are ours. Change any of them; nothing is fixed.</li>
          </ul>
        </div>
        <div className="gk-weigh"><h3>What this tool doesn’t weigh</h3><ul>{WEIGH.map((w) => <li key={w}>{w}</li>)}</ul></div>
        <Sources />
        <p className="gk-fine"><b>A student hackathon prototype.</b> No community consultation yet; not endorsed by the Hamlet of Tuktoyaktuk. Community knowledge belongs to the Hamlet of Tuktoyaktuk and the Inuvialuit and is not in this tool. Places are grouped along each 2 km of highway; town distance is a straight line. {FINE} Open source.</p>
      </div>
    </div>
  );
}

// ---------- printable summary (shown only when printing) ----------
function PrintSheet({ M, kind, place, pins, facts, cmp, cr, on, scenShort, gridTf }) {
  const T = M.T;
  const items = kind === "place" && place ? [{ letter: place.letter, title: place.title, side: place.side, st: place, cells: place.cells }]
    : pins.map((x) => ({ letter: x.q.letter, title: x.q.title, side: "", st: x.st, cells: x.q.cells, old: x.old }));
  if (!items.length) return null;
  const rules = G.CRIT.filter((c) => on[c.k]).map((c) => c.kind === "flood" ? `${c.name}: dry in a ${scenShort}` : `${c.name}: ${c.lead.toLowerCase()} ${G.valTxt(T, c.k, cr[c.k])}`);
  const off = G.CRIT.filter((c) => !on[c.k]).map((c) => c.name);
  let allD = ""; items.forEach((it) => it.cells.forEach((k) => { allD += G.sq(M.C[k]); }));
  const today = new Date();
  const day = `${today.getDate()} ${MONTHS[today.getMonth()]} ${today.getFullYear()}`;
  return (
    <div className="gk-print">
      <header><b>Ground Check · Tuktoyaktuk land screening</b><span>Printed {day}</span></header>
      <h1>{kind === "place" ? `Place ${items[0].letter} · ${items[0].title}` : `Places ${items.map((i) => i.letter).join(", ")} side by side`}</h1>
      <p className="gk-pr-lead">Not ranked. No place is scored or recommended. Letters follow the highway from town under the rules below.</p>
      <div className="gk-pr-top">
        <svg viewBox={`0 0 ${T.W} ${T.H}`} aria-hidden="true">
          <rect x="-400" y="-400" width={T.W + 800} height={T.H + 800} fill="#E4F0FA" />
          <g transform={gridTf}><path d={M.landD} fill="#F3F4F1" /><path d={allD} fill="#274C77" /></g>
          <path d={T.hwy} fill="none" stroke="#13243A" strokeWidth="2.5" />
          {items.map((it) => <g key={it.letter}><circle cx={it.st.bx} cy={it.st.by} r="9" fill="#fff" stroke="#13243A" strokeWidth="1.5" /><text x={it.st.bx} y={it.st.by + 3.5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#13243A">{it.letter}</text></g>)}
        </svg>
        <div>
          <h2>Rules used</h2>
          <ul>{rules.map((r) => <li key={r}>{r}</li>)}</ul>
          {off.length > 0 && <p className="gk-pr-off">Not used: {off.join(", ")}.</p>}
        </div>
      </div>
      {kind === "place" ? (
        <table><tbody>{facts(items[0].st, false).map((f) => <tr key={f.lbl}><th>{f.lbl}{f.un ? " (unconfirmed)" : ""}</th><td><b>{f.val}</b><br /><span>{f.sub}</span></td></tr>)}</tbody></table>
      ) : (
        <table><thead><tr><th />{items.map((i) => <th key={i.letter}>Place {i.letter}<br /><span>{i.title}{i.old ? " · saved under earlier rules" : ""}</span></th>)}</tr></thead>
          <tbody>{cmp.map(([lbl, fn]) => <tr key={lbl}><th>{lbl}</th>{items.map((i) => <td key={i.letter}>{fn(i.st)}</td>)}</tr>)}</tbody></table>
      )}
      <h2>What this doesn’t weigh</h2>
      <p>{WEIGH.join(" · ")}</p>
      <p className="gk-pr-fine">Every place still needs a drilled core before anything is built. Estimates are calculated from public data; actual ground conditions will vary. A student hackathon prototype (NASA Space Apps 2026); no community consultation yet; not endorsed by the Hamlet of Tuktoyaktuk. {FINE}</p>
    </div>
  );
}
