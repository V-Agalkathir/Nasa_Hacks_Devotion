// NISAR researcher view (#nisar): the raw 2026 L-band evidence behind Test B, pair by pair.
// Reads data/nisar/nisar.json (written by data-pipeline/src/export_nisar_web.py) plus roads and named areas for context.
// Nothing here feeds the screening tiers.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { STATUS } from "../lib/tokens.js";
import { fmtDate } from "../lib/data.js";
import "../nisar.css";

const base = "./data/";
const STYLE = {
  version: 8,
  sources: { sat: { type: "raster", tileSize: 256, attribution: "Imagery © Esri",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] } },
  layers: [{ id: "sat", type: "raster", source: "sat", paint: { "raster-saturation": -0.5, "raster-brightness-max": 0.9 } }],
};
const BLANK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const REF = { airport: "Airport gravel pad", s1_stable_patches: "Sentinel-1 stable patches" };
const VIEWS = [["pair", "Pairs"], ["cum", "Cumulative"], ["coh", "Coherence"], ["valid", "Valid share"]];
const pct = (v) => (v == null ? "–" : v > 0 && v < 0.01 ? "under 1%" : `${Math.round(v * 100)}%`);
const cm = (v) => (v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(2)} cm`);
const short = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function pairStatus(p) {
  if (!p.used) return { key: "rejected", label: "Rejected", cls: "chip-fail" };
  if (p.ramp_flag || (p.coherent_fraction ?? 1) < 0.35) return { key: "weak", label: "Used, weak", cls: "chip-partial" };
  return { key: "used", label: "Used", cls: "chip-pass" };
}

export default function NisarView() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [view, setView] = useState("pair");
  const [pairI, setPairI] = useState(null);
  const [dateI, setDateI] = useState(null);

  useEffect(() => {
    fetch(base + "nisar/nisar.json").then((r) => { if (!r.ok) throw new Error(`nisar/nisar.json: HTTP ${r.status}`); return r.json(); })
      .then((j) => {
        setD(j);
        const best = j.pairs.map((p, i) => [p.valid_share ?? -1, i]).sort((a, b) => b[0] - a[0])[0];
        setPairI(best ? best[1] : 0);
        setDateI(j.dates.length - 1);
      })
      .catch((e) => setErr(e.message));
    const prev = document.title;
    document.title = "NISAR 2026 for researchers · Ground Check";
    return () => { document.title = prev; };
  }, []);

  if (err) return <div className="loading"><p>The NISAR diagnostics didn't load. Try again in a minute.</p><p className="small">{err}</p><p><a href="#">Back to the ground check</a></p></div>;
  if (!d) return <div className="loading" role="status">Loading the NISAR diagnostics…</div>;

  const used = d.pairs.filter((p) => p.used).length;
  const weak = d.pairs.filter((p) => pairStatus(p).key === "weak").length;
  const tb = d.test_b;
  return (
    <div className="page nz">
      <div className="strip" role="status"><span className="pill">RESEARCHER VIEW</span> Raw NISAR diagnostics for summer 2026: data quality, not ground risk. Nothing on this page feeds the ground screen.</div>
      <header className="hdr">
        <div>
          <p className="brand">Ground Check <span>· NISAR for researchers</span></p>
          <p className="fresh">{d.acquisition.sensor} {d.acquisition.band}-band · track {d.acquisition.track}, frame {d.acquisition.frame} · {d.acquisition.flight_dir.toLowerCase()} · {d.acquisition.polarisation}. Exported {fmtDate(d.generated_at.slice(0, 10))}.</p>
        </div>
        <a className="nz-back" href="#">← Back to the ground check</a>
      </header>

      <section className="hero">
        <h1>NISAR 2026, pair by pair.</h1>
        <p className="lead">{d.pairs.length} interferograms from {short(d.pairs[0].ref)} to {short(d.pairs[d.pairs.length - 1].sec)}. {d.pairs.length - used} were rejected and {weak} more kept little coherence, so the summer {d.season.network?.connected ? "forms" : "never forms"} one connected series. Here is the raw evidence, unsmoothed.</p>
        <div className="tiles">
          <div className="tile"><b>{used} of {d.pairs.length}</b><span>pairs used; {d.pairs.length - used} rejected for unwrapping or reference errors</span></div>
          <div className="tile"><b>{pct(d.season.stats.valid_cell_fraction)}</b><span>of the area stays valid from {short(d.season.first_usable_date)} to {short(d.season.last_usable_date)}</span></div>
          <div className="tile"><b>ρ {tb.rho_block?.toFixed(2)}</b><span>ordering agreement with Sentinel-1 across {tb.n_blocks?.toLocaleString("en-GB")} blocks. Test B {STATUS[tb.status]?.label.toLowerCase()}</span></div>
        </div>
      </section>

      <Network d={d} pairI={pairI} onPair={(i) => { setPairI(i); setView("pair"); }} />

      <div className="cols nz-cols">
        <MapCard d={d} view={view} setView={setView} pairI={pairI} setPairI={setPairI} dateI={dateI} setDateI={setDateI} />
        <div className="nz-side">
          <Outlook d={d} />
          <CumChart d={d} dateI={dateI} onDate={(i) => { setDateI(i); setView("cum"); }} />
          <TestB tb={tb} />
          <Checks season={d.season} />
        </div>
      </div>

      <PairTable d={d} pairI={pairI} onPair={(i) => { setPairI(i); setView("pair"); }} />
      <Acquisition d={d} />

      <div className="limits"><ul>
        <li>L-band (24 cm), ionosphere corrected</li><li>Each pair referenced on its own: airport pad or Sentinel-1 stable patches</li>
        <li>One summer, no connected series</li><li>80 m grid ({d.acquisition.grid.res_deg}°), not single houses</li><li>Not used in any tier</li>
      </ul></div>
    </div>
  );
}

// ---------- pair network: acquisitions on a time axis, pairs as arcs, coherence as bars ----------
function Network({ d, pairI, onPair }) {
  const W = 1000, H = 230, pad = 40;
  const t0 = Date.parse(d.pairs[0].ref), t1 = Date.parse(d.pairs[d.pairs.length - 1].sec);
  const x = (iso) => pad + ((Date.parse(iso) - t0) / (t1 - t0)) * (W - 2 * pad);
  const axisY = 120;
  const acq = [...new Set(d.pairs.flatMap((p) => [p.ref, p.sec]))].sort();
  const wet = new Set(d.dates.filter((q) => q.wet_flag).map((q) => q.date));
  const gaps = d.season.gaps || [];
  return (
    <section className="card">
      <h2>Pair network</h2>
      <p className="muted">Each arc is one interferogram. Below the axis: the share of land that stayed coherent. Click a pair to map it. The shaded band is NISAR's permanent instrument data gap; the pair across it spans 24 days instead of 12.</p>
      <div className="nz-net">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Pair network: ${d.pairs.map((p) => `${p.ref} to ${p.sec} ${pairStatus(p).label}, coherent ${pct(p.coherent_fraction)}`).join("; ")}`}>
          {d.instrument_gap && (
            <g>
              <rect x={x(d.instrument_gap.from)} y={axisY - 100} width={x(d.instrument_gap.to) - x(d.instrument_gap.from)} height={100} fill="#E9B94955" />
              <text x={(x(d.instrument_gap.from) + x(d.instrument_gap.to)) / 2} y={axisY - 86} textAnchor="middle" className="nz-ann">NISAR data gap</text>
              <text x={(x(d.instrument_gap.from) + x(d.instrument_gap.to)) / 2} y={axisY - 74} textAnchor="middle" className="nz-ann">{short(d.instrument_gap.from)}–{short(d.instrument_gap.to)}</text>
            </g>
          )}
          {gaps.map((g) => (
            <g key={g.from}>
              <rect x={x(g.from)} y={axisY - 4} width={x(g.to) - x(g.from)} height={8} fill="#E9B94966" />
            </g>
          ))}
          <line x1={pad} x2={W - pad} y1={axisY} y2={axisY} stroke="#311E10" strokeWidth="1.5" />
          <line x1={pad} x2={W - pad} y1={axisY + 90} y2={axisY + 90} stroke="#D8CDA0" />
          <line x1={pad} x2={W - pad} y1={axisY + 90 - 0.35 * 80} y2={axisY + 90 - 0.35 * 80} stroke="#5E4733" strokeDasharray="4 3" />
          <text x={W - pad} y={axisY + 90 - 0.35 * 80 - 4} textAnchor="end" className="nz-ann">0.35 coherence threshold</text>
          {d.pairs.map((p, i) => {
            const a = x(p.ref), b = x(p.sec), st = pairStatus(p), on = i === pairI;
            const h = 26 + (b - a) * 0.28;
            const col = st.key === "rejected" ? "#7A3214" : "#1F6F7D";
            const bh = (p.coherent_fraction ?? 0) * 80;
            return (
              <g key={p.ref + p.sec} className="nz-pair" onClick={() => onPair(i)} role="button" tabIndex={0}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPair(i))}
                aria-label={`${short(p.ref)} to ${short(p.sec)}: ${st.label}`} aria-pressed={on}>
                <path d={`M${a} ${axisY} Q${(a + b) / 2} ${axisY - h * 2} ${b} ${axisY}`} fill="none" stroke={col}
                  strokeWidth={on ? 5 : 3} strokeDasharray={st.key === "rejected" ? "2 5" : st.key === "weak" ? "8 5" : undefined} strokeLinecap="round" />
                <rect x={a + 3} y={axisY + 90 - bh} width={Math.max(4, b - a - 6)} height={bh} rx="3"
                  fill={st.key === "rejected" ? "url(#nzHatch)" : col} opacity={on ? 1 : 0.7} stroke={on ? "#311E10" : "none"} strokeWidth="2" />
                <text x={(a + b) / 2} y={axisY + 86 - bh} textAnchor="middle" className="nz-val">{(p.coherent_fraction ?? 0).toFixed(2)}</text>
              </g>
            );
          })}
          {acq.map((q) => (
            <g key={q}>
              <circle cx={x(q)} cy={axisY} r="5" fill="#FFFCF0" stroke="#311E10" strokeWidth="2" />
              <text x={x(q)} y={axisY + 18} textAnchor="middle" className="nz-tick">{short(q)}</text>
              {wet.has(q) && <text x={x(q)} y={axisY + 32} textAnchor="middle" className="nz-ann">wet date</text>}
            </g>
          ))}
          <defs>
            <pattern id="nzHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#EBC6A6" /><rect width="2.5" height="6" fill="#7A3214" />
            </pattern>
          </defs>
        </svg>
      </div>
      <div className="legend">
        <span><svg width="26" height="10" aria-hidden="true"><path d="M2 5h22" stroke="#1F6F7D" strokeWidth="3" /></svg>Used</span>
        <span><svg width="26" height="10" aria-hidden="true"><path d="M2 5h22" stroke="#1F6F7D" strokeWidth="3" strokeDasharray="8 5" /></svg>Used, weak (ramp or low coherence)</span>
        <span><svg width="26" height="10" aria-hidden="true"><path d="M2 5h22" stroke="#7A3214" strokeWidth="3" strokeDasharray="2 5" strokeLinecap="round" /></svg>Rejected</span>
        <span className="pill pill-unconf">NETWORK {d.season.network?.connected ? "CONNECTED" : "NOT CONNECTED"}</span>
      </div>
    </section>
  );
}

