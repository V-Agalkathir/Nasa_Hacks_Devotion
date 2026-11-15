import { CLASS, COAST_BANDS, CORE, HEIGHT_BINS, MOTION, TIER, TRANSECT, C } from "../lib/tokens.js";
import { fmtM } from "../lib/data.js";

export const LAYERS = [["screen", "Screen"], ["height", "Height"], ["coast", "Coast"], ["radar", "Radar"], ["core", "Core next"]];
const BLOCK = " Squares are 240 m: block scale, not single houses.";

export function layerNote(layer, step) {
  if (layer === "screen") return "Second-move risk for every 240 m square, from measured height, distance to the 2025 shoreline and radar." + BLOCK;
  if (layer === "height") return "Height above sea level. The 2.5 m storm-surge reference is the line that matters most." + BLOCK;
  if (layer === "coast") return "Distance to the 2025 shoreline, with measured shoreline change along each transect." + BLOCK;
  if (layer === "core") return "Where a core would tell the relocation team the most. Ordered by distance from town, not ranked." + BLOCK;
  if (step === "cls") return "Radar classes from five summers. Unconfirmed: the patterns did not repeat between years." + BLOCK;
  if (step === "2026") return "NISAR 2026: insufficient data." + BLOCK;
  return `Movement in summer ${step}, relative to the airport gravel pad. ±1 cm is within the noise.` + BLOCK;
}

export function LayerSwitch({ layer, onLayer }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Map layer">
      {LAYERS.map(([k, l]) => (
        <button key={k} role="radio" aria-checked={layer === k} className={layer === k ? "on" : ""} onClick={() => onLayer(k)}>{l}</button>
      ))}
    </div>
  );
}

export function Tools({ tool, onTool, zoom, onZoom }) {
  const T = [["move", "Move", "✥"], ["box", "Box", "▭"], ["paint", "Paint", "✎"], ["erase", "Erase", "⌫"]];
  return (
    <div className="tools" role="toolbar" aria-label="Map tools">
      {T.map(([k, l, ic]) => (
        <button key={k} aria-pressed={tool === k} className={tool === k ? "on" : ""} onClick={() => onTool(k)} title={l}>
          <span aria-hidden="true">{ic}</span><span className="tl">{l}</span>
        </button>
      ))}
      <span className="sep" />
      {[["region", "Region"], ["town", "Town"]].map(([k, l]) => (
        <button key={k} aria-pressed={zoom === k} className={zoom === k ? "on" : ""} onClick={() => onZoom(k)}>{l}</button>
      ))}
    </div>
  );
}

export function RadarSteps({ years, step, onStep }) {
  const steps = [{ k: "cls", l: "Classes" }, ...years.map((y) => ({ k: String(y.year), l: String(y.year),
    sub: y.status === "measured" ? `${Math.round(y.valid_share * 100)}% read${y.valid_share < 0.5 ? " · town only" : ""}` : "insufficient" }))];
  return (
    <div className="stepbar">
      <div className="steps" role="radiogroup" aria-label="Radar summer">
        {steps.map((s) => (
          <button key={s.k} role="radio" aria-checked={step === s.k} className={step === s.k ? "on" : ""} onClick={() => onStep(s.k)}>
            {s.l}{s.sub && <small>{s.sub}</small>}
          </button>
        ))}
      </div>
      <p className="note">Sentinel-1 2021–2025, 80 m. NISAR from 2026: a different sensor, so read 2025→2026 with care. “% read”: share of the land radar measured that summer.</p>
    </div>
  );
}

export function ShoreDates({ value, onChange, coastline }) {
  const years = [1985, 1995, 2005, 2015, 2025];
  const date = coastline.features.find((f) => f.properties.kind === "shoreline" && f.properties.year === value)?.properties.date;
  return (
    <div className="stepbar">
      <div className="steps" role="radiogroup" aria-label="Shoreline date">
        {years.map((y) => <button key={y} role="radio" aria-checked={value === y} className={value === y ? "on" : ""} onClick={() => onChange(y)}>{y}</button>)}
      </div>
      <p className="note">{coastline.features.length ? `Waterline from ${date ?? value}, ±15 m. Air-photo shorelines from 1947–1985 failed visual review and are left out.` : "Shorelines didn't load."}</p>
    </div>
  );
}

