// NISAR researcher view (#nisar), built to the design canvas (Nisar.dc.html).
// Data quality only: nothing here feeds the screening tool. Images share tool.json's SVG frame.
import { useEffect, useMemo, useRef, useState } from "react";
import * as G from "../lib/tool.js";
import "../tool.css";
import "../nisar.css";
import Sources from "./Sources.jsx";

const BASE = "./data/";
const get = (f) => fetch(BASE + f).then((r) => { if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json(); });
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso) => { const a = iso.split("-"); return Number(a[2]) + " " + MON[Number(a[1]) - 1]; };
const pct = (v) => (v == null ? "–" : v < 0.01 ? "under 1%" : Math.round(v * 100) + "%");
const CUT = 0.35;

const Ic = ({ d, children }) => <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">{d ? <path d={d} /> : children}</svg>;
const InfoIc = () => <Ic><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></Ic>;

function status(p) {
  if (p.conn_share === 0) return { k: "never", t: "Never unwrapped", g: "–" };
  if (!p.used) return { k: "drop", t: "Dropped", g: "✕" };
  if (p.ramp_flag || (p.coh_median ?? 0) < CUT) return { k: "weak", t: "Kept, weak", g: "◐" };
  return { k: "kept", t: "Kept", g: "✓" };
}
function why(p) {
  if (p.conn_share === 0) return "Never unwrapped: no connected components over land.";
  if (!p.used) {
    if (p.land_median_cm != null && /offset/.test(p.reason || "")) return `Dropped: land median sat ${Math.abs(p.land_median_cm).toFixed(1)} cm off after referencing (limit 2 cm).`;
    return "Dropped: " + (p.reason || "failed a check") + ".";
  }
  return "Kept: passed the coherence, unwrapping and referencing checks" + (p.ramp_flag && p.ramp_cm != null ? `, after removing a ${p.ramp_cm.toFixed(1)} cm ramp` : "") + ".";
}

export default function NisarView() {
  const [D, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    document.body.classList.add("gk-lock");
    Promise.all([get("nisar/nisar.json"), get("tool.json")]).then(([nz, T]) => setD({ nz, M: G.decode(T) })).catch((e) => setErr(String(e.message || e)));
    return () => document.body.classList.remove("gk-lock");
  }, []);
  if (err) return <div className="gk"><div className="gk-wait"><h1>The NISAR data didn’t load</h1><p>{err}</p><p><a href="#">Back to the tool</a></p></div></div>;
  if (!D) return <div className="gk"><div className="gk-wait" role="status"><p>Loading the NISAR view…</p></div></div>;
  return <Board nz={D.nz} M={D.M} />;
}

function fit(b, asp) {
  let [x, y, w, h] = b;
  const cx = x + w / 2, cy = y + h / 2;
  if (w / h > asp) h = w / asp; else w = h * asp;
  return [cx - w / 2, cy - h / 2, w, h];
}