// ---------- map ----------
function MapCard({ d, view, setView, pairI, setPairI, dateI, setDateI }) {
  const el = useRef(null);
  const map = useRef(null);
  const ready = useRef(false);
  const pair = d.pairs[pairI];
  const date = d.dates[dateI];
  const layer = (id) => d.layers.find((l) => l.id === id);
  const img = view === "pair" ? pair?.image : view === "cum" ? date?.image : layer(view)?.image;
  const url = img ? `${base}nisar/${img}` : BLANK;
  const latestUrl = useRef(url);
  latestUrl.current = url;

  useEffect(() => {
    ready.current = false;
    const [w, s, e, n] = d.bounds;
    const m = new maplibregl.Map({ container: el.current, style: STYLE, attributionControl: { compact: true },
      bounds: [[w, s], [e, n]], fitBoundsOptions: { padding: 12 }, dragRotate: false, touchPitch: false,
      cooperativeGestures: true });  // long page: Ctrl/⌘ + scroll (two fingers on phones) zooms, a plain scroll moves the page
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    let done = false;
    const init = () => {
      if (done) return;
      done = true;
      m.addSource("nz", { type: "image", url: latestUrl.current, coordinates: [[w, n], [e, n], [e, s], [w, s]] });
      m.addLayer({ id: "nz", type: "raster", source: "nz", paint: { "raster-opacity": 0.92, "raster-fade-duration": 0, "raster-resampling": "nearest" } });
      m.addSource("roads", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "roads", type: "line", source: "roads", paint: { "line-color": "#311E10", "line-width": 1.4, "line-opacity": 0.7 } });
      m.addSource("named", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "named", type: "line", source: "named", paint: { "line-color": "#FFFCF0", "line-width": 2, "line-dasharray": [3, 2] } });
      const ctx = (f, src) => fetch(base + f).then((r) => (r.ok ? r.json() : null)).then((g) => g && m.getSource(src)?.setData(g)).catch(() => {});
      ctx("roads.geojson", "roads");
      ctx("areas.geojson", "named");
      ready.current = true;
    };
    // add layers once the inline style is parsed; never wait for slow basemap tiles
    const tryInit = () => { if (m.style && m.style._loaded) init(); };
    tryInit();
    m.on("styledata", tryInit);
    m.once("load", init);
    // the lazy chunk's CSS can land after the map is created: resize whenever the box changes
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); };
  }, []);

  useEffect(() => {
    if (ready.current) map.current?.getSource("nz")?.updateImage({ url });
  }, [url]);

  const s = view === "pair" ? pair : view === "cum" ? date : null;
  return (
    <section className="card mapcard nz-map" aria-label="NISAR map">
      <div className="seg" role="group" aria-label="Map view">
        {VIEWS.map(([k, label]) => <button key={k} className={view === k ? "on" : ""} aria-pressed={view === k} onClick={() => setView(k)}>{label}</button>)}
      </div>
      <div className="map-shell"><div ref={el} className="map" role="region" aria-label={`Map of ${VIEWS.find((v) => v[0] === view)[1].toLowerCase()} over Tuktoyaktuk`} />
        {!img && view === "pair" && <div className="map-note"><b>No map for this pair</b><span>{pair?.reason ? `Rejected: ${pair.reason}.` : "Not exported."}</span></div>}
      </div>
      {view === "pair" && (
        <div className="stepbar"><div className="steps" role="group" aria-label="Pair">
          {d.pairs.map((p, i) => (
            <button key={p.ref} className={i === pairI ? "on" : ""} aria-pressed={i === pairI} onClick={() => setPairI(i)}>
              <span>{short(p.ref)}→{short(p.sec)}</span><small>{p.used ? pct(p.valid_share) + " valid" : "rejected"}</small>
            </button>
          ))}
        </div></div>
      )}
      {view === "cum" && (
        <div className="stepbar"><div className="steps" role="group" aria-label="Date">
          {d.dates.map((q, i) => (
            <button key={q.date} className={i === dateI ? "on" : ""} aria-pressed={i === dateI} onClick={() => setDateI(i)}>
              <span>{short(q.date)}</span><small>{q.wet_flag ? "wet · " : ""}{pct(q.valid_share)}</small>
            </button>
          ))}
        </div></div>
      )}
      <MapLegend view={view} d={d} />
      <p className="readout" aria-live="polite">
        {s ? <>Valid {pct(s.valid_share)} · median {cm(s.median_cm)} · 5–95%: {cm(s.p05_cm)} to {cm(s.p95_cm)}
          {view === "pair" && s.reference && <> · referenced to {REF[s.reference] ?? s.reference}</>}
          {view === "pair" && s.ramp_cm != null && <> · ramp {s.ramp_cm.toFixed(2)} cm{s.ramp_flag ? " (flagged)" : ""}</>}</>
          : view === "coh" ? <>Median coherence over land {layer("coh")?.median?.toFixed(2)}; {pct(layer("coh")?.valid_share)} of the grid has a value.</>
          : <>Share of the season's pairs that were valid at each pixel.</>}
      </p>
    </section>
  );
}

