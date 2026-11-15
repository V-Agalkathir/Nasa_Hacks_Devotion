import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid } from "recharts";
import { riskLabel, ZONE_COLORS, shortName } from "../lib/data.js";

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
  // Round the axis floor down to an even number of cm so ticks land on whole values.
  const minCm = Math.min(0, ...rows.flatMap((r) => zones.map((z) => r[z.id]).filter((v) => v != null)));
  const yFloor = 2 * Math.floor((minCm - 0.5) / 2);

  return (
    <section className="card">
      <div className="tabs" role="tablist" aria-label="Zone">
        {zones.map((z) => (
          <button key={z.id} role="tab" aria-selected={z.id === zoneId} className={z.id === zoneId ? "active" : ""}
            style={{ "--zone": ZONE_COLORS[z.id] }} onClick={() => onSelect(z.id)}>
            {shortName(z.name)}
          </button>
        ))}
      </div>
      <h3>{zone?.name}</h3>
      <p className="big">{stats?.mean_cm ?? "—"} cm <small>mean motion, {season.label}</small></p>
      <p className="risk" style={{ background: risk.color }}>{risk.label}</p>
      {stats && (
        <p className="stat-line">
          <span>Fastest-sinking 10% of the zone: <b>{stats.p10_cm} cm</b></span>
          <span>{stats.valid_pct}% of pixels usable{zone?.approximate ? " · outline approximate" : ""}</span>
        </p>
      )}
      <h4>All zones, by summer (mean cm)</h4>
      <div className="chart-legend">
        {zones.map((z) => (
          <span key={z.id} className={z.id === zoneId ? "on" : ""}>
            <i style={{ background: ZONE_COLORS[z.id] }} />{shortName(z.name)}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={170}>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#ffffff14" vertical={false} />
          <XAxis dataKey="season" tick={{ fill: "#9fb0bc", fontSize: 12 }} stroke="#33444f" />
          <YAxis width={44} tick={{ fill: "#9fb0bc", fontSize: 12 }} stroke="#33444f"
            domain={[yFloor, 0]} tickCount={Math.min(6, -yFloor / 2 + 1)} allowDecimals={false} />
          <ReferenceLine y={0} stroke="#9fb0bc" strokeDasharray="3 3" />
          <Tooltip contentStyle={{ background: "#151c22", border: "1px solid #33444f", borderRadius: 8 }}
            formatter={(v, name) => [`${v} cm`, name]} />
          {zones.map((z) => (
            <Line key={z.id} dataKey={z.id} name={shortName(z.name)} stroke={ZONE_COLORS[z.id]}
              strokeWidth={z.id === zoneId ? 3 : 1.5} dot={{ r: z.id === zoneId ? 4 : 2 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
