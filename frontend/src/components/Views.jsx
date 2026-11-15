import { useMemo } from "react";
import { CLASS, TIER, fmtM, passes } from "../lib/data.js";
import { Pill, StatusPill, TierBadge } from "./Pill.jsx";
import { SummerChart, namedArea } from "./AreaPanel.jsx";

const NAMED = ["the_point", "town_core", "reindeer_point"];

/* ---------------- Ground map: year slider + legend ---------------- */
export function GroundControls({ data, overlay, setOverlay, yearIdx, setYearIdx }) {
  const years = data.manifest.years;
  const y = years[yearIdx];
  const mode = overlay?.startsWith("rasters/motion") ? "motion" : overlay === "rasters/behaviour.png" ? "behaviour" : overlay === "rasters/lowlying.png" ? "low" : "tiers";
  const pick = (m) => {
    if (m === "tiers") setOverlay(null);
    else if (m === "behaviour") setOverlay("rasters/behaviour.png");
    else if (m === "low") setOverlay("rasters/lowlying.png");
    else setOverlay(y.image);
  };
  return (
    <section className="card">
      <div className="seg" role="radiogroup" aria-label="Map layer">
        {[["tiers", "Risk tiers"], ["behaviour", "Ground (radar)"], ["motion", "Each summer"], ["low", "Low-lying"]].map(([k, l]) => (
          <button key={k} role="radio" aria-checked={mode === k} className={mode === k ? "on" : ""} onClick={() => pick(k)}>{l}</button>
        ))}
      </div>
      {mode === "tiers" && <TierLegend />}
      {mode === "behaviour" && (
        <>
          <ClassLegend />
          <p className="small warn">Unconfirmed: these patterns did not repeat between years (Test A failed). Use only alongside a core.</p>
        </>
      )}
      {mode === "low" && <p className="small"><i className="sw" style={{ background: "#56B4E9" }} /> Ground below the 2.5 m storm-surge reference level.</p>}
      {mode === "motion" && (
        <div>
          <h4>{y.label}</h4>
          <input type="range" min={0} max={years.length - 1} value={yearIdx} aria-label="Summer"
            onChange={(e) => { const i = Number(e.target.value); setYearIdx(i); setOverlay(years[i].image); }} />
          <div className="ticks">{years.map((x) => <span key={x.year} className={x.status !== "measured" ? "miss" : ""}>{x.year}</span>)}</div>
          {y.status === "measured" ? (
            <>
              <div className="legend-bar div" />
              <div className="legend-labels"><span>sank 2 cm more</span><span>same as airport pad</span><span>2 cm less</span></div>
              <p className="small muted">{y.sensor} ({y.band}-band) · {y.window[0]} to {y.window[1]} · {Math.round(y.valid_share * 100)}% of land measured{y.note ? ` · ${y.note}` : ""}</p>
            </>
          ) : (
            <p className="empty">{y.note}</p>
          )}
        </div>
      )}
    </section>
  );
}

export function TierLegend() {
  return (
    <div className="legend-list">
      {Object.entries(TIER).map(([k, t]) => (
        <span key={k}><i className={`sw ${k === "not_enough_data" ? "hatch" : ""}`} style={{ background: t.color }} />{t.label}</span>
      ))}
      <p className="small muted">Second-move risk for a home built here. Each square is 240 m. Tiers come from coast distance and height; ground condition is not confirmed by radar.</p>
    </div>
  );
}

export function ClassLegend() {
  return (
    <ul className="legend-classes">
      {Object.entries(CLASS).map(([k, c]) => (
        <li key={k}><i className={`sw ${k === "cant_measure" ? "hatch" : ""}`} style={{ background: c.color }} /><b>{c.label}:</b> {c.desc}</li>
      ))}
    </ul>
  );
}