const Sw = ({ color, hatch, ring, dot }) => <i className={`sw${hatch ? " hatch" : ""}${ring ? " ring" : ""}${dot ? " dot" : ""}`} style={{ background: color }} />;

export function Legend({ layer, step, counts }) {
  let items = [];
  if (layer === "screen") items = [...Object.values(TIER).map((t) => [t.short, t.fill, t.hatch]), ["Water", C.water]];
  if (layer === "height") items = HEIGHT_BINS.map((b) => [b.label, b.color]);
  if (layer === "coast") items = [...COAST_BANDS.map((b) => [b.label, b.color]), ...TRANSECT.map((t) => [t.label, t.color])];
  if (layer === "core") items = [[`${counts.prom} promising, unconfirmed`, CORE.promising], [`${counts.conf} conflicting evidence`, CORE.conflicting, false, false, true], ["Other land", CORE.other]];
  if (layer === "radar" && step === "cls") items = Object.values(CLASS).map((c) => [c.label, c.color, c.hatch]);
  if (layer === "radar" && step !== "cls" && step !== "2026") items = [...MOTION.map((m) => [m.label, m.color]), ["No radar record", "#E5DCB0", true]];
  if (layer === "radar" && step === "2026") items = [["Insufficient data", "#E5DCB0", true]];
  return (
    <div className="legend">
      {items.map(([l, c, h, r, d]) => <span key={l}><Sw color={c} hatch={h} ring={r} dot={d} />{l}</span>)}
      {layer === "radar" && step === "cls" && <><span className="pill pill-unconf">UNCONFIRMED</span><span className="pill pill-notrun">NOT RUN</span><span className="small">Predicted ground: 110 of 300 examples needed</span></>}
      <p className="note">{layerNote(layer, step)}</p>
    </div>
  );
}

export function RadarNote({ step }) {
  if (step === "cls") return <div className="map-note"><b>Unconfirmed</b><span>Radar patterns did not repeat between years. Read classes as a hint, not a finding.</span></div>;
  if (step === "2026") return <div className="map-note"><b>2026: insufficient data</b><span>One NISAR pair failed to unwrap and several lost coherence, so there's no connected series.</span></div>;
  return null;
}

export function Readout({ cell, zoom }) {
  let text;
  if (!cell) text = zoom === "town" ? "Town view. Each square is 240 m across. Drag to select." : "Drag a box over any land from the town down to highway km 32, or tap one square.";
  else text = [TIER[cell.tier].short, `${cell.h} m above sea`, cell.sea <= 100 ? "on the shoreline" : `${fmtM(cell.sea)} from shore`,
    `${fmtM(cell.hw)} to highway`, cell.coring === "promising_unconfirmed" ? "Promising, unconfirmed" : cell.coring === "conflicting_evidence" ? "Conflicting evidence" : null].filter(Boolean).join(" · ");
  return <p className="readout" aria-live="polite">{text}</p>;
}

export function CoreList({ cells, onSelect }) {
  const prom = cells.filter((c) => c.coring === "promising_unconfirmed").sort((a, b) => a.core - b.core);
  return (
    <div className="corelist">
      <ol>
        {prom.slice(0, 6).map((c) => (
          <li key={c.id}>
            <span><b>{fmtM(c.core)}</b> from the town core · {c.h} m high · {fmtM(c.hw)} to the highway</span>
            <button onClick={() => onSelect([c.id])}>Select</button>
          </li>
        ))}
      </ol>
      <p className="note">The six closest to town of {prom.length}. Ordered by distance from town, not ranked: it suggests where a core would tell the relocation team the most and doesn't replace their judgement.</p>
    </div>
  );
}
