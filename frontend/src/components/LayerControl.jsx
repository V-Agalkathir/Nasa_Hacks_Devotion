export default function LayerControl({ layers, onChange, hasCoastline }) {
  const set = (k, v) => onChange({ ...layers, [k]: v });
  return (
    <section className="card layers">
      <h3>Map layers</h3>
      <label><input id="layer-radar" type="checkbox" checked={layers.radar}
        onChange={(e) => set("radar", e.target.checked)} /> Radar ground motion</label>
      <label className="opacity">
        <span>Overlay opacity</span>
        <input id="layer-opacity" type="range" min={0.2} max={1} step={0.05} value={layers.opacity}
          disabled={!layers.radar} onChange={(e) => set("opacity", Number(e.target.value))} />
      </label>
      <label><input id="layer-zones" type="checkbox" checked={layers.zones}
        onChange={(e) => set("zones", e.target.checked)} /> Zone outlines and labels</label>
      <label className={hasCoastline ? "" : "disabled"}>
        <input id="layer-coast" type="checkbox" checked={layers.coastline && hasCoastline} disabled={!hasCoastline}
          onChange={(e) => set("coastline", e.target.checked)} /> Historical coastlines
        {!hasCoastline && <small> (coming soon)</small>}
      </label>
    </section>
  );
}