/* ---------------- Compare areas ---------------- */
export function CompareView({ data, onSelect, filter, setFilter }) {
  const areas = NAMED.map((id) => namedArea(data, id)).filter(Boolean);
  const n = useMemo(() => data.cells.filter((c) => passes(c, filter)).length, [data.cells, filter]);
  const row = (label, fn) => (
    <tr><th scope="row">{label}</th>{areas.map((a) => <td key={a.id}>{fn(a)}</td>)}</tr>
  );
  const ind = (a) => a.indicators;
  return (
    <>
      <section className="card">
        <h3>Compare the three named areas</h3>
        <div className="table-wrap">
          <table className="compare">
            <thead><tr><th />{areas.map((a) => (
              <th key={a.id} scope="col"><button className="link" onClick={() => onSelect(a.id)}>{a.name}</button><TierBadge tier={a.tier} /></th>
            ))}</tr></thead>
            <tbody>
              {row("Why", (a) => <span className="small">{a.reason.split(".")[0]}.</span>)}
              {row("Coast", (a) => <>{ind(a).coast.distance_to_sea_m <= 100 ? "On the shoreline" : fmtM(ind(a).coast.distance_to_sea_m)}{ind(a).coast.measured_change_m != null && <span className="small"> · moved {ind(a).coast.measured_change_m > 0 ? "+" : ""}{ind(a).coast.measured_change_m} m since 2005–09 (±15 m)</span>}</>)}
              {row("Height", (a) => <>{ind(a).height.median_m} m <span className="small">· {Math.round(ind(a).height.share_below_surge * 100)}% below 2.5 m</span></>)}
              {row("Ground (radar)", (a) => { const v = ind(a).ground.summer_move_vs_airport_cm; return <>{CLASS[ind(a).ground.dominant]?.label} <span className="small">· {v == null ? "—" : `${Math.abs(v).toFixed(1)} cm ${v < 0 ? "more" : "less"} sinking than the airport pad`}</span> <Pill kind="untested" /></>; })}
              {row("Getting worse", () => <span className="small muted">Not shown: five summers can't separate a trend from noise</span>)}
              {row("This summer (2025)", (a) => ind(a).this_season.flag ? "Moving more than the rest of the area" : "No flag")}
              {row("Wetness", (a) => `${Math.round(ind(a).wetness.water_share_250m * 100)}% water within 250 m`)}
              {row("To highway", (a) => fmtM(ind(a).access.to_highway_m))}
              {row("To town core", (a) => fmtM(ind(a).access.to_town_core_m))}
              {row("Confidence", (a) => <>{ind(a).confidence.ground_confidence} <span className="small">(radar sees {Math.round(ind(a).confidence.radar_coverage * 100)}%)</span></>)}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h3>Each summer, measured vs expected</h3>
        <div className="mini-charts">
          {areas.map((a) => <div key={a.id}><h4>{a.name}</h4><SummerChart data={data} id={a.id} compact /></div>)}
        </div>
        <p className="small muted">cm compared with the airport pad. Dashed line: what the 2021–23 fit expected from each summer's warmth.</p>
      </section>
      <FilterCard filter={filter} setFilter={setFilter} n={n} total={data.cells.length} />
    </>
  );
}

export function FilterCard({ filter, setFilter, n, total }) {
  const set = (k, v) => setFilter({ ...filter, [k]: v });
  return (
    <section className="card filters">
      <h3>Filters for the highway squares</h3>
      <label>Minimum height above sea level: <b>{filter.minHeight} m</b>
        <input type="range" min={0} max={15} step={0.5} value={filter.minHeight} onChange={(e) => set("minHeight", Number(e.target.value))} /></label>
      <label>Maximum distance to the highway: <b>{fmtM(filter.maxHighway)}</b>
        <input type="range" min={100} max={2000} step={100} value={filter.maxHighway} onChange={(e) => set("maxHighway", Number(e.target.value))} /></label>
      <label className="check"><input type="checkbox" checked={filter.coast} onChange={(e) => set("coast", e.target.checked)} /> More than 300 m from the coast</label>
      <label className="check"><input type="checkbox" checked={filter.dry} onChange={(e) => set("dry", e.target.checked)} /> Less than 40% water nearby</label>
      <p className="big-num">{n} <small>of {total} squares pass ({(n * 0.0576).toFixed(0)} km²)</small></p>
      <p className="small muted">Squares that fail are faded on the map, not removed. The coast horizon control is off because the shoreline forecast failed its test.</p>
    </section>
  );
}

/* ---------------- Where to core ---------------- */
export function CoringView({ data, onSelect }) {
  const prom = data.cells.filter((c) => c.coring === "promising_unconfirmed").sort((a, b) => a.core - b.core);
  const conf = data.cells.filter((c) => c.coring === "conflicting_evidence");
  return (
    <>
      <section className="card">
        <h3>Where a core would tell you the most</h3>
        <p>Radar can't yet confirm ground condition here, so cores decide. This screen narrows the search to <b>{prom.length} squares ({(prom.length * 0.0576).toFixed(0)} km²)</b> that are high (at least 4 m), dry, more than 300 m from the coast and within 1 km of the highway, where radar sees nothing unusual.</p>
        <p className="small muted">It suggests where a core is most informative. It does not rank sites or replace the relocation team's judgement. The list runs from the town southward along the highway.</p>
        <div className="legend-list">
          <span><i className="sw outline" /> Promising, unconfirmed</span>
          <span><i className="sw" style={{ background: "#CC79A7" }} /> Conflicting evidence ({conf.length})</span>
        </div>
      </section>
      <section className="card">
        <h4>Nearest promising squares to town</h4>
        <ol className="core-list">
          {prom.slice(0, 12).map((c) => (
            <li key={c.id}><button className="link" onClick={() => onSelect(c.id)}>{fmtM(c.core)} from the town core</button>
              <span className="small muted"> · {c.h} m high · {fmtM(c.hw)} to highway</span></li>
          ))}
        </ol>
        <p className="small muted">When a core is taken, record its result. Each one confirms or corrects this screen.</p>
      </section>
    </>
  );
}

/* ---------------- Coastline ---------------- */
export function CoastView({ data, coastYears, setCoastYears }) {
  const v = data.validation?.cards?.find((c) => c.id === "model_c");
  const all = [1985, 1995, 2005, 2015, 2025];
  const toggle = (y) => setCoastYears(coastYears.includes(y) ? coastYears.filter((x) => x !== y) : [...coastYears, y].sort());
  const areas = NAMED.map((id) => namedArea(data, id)).filter(Boolean);
  return (
    <>
      <section className="card">
        <h3>How the shoreline has moved</h3>
        <div className="seg wrap" aria-label="Shoreline years">
          {all.map((y) => <button key={y} aria-pressed={coastYears.includes(y)} className={coastYears.includes(y) ? "on" : ""} onClick={() => toggle(y)}>{y}</button>)}
        </div>
        <p className="small muted">Satellite waterlines (Landsat 30 m, Sentinel-2 10 m). The short lines across the coast are colour-coded: orange means land lost between 2005–09 and 2021–25, blue means land gained. Each is ±15 m.</p>
      </section>
      <section className="card">
        <h4>Near each named area</h4>
        <ul className="plain">
          {areas.map((a) => (
            <li key={a.id}><b>{a.name}:</b> {a.indicators.coast.distance_to_sea_m <= 100 ? "on the shoreline" : `${fmtM(a.indicators.coast.distance_to_sea_m)} from the shore`}
              {a.indicators.coast.measured_change_m != null && `, moved ${a.indicators.coast.measured_change_m > 0 ? "+" : ""}${a.indicators.coast.measured_change_m} m since 2005–09`} <Pill kind="measured" /></li>
          ))}
        </ul>
      </section>
      <section className="card">
        <div className="area-head"><h4>Arrival years are hidden</h4><StatusPill status={v?.status ?? "fail"} /></div>
        <p className="small">{v?.sentence} {v?.headline}.</p>
        <p className="small muted">Shore protection built in 2023–25 is not modelled.</p>
      </section>
    </>
  );
}

/* ---------------- How do we know ---------------- */
export function TrustView({ data }) {
  const v = data.validation;
  if (!v) return <section className="card"><p className="empty">Test results haven't loaded. The map still works.</p></section>;
  return (
    <>
      <section className="card">
        <h3>How do we know?</h3>
        <p className="small">Every pass/fail threshold was frozen in the code before any test ran (git tag <code>{v.prereg_tag}</code>). Failed tests are shown, not hidden.</p>
      </section>
      {v.cards.map((c) => (
        <section className="card test" key={c.id}>
          <div className="area-head"><h4>{c.title}</h4><StatusPill status={c.status} /></div>
          <p>{c.sentence}</p>
          <p className="small mono">{c.headline}</p>
          <p className="small muted">Baseline: {c.baseline}</p>
          {c.posthoc && <p className="small muted">{c.posthoc.title}: {c.posthoc.headline}, {c.posthoc.status}. {c.posthoc.note}</p>}
        </section>
      ))}
      <section className="card">
        <h4>What we don't predict</h4>
        <ul className="plain">{v.what_we_dont_predict.map((x) => <li key={x}>{x}</li>)}</ul>
        <details><summary className="small">Changes from the original plan ({v.deviations?.length ?? 0})</summary>
          <ul className="small">{v.deviations?.map((d, i) => <li key={i}><b>{d.what}.</b> {d.why}.</li>)}</ul>
        </details>
      </section>
    </>
  );
}
