import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid, Legend as RLegend } from "recharts";
import { TIER, CLASS, fmtM } from "../lib/data.js";
import { Pill, TierBadge } from "./Pill.jsx";

export function namedArea(data, id) {
  return data.areas.features.find((f) => f.properties.id === id)?.properties;
}

export default function AreaPanel({ data, selected }) {
  if (!selected) {
    return (
      <section className="card">
        <h3>Pick an area</h3>
        <p className="muted">Tap a named area (The Point, Town core, Reindeer Point) or any square along the highway to see its second-move risk tier and why.</p>
      </section>
    );
  }
  if (selected.startsWith("cell-")) return <CellPanel cell={data.cells.find((c) => c.id === selected)} />;
  const a = namedArea(data, selected);
  if (!a) return null;
  return (
    <section className="card area">
      <div className="area-head">
        <h3>{a.name}</h3>
        <TierBadge tier={a.tier} />
      </div>
      <p className="reason">{a.reason}</p>
      <ul className="drivers">
        {a.drivers.map((d) => (
          <li key={d.driver}>
            <span className={`lvl lvl-${d.level ?? "na"}`} aria-hidden="true" />
            <span>{d.text}</span>
            <Pill kind={d.provenance} />
            {d.driver === "ground" && d.tested === false && <Pill kind="untested" />}
          </li>
        ))}
      </ul>
      <p className="small muted">{a.description}. Outline approximate ({a.outline_source}).</p>
      <SummerChart data={data} id={selected} />
    </section>
  );
}

function CellPanel({ cell }) {
  if (!cell) return null;
  const t = TIER[cell.tier];
  return (
    <section className="card area">
      <div className="area-head">
        <h3>Screening square <small>240 m</small></h3>
        <TierBadge tier={cell.tier} />
      </div>
      <table className="kv">
        <tbody>
          <tr><th>Height</th><td>{cell.h} m above sea level {cell.h < 2.5 ? "(below storm-surge reference)" : ""}</td></tr>
          <tr><th>Coast</th><td>{cell.sea > 300 ? "Not a factor (more than 300 m inland)" : `${fmtM(cell.sea)} from the 2025 shoreline`}</td></tr>
          <tr><th>Highway</th><td>{fmtM(cell.hw)}</td></tr>
          <tr><th>Town core</th><td>{fmtM(cell.core)}</td></tr>
          <tr><th>Water nearby</th><td>{Math.round(cell.wet * 100)}% within 250 m</td></tr>
          <tr><th>Ground (radar)</th><td>{CLASS[cell.ground]?.label}{cell.mv != null ? `, ${Math.abs(cell.mv).toFixed(1)} cm ${cell.mv < 0 ? "more" : "less"} than the airport pad each summer` : ""} <Pill kind="untested" /></td></tr>
          <tr><th>Radar sees</th><td>{Math.round(cell.cov * 100)}% of the square</td></tr>
        </tbody>
      </table>
      {cell.coring === "promising_unconfirmed" && <p className="core-note">Promising, unconfirmed: high, dry, inland and near the highway. A core here would tell the relocation team the most.</p>}
      {cell.coring === "conflicting_evidence" && <p className="core-note conflict">Conflicting evidence: passes the height and access checks, but radar coverage is patchy or flagged. A core would settle it.</p>}
      <p className="small muted">Tier {t.label.toLowerCase()} comes from coast distance and height. Ground condition is not confirmed by radar.</p>
    </section>
  );
}

export function SummerChart({ data, id, compact }) {
  const a = data.timeseries?.areas?.[id];
  if (!a || !a.seasons.length) return <p className="muted small">No per-summer radar series for this area.</p>;
  const rows = a.seasons.map((s) => ({ year: String(s.year), measured: s.total_measured, role: s.role,
    expected: s.points.filter((p) => p.measured != null).slice(-1)[0]?.expected }));
  return (
    <div className="chart">
      {!compact && <h4>Each summer's movement, compared with the airport pad (cm)</h4>}
      <ResponsiveContainer width="100%" height={compact ? 120 : 160}>
        <LineChart data={rows} margin={{ top: 6, right: 10, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#ffffff14" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: "#9fb0bc", fontSize: 11 }} stroke="#33444f" />
          <YAxis tick={{ fill: "#9fb0bc", fontSize: 11 }} stroke="#33444f" domain={[-2, 2]} ticks={[-2, -1, 0, 1, 2]} />
          <ReferenceLine y={0} stroke="#9fb0bc" strokeDasharray="3 3" />
          <Tooltip contentStyle={{ background: "#151c22", border: "1px solid #33444f", borderRadius: 8 }} formatter={(v, n) => [v == null ? "—" : `${v} cm`, n]} />
          {!compact && <RLegend wrapperStyle={{ fontSize: 11 }} />}
          <Line dataKey="measured" name="Measured" stroke="#56B4E9" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} connectNulls />
          <Line dataKey="expected" name="Expected from 2021–23" stroke="#E69F00" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
      {!compact && <p className="small muted">Below zero means it sank more than the airport pad. 2024–25 were held back to test the model; the expected line comes from 2021–23 only.</p>}
    </div>
  );
}
