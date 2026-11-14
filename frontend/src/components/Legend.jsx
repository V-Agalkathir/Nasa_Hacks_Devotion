export default function Legend({ range, units, season }) {
  return (
    <section className="card">
      <div className="legend-bar" />
      <div className="legend-labels"><span>{range[0]} cm (sinking)</span><span>0</span><span>+{range[1]} cm</span></div>
      <small>{units} · {season.label}</small>
    </section>
  );
}
