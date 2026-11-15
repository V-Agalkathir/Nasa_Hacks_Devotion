import { BarChart, Bar, XAxis, YAxis, ReferenceArea, ReferenceLine, ResponsiveContainer, Cell } from "recharts";
import { PRESETS, NEED_ROWS, needs, reasonFor } from "../lib/check.js";
import { TIER, C } from "../lib/tokens.js";
import { fmtM } from "../lib/data.js";

const LEVEL = ["Not a factor", "Some concern", "Main concern"];

export function TierBars({ n }) {
  return <span className="bars" aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className={i <= n ? "on" : ""} />)}</span>;
}

export default function CheckPanel({ selName, selCount, onPreset, need, setNeed, onRun, running, report, stale, onSave, saveNote, onShowCore }) {
  const rows = needs(report?.agg, need);
  const named = report?.named;
  const meets = report ? rows.filter((r, i) => (named ? namedPass(named, r, need) : r.glyph === "✓")).length : null;
  return (
    <section className="card check" id="check" aria-labelledby="check-h">
      <p className="eyebrow" id="check-h">Ground check</p>
      <h2 className="sel-name">{selCount ? selName : "Nothing selected"}</h2>
      <p className="muted small">{selCount ? `${selCount} square${selCount > 1 ? "s" : ""} of 240 m` : "Drag on the map or pick a place"}</p>
      <div className="try">
        <span className="muted">Try</span>
        {PRESETS.map((p) => <button key={p.key} className="chip" onClick={() => onPreset(p)}>{p.label}</button>)}
      </div>

      <div className="needs">
        <div className="needs-head">
          <h3>What do you need?</h3>
          <span className="muted">{meets == null ? "" : `Meets ${meets} of 5`}</span>
          <button className="link" onClick={() => setNeed(null)}>Reset</button>
        </div>
        {rows.map((r) => {
          const g = report ? (named ? (namedPass(named, r, need) ? "✓" : "✕") : r.glyph) : "–";
          return (
            <div className="need" key={r.key}>
              <span className={`glyph g-${g === "✓" ? "ok" : g === "◐" ? "half" : g === "✕" ? "no" : "na"}`} aria-label={g === "✓" ? "meets" : g === "◐" ? "partly meets" : g === "✕" ? "does not meet" : "not run"}>{g}</span>
              <div className="need-text">
                <label htmlFor={`need-${r.key}`}>{r.label}</label>
                <span className="muted small">{report ? r.value(named ? namedAgg(named, report.agg) : report.agg) : "Run the check to see"}</span>
              </div>
              <select id={`need-${r.key}`} value={String(need[r.key])} onChange={(e) => setNeed({ ...need, [r.key]: Number(e.target.value) })}>
                {r.options.map(([l, v]) => <option key={l} value={String(v)}>{l}</option>)}
              </select>
            </div>
          );
        })}
      </div>

      <button className="run" disabled={!selCount || running} onClick={onRun}>
        {running ? "Checking the ground…" : stale ? "Run the check again" : "Run ground check"}
      </button>
      {!selCount && <p className="muted small">Drag a box on the map, paint squares, or pick a place above.</p>}
      {stale && report && <p className="muted small">Showing the last check ({report.name}). Your selection changed: run it again.</p>}
      {report && <Report report={report} need={need} stale={stale} onSave={onSave} saveNote={saveNote} onShowCore={onShowCore} />}
    </section>
  );
}

// Named presets report the area's own Part 4 values (spec 3.3.2), so the need values match the glyphs.
function namedAgg(named, agg) {
  const i = named.indicators;
  return { ...agg, h: i.height.median_m, p10: i.height.p10_m, hw: i.access.to_highway_m, sea: i.coast.distance_to_sea_m,
    wet: i.wetness.water_share_250m, cov: i.confidence.radar_coverage };
}

function namedPass(named, r, need) {
  const i = named.indicators;
  const v = need[r.key];
  if (r.key === "minH") return i.height.median_m >= v;
  if (r.key === "maxHwy") return i.access.to_highway_m <= v;
  if (r.key === "minSea") return i.coast.distance_to_sea_m > v;
  if (r.key === "maxWet") return i.wetness.water_share_250m * 100 < v;
  if (r.key === "minCov") return i.confidence.radar_coverage * 100 >= v;
  return false;
}