function MapLegend({ view, d }) {
  const lim = view === "pair" ? d.scale.pair_cm : d.scale.cum_cm;
  if (view === "pair" || view === "cum") return (
    <div className="legend">
      <span className="nz-ramp" style={{ background: "linear-gradient(90deg, rgb(230,97,1), #fff, rgb(33,102,172))" }} aria-hidden="true" />
      <span className="nz-ramp-l"><span>Sank {lim} cm more</span><span>0</span><span>Rose {lim} cm</span></span>
      <p className="note">{view === "pair" ? "Vertical displacement over one pair, relative to that pair's own reference (airport pad or Sentinel-1 stable patches)." : `Cumulative since ${short(d.dates[0].date)}, chained through each pair's own reference. Very few pixels survive the chain: check the valid share.`} ±1 cm is within the noise. Transparent: incoherent, water or masked.</p>
    </div>
  );
  const l = d.layers.find((x) => x.id === view);
  const rgb = view === "coh" ? "31,111,125" : "94,71,51";
  return (
    <div className="legend">
      <span className="nz-ramp" style={{ background: `linear-gradient(90deg, rgb(255,252,240), rgb(${rgb}))` }} aria-hidden="true" />
      <span className="nz-ramp-l"><span>{l.range[0]}</span><span>{l.range[1]}</span></span>
      <p className="note">{l.label}.{view === "coh" ? " Pixels under 0.35 are dropped from each pair." : ""}</p>
    </div>
  );
}