function Board({ nz, M }) {
  const T = M.T, P = nz.pairs, S1 = nz.s1 || {}, S1P = S1.pairs_2025 || [];
  const best = useMemo(() => { let b = 0; P.forEach((p, i) => { if (p.used && (p.mv_valid_share || 0) > (P[b].mv_valid_share || 0)) b = i; }); return b; }, [nz]);
  const [view, setView] = useState("mv");
  const [pi, setPi] = useState(best);
  const [zoom, setZoom] = useState("region");
  const [tab, setTab] = useState("pair");
  const [m, setM] = useState("pairs");
  const [about, setAbout] = useState(false);
  const [asp, setAsp] = useState(0.8);
  const [aspS, setAspS] = useState(0.5);
  const box = useRef(null);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); if (r.width && r.height) { setAsp(r.width / r.height); setAspS(window.innerWidth <= 760 ? r.width / (r.height / 2) : r.width / 2 / r.height); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const p = P[pi], st = status(p);
  const town = zoom === "town";
  const W = nz.frame?.svg_w || T.W, H = nz.frame?.svg_h || T.H;
  const tc = T.named?.town_core?.c || [W / 2, 60];
  // leave the bottom of the map for the pass-by-pass timeline
  const regionBox = [-10, -10, W + 20, (H + 20) / 0.7];
  const townBox = [tc[0] - 75, tc[1] - 40, 150, 210 / 0.7];
  const vb = fit(town ? townBox : regionBox, asp);
  const vbS = fit(town ? townBox : regionBox, aspS);
  const z = vb[2] / (W + 20);
  const img = view === "mv" ? p.mv_img : view === "iono" ? p.iono_img : p.coh_img;
  const pairWord = short(p.ref) + "→" + short(p.sec);
  const noImg = view !== "cmp" && !img;
  const gridTf = `matrix(${T.grid.join(" ")})`;
  const gap = nz.instrument_gap || { from: "2026-07-27", to: "2026-08-10" };
  const spansGap = p.ref < gap.from && p.sec > gap.to;
  const ionoJump = p.iono_p95_cm != null && p.iono_p95_cm > 30;
  const lim = nz.scale || { pair_cm: 3, iono_cm: 15 };

  // timeline: 10 Jun – 12 Nov 2026
  const T0 = Date.UTC(2026, 5, 10), T1 = Date.UTC(2026, 10, 12), L = 30, R = 970;
  const X = (iso) => { const a = iso.split("-").map(Number); return L + ((Date.UTC(a[0], a[1] - 1, a[2]) - T0) / (T1 - T0)) * (R - L); };
  const AX = 96, BASE_Y = 206, BH = 34;
  const arcs = P.map((q, i) => {
    const a = X(q.ref), b = X(q.sec), k = status(q).k, on = i === pi, c = q.coh_median ?? 0;
    const h = 10 + (b - a) * 0.2, dull = k === "drop" || k === "never";
    return { i, d: `M${a.toFixed(1)} ${AX} Q${((a + b) / 2).toFixed(1)} ${(AX - h * 2).toFixed(1)} ${b.toFixed(1)} ${AX}`,
      stroke: dull ? "#8B8C89" : "#274C77", sw: on ? 5 : 2.6, dash: k === "drop" ? "2 5" : k === "never" ? "1 7" : k === "weak" ? "7 5" : undefined,
      bx: a + 3, bw: Math.max(4, b - a - 6), by: BASE_Y - c * BH, bh: c * BH, bfill: dull ? "url(#nzH)" : "#274C77", bop: on ? 1 : 0.55, bst: on ? "#13243A" : "none",
      tx: (a + b) / 2, ty: BASE_Y - c * BH - 4, t: c.toFixed(2), label: `${short(q.ref)} to ${short(q.sec)}, ${status(q).t}, coherence ${c.toFixed(2)}` };
  });
  const acq = Array.from(new Set(P.flatMap((q) => [q.ref, q.sec]))).sort().map((d) => ({ d, x: X(d), t: short(d) }));
  const g1 = X(gap.from), g2 = X(gap.to);
  const marks = [[X("2026-06-17"), "Provisional", "from 17 Jun", 0], [X("2026-10-21"), "Validated", "from 21 Oct", 0], [X("2026-11-06"), "Released", "6 Nov", 1]]
    .map(([x, t, sub, r]) => ({ x, tx: r ? x - 4 : x + 4, anc: r ? "end" : "start", t, sub, ty: r ? 54 : 18, sy: r ? 72 : 36 }));

  const facts = [
    { k: "Median coherence", v: p.coh_median?.toFixed(2) ?? "–", s: `Over land. Pixels under ${CUT} are dropped from movement.` },
    { k: "Connected land", v: pct(p.conn_share), s: "Share of land in a connected component after unwrapping." },
    { k: "Ionosphere correction", v: p.iono_p95_cm == null ? "–" : p.iono_p95_cm.toFixed(1) + " cm", s: "95th percentile of the phase screen removed, as line-of-sight cm around its median." },
    { k: "Area with movement", v: p.mv_img ? pct(p.mv_valid_share) : "Not shown", s: p.mv_img ? "Share of land with a kept movement value." : "Dropped pairs carry no movement." },
    { k: "Within ±1 cm", v: p.mv_img ? pct(p.mv_in_noise) : "–", s: "Share of mapped movement inside the noise." },
    { k: "Median movement", v: p.median_cm == null ? "–" : (p.median_cm > 0 ? "+" : "") + p.median_cm.toFixed(2) + " cm",
      s: "Referenced to " + (p.reference === "airport" ? "the airport gravel pad" : p.reference === "s1_stable_patches" ? "Sentinel-1 stable patches" : "nothing usable") + "." },
  ];

  const cx = (v) => (v * 100).toFixed(2) + "%";
  const rng = (a) => { const v = a.map((q) => q.coh_median).filter((x) => x != null); return v.length ? Math.min(...v).toFixed(2) + "–" + Math.max(...v).toFixed(2) : "–"; };
  const tb = nz.test_b || {};
  const legend = view === "mv"
    ? { title: "Movement, " + pairWord, ramp: "linear-gradient(90deg, #E66101, #FFFFFF 33%, #FFFFFF 67%, #2166AC)", lo: `Sank ${lim.pair_cm} cm`, mid: "±1 noise", hi: `Rose ${lim.pair_cm} cm`, note: "Vertical, against this pair’s own reference. ±1 cm is within the noise." }
    : view === "iono"
    ? { title: "Ionosphere, " + pairWord, ramp: "linear-gradient(90deg, #E66101, #FFFFFF, #2166AC)", lo: `−${lim.iono_cm} cm`, mid: "0", hi: `+${lim.iono_cm} cm`, note: "Phase screen removed by the correction, line-of-sight cm around its median." }
    : { title: view === "cmp" ? "Coherence, both sensors" : "Coherence, " + pairWord, ramp: "linear-gradient(90deg, #E9D8A6, #274C77)", lo: "0", mid: "", hi: "1", note: view === "cmp" ? `Same scale on both maps. Sentinel-1: ${S1.pair ? S1.pair.split("→").map(short).join("–") + " 2025" : "2025"}.` : `How much signal survived the ${p.days} days. Under ${CUT} is dropped.` };
  const kms = T.kms.filter((k) => k[2] > 0 && (town ? k[2] % 2 === 0 : k[2] % 4 === 0));
  const fs = 9 * Math.min(z, 1.2), fsS = 7.5 * Math.min(z, 1.2);
  const kept = P.filter((q) => q.used).length;
  const dropped = P.filter((q) => !q.used);
  const th = nz.acquisition?.thresholds || {};
  const checks = nz.season?.checks || [];
  const CHK = { tundra_sinks: "Tundra sinks over the summer", reference_near_zero: "Reference area stays near zero", lakes_masked: "Lakes masked", no_cycle_jumps: "No phase-cycle jumps" };
  const tdd = nz.season?.tdd_before_first_date;

  const MapBase = ({ children, v, aria }) => (
    <svg className="gk-map" viewBox={v.map((q) => q.toFixed(1)).join(" ")} role="img" aria-label={aria} style={{ cursor: "default" }}>
      <rect x="-600" y="-600" width={W + 1200} height={H + 1800} fill="#BCDAF2" />
      <g transform={gridTf}><path d={M.landD} fill="#F6F7F4" /></g>
      {children}
      <path d={T.hwy} fill="none" stroke="#13243A" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <path d={T.hwy} fill="none" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );

  return (
    <div className="gk">
      <div className="gk-app">
        <header className="gk-bar">
          <div className="gk-brand">
            <svg width="30" height="30" viewBox="0 0 34 34" aria-hidden="true"><rect x="1" y="1" width="32" height="32" rx="9" fill="#FFFFFF" /><path d="M7 23c4-1 6-5 10-5s6 3 10 2" fill="none" stroke="#274C77" strokeWidth="2.4" strokeLinecap="round" /><path d="M7 16.5c4-1 5-6 10-6s6 3 10 2" fill="none" stroke="#6096BA" strokeWidth="2.4" strokeLinecap="round" /><path d="M7 27.5h20" stroke="#13243A" strokeWidth="2.4" strokeLinecap="round" /></svg>
            <b>Ground Check</b>
          </div>
          <span className="div" />
          <span className="ctx">For researchers: NISAR data quality — not ground risk</span>
          <div className="gk-sum"><span className="num"><b>{kept} of {P.length}</b> <span className="t">pairs kept</span></span><span className="l">Not ground risk</span></div>
          <a className="gk-barbtn" href="#"><Ic d="M19 12H5M11 6l-6 6 6 6" /><span>Back to the tool</span></a>
          <button type="button" className="gk-barbtn" onClick={() => setAbout(true)}><InfoIc /><span>About the data</span></button>
        </header>

        <aside className={"gk-left" + (m === "pairs" ? " m-on" : "")} aria-label="Pairs">
          <div className="gk-ph"><div><h2>Summer 2026 pairs</h2><small className="num">Track {nz.acquisition?.track ?? 159} · frame {nz.acquisition?.frame ?? 53} · 12-day repeat</small></div></div>
          <div className="gk-note"><InfoIc /><span>Provisional data. Validated NISAR products start on 21 Oct 2026.</span></div>
          <div className="gk-scroll">
            <div className="gk-cols" style={{ gridTemplateColumns: "44px minmax(0,1fr) 54px" }}><span /><span>Pair · why</span><span style={{ textAlign: "right" }}>Coh.</span></div>
            {P.map((q, i) => {
              const k = status(q), dull = k.k === "drop" || k.k === "never";
              return (
                <button key={q.ref} type="button" className={i === pi ? "nz-row is-on" : "nz-row"} aria-pressed={i === pi} onClick={() => { setPi(i); setTab("pair"); }}>
                  <span className={"nz-st " + k.k}>{k.g}</span>
                  <span className="gk-rt"><b>{short(q.ref)} → {short(q.sec)}{q.days !== 12 ? ` · ${q.days} days` : ""}</b><span>{k.t}{q.mv_img ? ` · ${pct(q.mv_in_noise)} within ±1 cm` : ""}</span>
                    <span className="nz-cohbar" aria-hidden="true"><i style={{ width: Math.round((q.coh_median ?? 0) * 100) + "%", background: dull ? "#8B8C89" : "#274C77" }} /><em /></span></span>
                  <span className="gk-rn num">{q.coh_median?.toFixed(2) ?? "–"}</span>
                </button>
              );
            })}
            <p className="gk-dnote">Coherence is the median over land. The dashed tick on each bar is the {CUT} cut-off: pixels below it are dropped. Movement is mapped only for the {kept} kept pairs.</p>
          </div>
        </aside>

        <div className="gk-mapw" ref={box}>
          {view !== "cmp" && (
            <MapBase v={vb} aria={legend.title + " over Tuktoyaktuk and the highway. The Pairs list on the left selects the same pairs by keyboard."}>
              {img && <image href={BASE + "nisar/" + img} x="0" y="0" width={W} height={H} preserveAspectRatio="none" />}
              <path d={T.roads} fill="none" stroke="#8B8C89" strokeWidth="0.8" opacity=".75" vectorEffect="non-scaling-stroke" />
              <path d={T.airport} fill="#FFFFFF" fillOpacity=".6" stroke="#46566A" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
              <g fontFamily="Atkinson Hyperlegible Next, Verdana, sans-serif" fontWeight="700" stroke="#FFFFFF" strokeWidth={2.2 * Math.min(z, 1.2)} paintOrder="stroke" strokeLinejoin="round">
                {kms.map((k) => <g key={k[2]}><circle cx={k[0]} cy={k[1]} r={1.8 * Math.max(Math.min(z, 1.2), 0.4)} fill="#13243A" /><text x={k[0] + 5 * z + 1} y={k[1] + 2.6 * z} fontSize={fsS} fill="#13243A">km {k[2]}</text></g>)}
                {!town && <text x={tc[0] - 150} y={tc[1] + 90} fontSize={fs} fontStyle="italic" fontWeight="400" fill="#274C77">Beaufort Sea</text>}
                <text x={tc[0] + 10} y={tc[1] + 3} fontSize={fs} fill="#13243A">Tuktoyaktuk</text>
              </g>
            </MapBase>
          )}
          {view === "cmp" && (
            <div className="nz-split">
              <div><MapBase v={vbS} aria="NISAR coherence for the selected pair">{p.coh_img && <image href={BASE + "nisar/" + p.coh_img} x="0" y="0" width={W} height={H} preserveAspectRatio="none" />}</MapBase><span className="lbl">NISAR · {pairWord} 2026 · {p.coh_median?.toFixed(2)}</span></div>
              <div><MapBase v={vbS} aria="Sentinel-1 coherence for a 12-day pair in July 2025">{S1.img && <image href={BASE + "nisar/" + S1.img} x="0" y="0" width={W} height={H} preserveAspectRatio="none" />}</MapBase><span className="lbl">Sentinel-1 · {S1.pair ? S1.pair.split("→").map(short).join("–") : ""} 2025 · {S1.coh_median?.toFixed(2)}</span></div>
            </div>
          )}

          <div className="gk-ov gk-tools nz-tools2">
            <div className="gk-seg" role="group" aria-label="Map layer">
              {[["mv", "Movement"], ["coh", "Coherence"], ["iono", "Ionosphere"], ["cmp", "vs Sentinel-1"]].map(([k, t]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{t}</button>)}
            </div>
          </div>
          <div className="gk-ov nz-zoomov"><div className="gk-seg nz-zoom" role="group" aria-label="Zoom">
            <button type="button" aria-pressed={!town} onClick={() => setZoom("region")}>Whole area</button>
            <button type="button" aria-pressed={town} onClick={() => setZoom("town")}>Town</button>
          </div></div>
          <div className="gk-ov gk-legend nz-legend">
            <b style={{ color: "#13243A", fontSize: 13 }}>{legend.title}</b>
            <span className="nz-ramp" style={{ background: legend.ramp }} />
            <span className="nz-rampl"><span>{legend.lo}</span><span>{legend.mid}</span><span>{legend.hi}</span></span>
            <span style={{ display: "block", lineHeight: 1.4 }}>{legend.note}</span>
            <span><i style={{ background: "#F6F7F4", boxShadow: "inset 0 0 0 1.5px #B6C1CB" }} />No value: masked or incoherent</span>
            <span><i style={{ background: "#BCDAF2", boxShadow: "inset 0 0 0 1.5px #B6C1CB" }} />Water</span>
          </div>
          {noImg && <div className="gk-ov nz-mapmsg"><b>{view === "mv" ? "No movement map for " + pairWord : "No image for " + pairWord}</b>{view === "mv" ? why(p).replace(/\.$/, "") + `. Movement is shown only for the ${kept} kept pairs; its coherence and ionosphere are still here.` : "This layer was not exported for this pair."}</div>}

          <div className="gk-ov nz-tl">
            <div className="nz-tlh"><b>Pass by pass</b><span>Tap an arc to map that pair. Bars: median coherence over land.</span></div>
            <svg viewBox="0 0 1000 214" role="img" aria-label={`Timeline of the ${P.length} NISAR pairs in summer 2026, with the instrument gap from ${short(gap.from)} to ${short(gap.to)}, provisional products from 17 June and validated products from 21 October.`}>
              <defs><pattern id="nzH" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#F4F7F9" /><rect width="2.2" height="6" fill="#8B8C89" /></pattern></defs>
              <rect x={g1} y="6" width={g2 - g1} height="200" fill="#13243A" opacity=".08" />
              <text x={(g1 + g2) / 2} y="146" textAnchor="middle" className="mk">Instrument gap</text>
              <text x={(g1 + g2) / 2} y="164" textAnchor="middle" className="an">{short(gap.from)} – {short(gap.to)}</text>
              {marks.map((mk) => <g key={mk.t}><line x1={mk.x} x2={mk.x} y1="4" y2="206" stroke="#46566A" strokeWidth="1.2" strokeDasharray="2 4" /><text x={mk.tx} y={mk.ty} textAnchor={mk.anc} className="mk">{mk.t}</text><text x={mk.tx} y={mk.sy} textAnchor={mk.anc} className="an">{mk.sub}</text></g>)}
              <line x1="30" x2="970" y1="96" y2="96" stroke="#13243A" strokeWidth="1.5" />
              <line x1="30" x2="970" y1="206" y2="206" stroke="#D3DAE0" />
              <line x1="30" x2="970" y1={BASE_Y - CUT * BH} y2={BASE_Y - CUT * BH} stroke="#13243A" strokeDasharray="4 3" opacity=".6" />
              {arcs.map((a) => (
                <g key={a.i} className="nz-arc" tabIndex={0} role="button" aria-label={a.label} onClick={() => setPi(a.i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPi(a.i); } }}>
                  <path d={a.d} fill="none" stroke={a.stroke} strokeWidth={a.sw} strokeDasharray={a.dash} strokeLinecap="round" />
                  <rect x={a.bx} y={a.by} width={a.bw} height={a.bh} rx="2.5" fill={a.bfill} opacity={a.bop} stroke={a.bst} strokeWidth="2" />
                  <text x={a.tx} y={a.ty} textAnchor="middle" className="vl">{a.t}</text>
                </g>
              ))}
              {acq.map((q) => <g key={q.d}><circle cx={q.x} cy="96" r="4.5" fill="#FFFFFF" stroke="#13243A" strokeWidth="2" /><text x={q.x} y="118" textAnchor="middle" className="tk">{q.t}</text></g>)}
            </svg>
          </div>
        </div>

        <nav className="gk-mtabs" role="tablist" aria-label="Panels">
          <button type="button" role="tab" aria-selected={m === "pairs"} onClick={() => setM("pairs")}>Pairs · {P.length}</button>
          <button type="button" role="tab" aria-selected={m === "det"} onClick={() => setM("det")}>Details</button>
        </nav>

        <aside className={"gk-right" + (m === "det" ? " m-on" : "")} aria-label="Details">
          <div className="gk-tabs" role="tablist" aria-label="Details panel">
            <button type="button" role="tab" aria-selected={tab === "pair"} onClick={() => setTab("pair")}>This pair</button>
            <button type="button" role="tab" aria-selected={tab === "coh"} onClick={() => setTab("coh")}>Coherence</button>
            <button type="button" role="tab" aria-selected={tab === "next"} onClick={() => setTab("next")}>What’s next</button>
          </div>

          {tab === "pair" && <div className="gk-scroll">
            <div className="gk-dt"><span className={"nz-st " + st.k} style={{ width: 42, height: 42, fontSize: 16 }}>{st.g}</span><div><h3>{short(p.ref)} → {short(p.sec)} 2026</h3><p>{st.t} · {p.days}-day pair</p></div></div>
            <p className="gk-dnote" style={{ paddingBottom: 12, color: "#13243A", fontSize: 13.5 }}>{why(p)}</p>
            {spansGap && <div className="nz-box" style={{ marginTop: 0, marginBottom: 12 }}>This pair spans the permanent instrument gap ({short(gap.from)}–{short(gap.to)}), which is why it is {p.days} days long and its coherence is low.</div>}
            {ionoJump && <div className="nz-iono">The ionosphere screen for this pair jumps sharply between two levels ({p.iono_p95_cm.toFixed(0)} cm at the 95th percentile, against 3–10 cm for most pairs). That looks like an unwrapping jump in the product{p.used ? ", and the movement map may carry it" : ""}.</div>}
            {facts.map((f) => <div key={f.k} className="gk-fact"><span className="gk-m">{f.k}</span><b className="num">{f.v}</b><small>{f.s}</small></div>)}
            <p className="gk-dnote">Movement is vertical, ionosphere-corrected and referenced on its own within each pair. ±1 cm is within the noise. Nothing here is used in the ground screen.</p>
          </div>}

          {tab === "coh" && <div className="gk-scroll">
            <div className="nz-sec">
              <h3>Coherence, as measured</h3>
              <p>Median over land for every 12-day summer pair. Same land mask, same map frame.</p>
              <div className="nz-strip" role="img" aria-label={`Median coherence: NISAR 2026 ${rng(P)}, Sentinel-1 2025 ${rng(S1P)}`}>
                <span className="rw" style={{ top: 14 }}>{P.map((q, i) => <span key={q.ref} className={i === pi ? "nz-dot on" : "nz-dot n"} style={{ left: cx(q.coh_median ?? 0) }} title={`${short(q.ref)}→${short(q.sec)}: ${q.coh_median?.toFixed(2)}`} />)}</span>
                <span className="rw" style={{ top: 34 }}>{S1P.map((q) => <span key={q.ref} className="nz-dot s" style={{ left: cx(q.coh_median) }} title={`${short(q.ref)}→${short(q.sec)} 2025: ${q.coh_median.toFixed(2)}`} />)}</span>
                <span className="ax" />
                <span className="th" style={{ left: "35%" }} />
                <span className="tl" style={{ left: 0, transform: "none" }}>0</span><span className="tl" style={{ left: "35%" }}>{CUT} cut-off</span><span className="tl" style={{ left: "100%", transform: "translateX(-100%)" }}>1</span>
              </div>
              <div className="nz-key"><span><span className="nz-dot n" />NISAR 2026 · {rng(P)}</span><span><span className="nz-dot s" />Sentinel-1 2025 · {rng(S1P)}</span><span><span className="nz-dot on" style={{ boxShadow: "none" }} />Selected pair</span></div>
            </div>
            <div className="nz-box">This is one provisional summer of 12-day pairs. L-band’s documented strengths are coherence over long intervals and through taller vegetation (<b>NISAR Science Users’ Handbook, JPL 2018</b>). These pairs don’t test either, so they say nothing yet about how NISAR will do here.</div>
            <div className="nz-sec" style={{ borderTop: "1px solid #D3DAE0", marginTop: 14 }}>
              <span><span className="nz-fail">{tb.status === "fail" ? "✕ Test B failed" : "Test B: " + (tb.status || "not run")}</span></span>
              <h3>Does NISAR order the ground like Sentinel-1?</h3>
              {tb.rho_block != null && <span><span className="nz-big num">ρ {tb.rho_block.toFixed(3)}</span> <span style={{ fontSize: 13, color: "#46566A" }}>block, 95% CI {(tb.rho_block_ci95 || []).map((v) => v.toFixed(2)).join(" to ")} · {tb.n_blocks?.toLocaleString("en-GB")} blocks</span></span>}
              <p>Pixel ρ {tb.rho_pixel?.toFixed(2)} · sign agreement with Sentinel-1 2025, r = {tb.cross_sensor_sign_r_vs_s1_2025?.toFixed(3)}. Class agreement (κ) needs five dates on one connected chain, and 2026 has none. Pre-registered at tag {tb.prereg_tag || "prereg-eval"}.</p>
            </div>
          </div>}

          {tab === "next" && <div className="gk-scroll">
            <div className="gk-lh"><h3 className="gd" style={{ fontSize: 18, fontWeight: 600 }}>Here’s what changes as data builds up</h3><small>Dates from the <a href={nz.outlook_source} target="_blank" rel="noreferrer">ASF NISAR availability overview</a>.</small></div>
            <div className="nz-out"><span className="w">21 Oct 2026</span><b>Validated products start</b><p>Released 6 Nov 2026. Everything on this page is the provisional stream.</p></div>
            <div className="nz-out"><span className="w">2027</span><b>2026 is reprocessed</b><p>The two referencing drops and the unwrapping failure may change.</p></div>
            <div className="nz-out"><span className="w">Summer 2027</span><b>First validated thaw season</b><p>With five or more dates on one connected chain, Test B can be rerun as pre-registered, including class agreement. The tool checks for new passes automatically.</p></div>
            <div className="nz-out"><span className="w">Stays</span><b>The {short(gap.from)}–{short(gap.to)} gap</b><p>The instrument gap is permanent, so the 24-day pair across it can’t be repaired.</p></div>
            <div className="nz-sec">
              <h3>Stack checks</h3>
              <div>{checks.map((c) => <div key={c.name} className="nz-chk"><i className={c.pass ? "ok" : "no"}>{c.pass ? "✓" : "✕"}</i>{CHK[c.name] || c.name}</div>)}</div>
              <p>{tdd ? `Thaw began before the first usable date (${Math.round(tdd)} thawing degree-days earlier), so early-season sinking is missed. ` : ""}There is no season total: the chain breaks.</p>
            </div>
          </div>}
        </aside>

        <footer className="gk-status">
          <span className="gk-m">Measured</span>
          <span className="sep" />
          <span>Data quality, not ground risk</span>
          <span className="sep opt" />
          <span className="opt">Provisional NISAR products · instrument gap {short(gap.from)}–{short(gap.to)} 2026</span>
          <span className="r">NISAR via ASF DAAC · Sentinel-1 for comparison</span>
        </footer>

        {about && <About onClose={() => setAbout(false)} dropped={dropped} th={th} />}
      </div>
    </div>
  );
}