function Report({ report, need, stale, onSave, saveNote, onShowCore }) {
  const { agg, tier, name, named } = report;
  const t = TIER[tier.tier];
  const reason = named ? named.reason : reasonFor(tier, agg);
  const drv = named ? Object.fromEntries(named.drivers.map((d) => [d.driver, d])) : null;
  const strip = (s) => s.replace(/^(Coast|Height|Ground):\s*/, "");
  const coastText = drv ? strip(drv.coast.text) : agg.sea <= 100 ? "Shoreline within 100 m (measured 2025 waterline)" : agg.sea <= 300 ? `Shoreline ${fmtM(agg.sea)} away` : "Not a factor here (more than 300 m inland)";
  const heightText = drv ? strip(drv.height.text) : `Middle ${agg.h?.toFixed(1)} m; ${Math.round((agg.low ?? 0) * 100)}% below the 2.5 m storm-surge reference`;
  const groundText = drv ? strip(drv.ground.text) : agg.mv == null ? "Radar can't measure most of this land" : `Moves ${Math.abs(agg.mv).toFixed(1)} cm ${agg.mv < 0 ? "more" : "less"} than the airport pad each summer (measured)`;
  return (
    <div className={`report${stale ? " stale" : ""}`}>
      <div className={`tier-tile${t.hatch ? " hatch" : ""}`} style={{ background: t.fill, color: t.text }}>
        <p className="eyebrow">Second-move risk · {name}</p>
        <p className="tier-name"><TierBars n={t.bars} /> {t.label}</p>
        <p className="reason">{reason}</p>
      </div>
      <div className="drivers">
        <Driver title="Coast" text={coastText} level={tier.coast} />
        <Driver title="Height" text={heightText} level={tier.height} />
        <Driver title="Ground" text={groundText} ground />
      </div>
      {agg.n > 250 && <p className="warn">Large selection: it mixes very different ground. Smaller areas give clearer answers.</p>}

      <h4>The squares inside</h4>
      <TierMix tiers={agg.tiers} n={agg.n} />

      <h4>How high is it? <small className="muted">Squares by height above sea, m</small></h4>
      <Histogram heights={agg.heights} minH={need.minH} />
      <p className="note">Dark bar: within storm-surge reach (2.5 m reference). Faded: below your {need.minH} m need.</p>

      <h4>Each summer</h4>
      <Summer report={report} />

      <h4>The coast</h4>
      <Coast agg={agg} named={named} />

      <h4>Where to core <small className="muted">Where a core tells the most. Not a ranking.</small></h4>
      <p className="chipline">{agg.prom || agg.conf ? `${agg.prom} promising, unconfirmed · ${agg.conf} conflicting evidence` : "No coring flags inside this selection."}
        {(agg.prom > 0 || agg.conf > 0) && <button className="link" onClick={onShowCore}>Show on the map</button>}</p>

      <button className="save" onClick={onSave}>{saveNote?.label ?? "Save to compare"}</button>
      {saveNote?.note && <p className="muted small">{saveNote.note}</p>}
    </div>
  );
}

function Driver({ title, text, level, ground }) {
  return (
    <div className="driver">
      <p className="eyebrow">{title} <span className="pill">MEASURED</span>{ground && <span className="pill pill-unconf">UNCONFIRMED</span>}</p>
      <p>{text}</p>
      {ground ? <p className="muted small">Not counted in the tier. Unconfirmed: radar patterns did not repeat between years.</p>
        : <p className="level"><TierBars n={level + 1} /> {LEVEL[level]}</p>}
    </div>
  );
}

function TierMix({ tiers, n }) {
  return (
    <>
      <div className="mix" role="img" aria-label={Object.entries(tiers).map(([k, v]) => `${TIER[k].short}: ${v}`).join(", ")}>
        {Object.entries(tiers).filter(([, v]) => v).map(([k, v]) => (
          <span key={k} className={TIER[k].hatch ? "hatch" : ""} style={{ width: `${(100 * v) / n}%`, background: TIER[k].fill }} />
        ))}
      </div>
      <p className="mix-legend small">{Object.entries(tiers).filter(([, v]) => v).map(([k, v]) => `${TIER[k].short} ${v}`).join(" · ")}</p>
    </>
  );
}

function Histogram({ heights, minH }) {
  const bins = [[0, 2.5], [2.5, 4], [4, 6], [6, 8], [8, 10], [10, 12], [12, 15], [15, 999]];
  const counts = bins.map(([a, b]) => heights.filter((h) => h >= a && h < b).length);
  const max = Math.max(1, ...counts);
  return (
    <div className="hist" role="img" aria-label={bins.map(([a, b], i) => `${a}–${b === 999 ? "+" : b} m: ${counts[i]}`).join(", ")}>
      {counts.map((c, i) => (
        <div key={i} className="hcol">
          <span className="hbar" style={{ height: `${(100 * c) / max}%`, background: i === 0 ? "#2F3A5E" : "#9A967E", opacity: bins[i][1] <= minH && i > 0 ? 0.35 : 1 }} />
          <small>{bins[i][0]}{i === bins.length - 1 ? "+" : ""}</small>
        </div>
      ))}
    </div>
  );
}