// ---------- cumulative median by date ----------
function CumChart({ d, dateI, onDate }) {
  const W = 420, H = 190, l = 46, r = 28, t = 16, b = 34;
  const pts = d.dates;
  // a rejected pair ending on an acquisition breaks the chain: the cumulative series restarts there
  const restarts = new Set(d.pairs.filter((p) => !p.used).map((p) => p.sec));
  const vals = pts.map((p) => p.median_cm ?? 0);
  const lo = Math.min(-2.5, ...vals), hi = Math.max(0.5, ...vals);
  const x = (i) => l + (i / (pts.length - 1)) * (W - l - r);
  const y = (v) => t + ((hi - v) / (hi - lo)) * (H - t - b);
  const ticks = [];
  for (let v = Math.ceil(lo); v <= Math.floor(hi); v += 1) ticks.push(v);
  return (
    <section className="card">
      <h3>Cumulative median over land</h3>
      <p className="note">Chained through each pair's own reference. Dot size: share of the area still valid. Every point here rests on under 2% of the land, so read the line as anecdotal, not as a season total. A rejected pair breaks the chain, so the line restarts at zero after it.</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="nz-chart" role="img"
        aria-label={`Cumulative median: ${pts.map((p) => `${short(p.date)} ${cm(p.median_cm)}, ${pct(p.valid_share)} valid`).join("; ")}`}>
        {ticks.map((v) => <g key={v}><line x1={l} x2={W - r} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#311E10" : "#D8CDA0"} strokeWidth={v === 0 ? 1.5 : 1} />
          <text x={l - 6} y={y(v) + 4} textAnchor="end" className="nz-tick">{v} cm</text></g>)}
        <path d={pts.map((p, i) => `${i && !restarts.has(p.date) ? "L" : "M"}${x(i)} ${y(p.median_cm ?? 0)}`).join("")} fill="none" stroke="#311E10" strokeWidth="2" />
        {pts.map((p, i) => restarts.has(p.date) && i > 0 && (
          <g key={"r" + p.date}><line x1={x(i)} x2={x(i)} y1={t} y2={H - b} stroke="#7A3214" strokeDasharray="3 3" />
            <text x={x(i) - 4} y={t + 10} textAnchor="end" className="nz-ann">chain restarts</text></g>
        ))}
        {pts.map((p, i) => (
          <g key={p.date} onClick={() => onDate(i)} className="nz-pair" role="button" tabIndex={0} aria-pressed={i === dateI}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onDate(i))} aria-label={`${short(p.date)}: ${cm(p.median_cm)}`}>
            <circle cx={x(i)} cy={y(p.median_cm ?? 0)} r={4 + Math.sqrt(p.valid_share || 0) * 30} fill={i === dateI ? "#DD6031" : "#FFFCF0"} stroke="#311E10" strokeWidth="2" />
            <text x={x(i)} y={H - 12} textAnchor="middle" className="nz-tick">{short(p.date)}</text>
          </g>
        ))}
      </svg>
    </section>
  );
}