function About({ onClose, dropped, th }) {
  const x = useRef(null);
  useEffect(() => {
    x.current?.focus();
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="gk-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gk-dlg" role="dialog" aria-modal="true" aria-labelledby="nz-about-h">
        <button type="button" className="gk-x" onClick={onClose} aria-label="Close" ref={x}><Ic d="M6 6l12 12M18 6L6 18" /></button>
        <h2 id="nz-about-h">About the NISAR data</h2>
        <p>A data-quality view for researchers. It doesn’t change any place in the tool, and it isn’t a judgement of the ground.</p>
        <div className="gk-know">
          <div><h3>What we used</h3><ul><li><b>NISAR L-band</b> GUNW interferograms, 80 m, HH, track 159 frame 53, descending, 12-day pairs.</li><li><b>Ionosphere</b> phase screen removed; main connected component only; ramps removed.</li><li><b>Reference:</b> airport gravel pad, or Sentinel-1 stable patches.</li></ul></div>
          <div><h3>What we dropped</h3><ul>{dropped.map((p) => <li key={p.ref}><b>{short(p.ref)}→{short(p.sec)}</b>: {why(p).replace(/^(Dropped|Never unwrapped): ?/, "")}</li>)}</ul></div>
          <div><h3>What this isn’t</h3><ul><li>Not ground risk, and not used in any rule.</li><li>Not a season total: the chain breaks.</li><li>Not a verdict on NISAR: one provisional summer.</li></ul></div>
        </div>
        <dl className="nz-dl">
          <dt>Product status</dt><dd>Provisional from 17 Jun 2026 (to be reprocessed in 2027); validated from 21 Oct 2026, released 6 Nov 2026</dd>
          <dt>Thresholds</dt><dd>Coherence ≥ {th.coherence_min ?? CUT} · land median within 2 cm after referencing{th.closure_cm ? ` · closure ${th.closure_cm} cm` : ""}</dd>
          <dt>Comparison</dt><dd>Sentinel-1 C-band, relative orbit 137, 2025 12-day pairs, same map frame and land mask</dd>
        </dl>
        <Sources />
        <p className="gk-fine">NISAR data courtesy of NASA/JPL-Caltech and ISRO, via the Alaska Satellite Facility DAAC. Contains modified Copernicus Sentinel data, processed with ASF HyP3. Map data © OpenStreetMap contributors. <b>Student prototype</b>, not endorsed by the Hamlet of Tuktoyaktuk.</p>
      </div>
    </div>
  );
}