function Summer({ report }) {
  const { agg, ts } = report;
  const vals = ts ? agg.years.map((y) => ts.seasons.find((s) => s.year === y)?.total_measured ?? null) : agg.mvy;
  const rows = agg.years.map((y, i) => ({ y: String(y), v: vals[i] })).concat([{ y: "2026", v: null, na: true }]);
  const outside = vals.some((v) => v != null && Math.abs(v) > 1);
  const typical = (() => { const v = vals.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; })();
  return (
    <div className="summer">
      <p><b>{outside ? "Outside the ±1 cm band in at least one summer." : "Within about 1 cm of the airport pad every summer."}</b></p>
      {typical != null && <p className="muted small">Typical summer: {Math.abs(typical).toFixed(1)} cm {typical < 0 ? "more" : "less"} sinking than the airport pad.</p>}
      <div role="img" aria-label={rows.map((r) => `${r.y}: ${r.v == null ? (r.na ? "insufficient data" : "no data") : `${r.v} cm`}`).join(", ")}>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
            <ReferenceArea y1={-1} y2={1} fill={C.inset} fillOpacity={0.8} />
            <ReferenceLine y={0} stroke={C.muted} />
            <XAxis dataKey="y" tick={{ fill: C.muted, fontSize: 11 }} stroke={C.muted} />
            <YAxis domain={[-2.5, 2.5]} ticks={[-2, -1, 0, 1, 2]} tick={{ fill: C.muted, fontSize: 11 }} stroke={C.muted} />
            <Bar dataKey="v" isAnimationActive={false}>
              {rows.map((r) => <Cell key={r.y} fill={r.v != null && r.v < 0 ? "#B35806" : "#542788"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="legend small"><i className="sw" style={{ background: C.inset }} />±1 cm: can't tell from the airport pad · <i className="sw" style={{ background: "#B35806" }} />Median, cm (down = sank more) · 2026: insufficient data</p>
      <p className="notebox">The 2021–23 pattern did not predict 2024–25 (skill −0.24 against “no motion”), so this can't confirm the ground either way.</p>
      <p className="chipline">{agg.flagged ? `${agg.flagged} squares moved more than expected in summer 2025` : "Nothing moved more than expected in summer 2025"}</p>
    </div>
  );
}

function Coast({ agg, named }) {
  const sea = named ? named.indicators.coast.distance_to_sea_m : agg.sea;
  const chg = named ? named.indicators.coast.measured_change_m : agg.chg;
  return (
    <div className="coast">
      {sea <= 100 ? <p className="big">On the shoreline <small>The 2025 waterline touches this land</small></p>
        : <p className="big">{fmtM(sea)} <small>from the 2025 shoreline</small></p>}
      {sea > 300 ? <p>More than 300 m inland: the coast is not a factor here, so the tier reflects height and ground.</p>
        : chg == null ? <p className="muted">No measured transect near this land.</p>
          : <>
            <p>Moved {Math.abs(chg).toFixed(0)} m {chg >= 0 ? "landward" : "seaward"} between 2005–09 and 2021–25 (±15 m).{Math.abs(chg) <= 15 ? " Within the error: can't tell from no change." : ""}</p>
            <div className="whisker" role="img" aria-label={`Measured change ${chg.toFixed(0)} m, plus or minus 15 m, on an axis from −20 to +60 m`}>
              <span className="axis" />
              <span className="wbar" style={{ left: `${((Math.max(-20, chg - 15) + 20) / 80) * 100}%`, width: `${((Math.min(60, chg + 15) - Math.max(-20, chg - 15)) / 80) * 100}%` }} />
              <span className="wdot" style={{ left: `${((Math.min(60, Math.max(-20, chg)) + 20) / 80) * 100}%` }} />
              <small className="l">−20 m</small><small className="z" style={{ left: "25%" }}>0</small><small className="r">+60 m</small>
            </div>
          </>}
      <p className="notebox">Arrival years are hidden: our shoreline forecast missed by 48 m on average, worse than assuming no change (14 m).</p>
    </div>
  );
}