function Outlook({ d }) {
  if (!d.outlook) return null;
  return (
    <section className="card">
      <h3>What changes as data builds up</h3>
      <p className="note">This page updates itself every 12 days as new NISAR passes arrive. These are the dates that matter for Tuk:</p>
      <ol className="nz-outlook">
        {d.outlook.map((o) => <li key={o.date}><b>{/^\d{4}-\d{2}-\d{2}$/.test(o.date) ? fmtDate(o.date) : o.date}</b> {o.text}</li>)}
      </ol>
      <p className="note">What we expect to gain: flagging land inside a candidate site that keeps sinking year after year, and watching a new site's gravel pads after construction. We expect this to improve; we can't promise it. <a href={d.outlook_source}>Source: NISAR data availability</a>.</p>
    </section>
  );
}

function TestB({ tb }) {
  const st = STATUS[tb.status] ?? STATUS.pending;
  return (
    <section className="card">
      <span className={st.cls}>{st.label}</span>
      <h3 style={{ marginTop: 8 }}>Test B: does NISAR order the ground like Sentinel-1?</h3>
      <p className="nz-big">ρ {tb.rho_block?.toFixed(3)} <small>block, 95% CI {tb.rho_block_ci95?.map((v) => v.toFixed(2)).join(" to ")}</small></p>
      <dl className="nz-dl">
        <dt>Blocks</dt><dd>{tb.n_blocks?.toLocaleString("en-GB")}</dd>
        <dt>Pixel ρ</dt><dd>{tb.rho_pixel?.toFixed(2)}</dd>
        <dt>Sign r vs S1 2025</dt><dd>{tb.cross_sensor_sign_r_vs_s1_2025?.toFixed(3)}</dd>
        <dt>Pre-registered</dt><dd>tag {tb.prereg_tag}</dd>
      </dl>
      <p className="note">{tb.method}.</p>
      <p className="notebox">Class agreement (κ) is not available: {tb.kappa_note?.replace(/^[^;]*;\s*/, "")}</p>
    </section>
  );
}

