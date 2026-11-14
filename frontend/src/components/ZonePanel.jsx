import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Legend } from "recharts";
import { riskLabel } from "../lib/data.js";

const COLORS = { point: "#e67e22", core: "#8e44ad", reindeer: "#3867d6" };

export default function ZonePanel({ data, zoneId, season, onSelect }) {
  const zones = data.zones.features.map((f) => f.properties);
  const zone = zones.find((z) => z.id === zoneId);
  const stats = zone?.stats?.[season.id];
  const risk = riskLabel(stats?.mean_cm);

  // reshape timeseries -> [{season, point, core, reindeer}]
  const rows = data.manifest.seasons.map((s) => {
    const r = { season: s.id };
    for (const z of zones) r[z.id] = data.timeseries[z.id]?.find((p) => p.season === s.id)?.mean_cm;
    return r;
  });

  return (
    <section className="card">
      <div className="tabs">
        {zones.map((z) => (
          <button key={z.id} className={z.id === zoneId ? "active" : ""} onClick={() => onSelect(z.id)}>{z.name.split(" (")[0]}</button>
        ))}
      </div>
      <h3>{zone?.name}</h3>
      <p className="big">{stats?.mean_cm ?? "—"} cm <small>mean summer motion</small></p>
      <p className="risk" style={{ background: risk.color }}>{risk.label}</p>
      <small>{stats ? `${stats.valid_pct}% of pixels usable` : ""}{zone?.approximate ? " · zone outline approximate" : ""}</small>
      <h4>All zones, by summer</h4>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={rows}>
          <XAxis dataKey="season" /><YAxis unit=" cm" width={50} />
          <ReferenceLine y={0} stroke="#999" /><Tooltip /><Legend />
          {zones.map((z) => <Line key={z.id} dataKey={z.id} name={z.name.split(" (")[0]} stroke={COLORS[z.id]} strokeWidth={z.id === zoneId ? 3 : 1.5} />)}
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
