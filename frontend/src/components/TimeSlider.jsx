export default function TimeSlider({ seasons, value, onChange }) {
  const s = seasons[value];
  return (
    <section className="card">
      <h3>Thaw season: {s.label}</h3>
      <input type="range" min={0} max={seasons.length - 1} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
      <div className="ticks">{seasons.map((x) => <span key={x.id}>{x.id}</span>)}</div>
      <small>Source: {s.source === "NISAR" ? "NISAR L-band" : "Sentinel-1 C-band"} · June–Sept only (radar can't measure motion under snow)</small>
    </section>
  );
}