function Checks({ season }) {
  const LBL = { tundra_sinks: "Tundra sinks over the summer", reference_near_zero: "Reference area stays near zero", lakes_masked: "Lakes masked", no_cycle_jumps: "No phase-cycle jumps" };
  return (
    <section className="card">
      <h3>Stack checks</h3>
      <ul className="nz-checks">
        {(season.checks || []).map((c) => (
          <li key={c.name}><span className={c.pass ? "chip-pass" : "chip-fail"}>{c.pass ? "✓ Pass" : "✕ Fail"}</span>
            <span>{LBL[c.name] ?? c.name}{c.value != null ? ` (${c.value})` : ""}</span></li>
        ))}
      </ul>
      <p className="note">Thaw had started before the first usable date ({short(season.first_usable_date)}; {season.tdd_before_first_date} thawing degree-days earlier), so early-season sinking is missing.</p>
    </section>
  );
}

function PairTable({ d, pairI, onPair }) {
  return (
    <section className="card">
      <h2>Every pair</h2>
      <p className="muted">All eight interferograms, including the rejected ones, with the reason.</p>
      <div className="table-wrap">
        <table className="funnel nz-table">
          <thead><tr><th>Pair</th><th>Days</th><th>Status</th><th>Coherent</th><th>Valid</th><th>Median</th><th>Ramp</th><th>Reference</th><th>Note</th><th /></tr></thead>
          <tbody>
            {d.pairs.map((p, i) => {
              const st = pairStatus(p);
              return (
                <tr key={p.ref} className={i === pairI ? "nz-on" : ""}>
                  <td>{short(p.ref)} → {short(p.sec)}</td><td>{p.days}</td>
                  <td><span className={st.cls}>{st.label}</span></td>
                  <td>{p.coherent_fraction?.toFixed(2) ?? "–"}</td><td>{p.used ? pct(p.valid_share) : "–"}</td>
                  <td>{cm(p.median_cm ?? null)}</td><td>{p.ramp_cm == null ? "–" : `${p.ramp_cm.toFixed(2)} cm${p.ramp_flag ? " ⚑" : ""}`}</td>
                  <td>{REF[p.reference] ?? "–"}</td><td className="small">{p.reason ? p.reason.replace(/^./, (c) => c.toUpperCase()) : ""}</td>
                  <td><button onClick={() => onPair(i)} disabled={!p.image}>Map</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details><summary>Granule IDs</summary>
        <ul className="nz-ids">{d.pairs.map((p) => <li key={p.granule}><code>{p.granule}</code></li>)}</ul>
      </details>
    </section>
  );
}

function Acquisition({ d }) {
  const a = d.acquisition;
  const rows = useMemo(() => [
    ["Sensor", `${a.sensor}, ${a.band}-band, λ ${(a.wavelength_m * 100).toFixed(2)} cm`],
    ["Geometry", `Track ${a.track}, frame ${a.frame}, ${a.flight_dir.toLowerCase()}, ${a.polarisation}`],
    ["Incidence", a.incidence_deg ? `${a.incidence_deg.min}–${a.incidence_deg.max}° (mean ${a.incidence_deg.mean}°)` : "–"],
    ["Product", "L2 GUNW, unwrapped, 12-day repeat"],
    ["Component", `${a.component}; ${a.sign}`],
    ["Corrections", Object.entries(a.corrections).map(([k, v]) => `${k}: ${v}`).join(" · ")],
    ["Thresholds", `coherence ≥ ${a.thresholds.coherence_min} · valid pairs ≥ ${a.thresholds.min_valid_pair_fraction} · closure ${a.thresholds.closure_cm} cm · slope flag ${a.thresholds.slope_flag_deg}° · coast flag ${a.thresholds.coast_flag_m} m`],
    ["Reference", `${a.reference.meaning} (${a.reference.n_cells} cells)${a.reference_diag_cm ? `; airport minus coherent land ${a.reference_diag_cm.airport_minus_coherent_land_median_cm} cm` : ""}`],
    ["Grid", `${a.grid.crs}, ${a.grid.res_deg}°, ${a.grid.width} × ${a.grid.height}, bbox ${a.grid.bbox.join(", ")}`],
    ["Season", `${fmtDate(d.season.first_usable_date)} to ${fmtDate(d.season.last_usable_date)}; network ${d.season.network?.connected ? "connected" : "not connected"}`],
    ["Code", `${d.code_version} · export ${d.schema}`],
  ], [d]);
  return (
    <section className="card">
      <h2>Acquisition and processing</h2>
      <dl className="nz-dl nz-meta">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
      <p className="note">Data: NISAR via the Alaska Satellite Facility DAAC. Contains modified Copernicus Sentinel data for the comparison. Imagery © Esri.</p>
    </section>
  );
}
