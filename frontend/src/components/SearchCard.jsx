import { fmtM } from "../lib/data.js";

const km2 = (n) => (n * 0.0576).toFixed(1);

// Criteria breakdown from the whole corridor to the candidate blocks, plus one suggested core per
// ground type. All numbers are live: changing a need in the Ground check panel updates them.
export default function SearchCard({ fun, need, setNeed, types, onSelect, onShowMap }) {
  const { total, steps, cand } = fun;
  return (
    <section className="card search" id="search" aria-labelledby="search-h">
      <p className="eyebrow">Narrow the search</p>
      <h2 id="search-h">From {total.toLocaleString()} squares to {cand.ids.size} ({km2(cand.ids.size)} km²) in {cand.blocks.length} block{cand.blocks.length === 1 ? "" : "s"}</h2>
      <p className="muted">Each line is one criterion. “On its own” counts the squares that pass it alone; “Left” applies them one after another. Change the needs in the Ground check panel and this updates.</p>
      <div className="table-wrap">
        <table className="funnel">
          <thead><tr><th>Criterion</th><th>On its own</th><th>Left</th><th>Basis</th></tr></thead>
          <tbody>
            <tr><th scope="row">Every 240 m land square near a road</th><td>{total}</td><td>{total}</td><td className="small muted">Screening grid</td></tr>
            {steps.map((s) => (
              <tr key={s.label}>
                <th scope="row">{s.label}</th>
                <td>{s.alone == null ? "–" : s.alone}</td>
                <td><span className="bar" style={{ width: `${Math.max(2, (100 * s.left) / total)}%` }} />{s.left}</td>
                <td className="small muted">{s.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="blocksel">Smallest block worth keeping:{" "}
        <select value={need.minBlock} onChange={(e) => setNeed({ ...need, minBlock: Number(e.target.value) })}>
          {[[1, "any single square"], [4, "4 touching squares (about 23 ha)"], [9, "9 touching squares (about 52 ha)"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      {cand.blocks.length > 0 && (
        <p className="small">Largest blocks: {cand.blocks.slice(0, 5).map((b) => `${b.length} squares`).join(" · ")}. <button className="link" onClick={onShowMap}>Show them on the map</button></p>
      )}

      <h3 className="mt">Where the first cores should go: one per ground type</h3>
      <p className="muted small">Candidate squares grouped by height and wetness. One core in each group tells the relocation team about every similar square, not just one point. In each group, the suggested square is the one nearest town. This suggests where a core is most informative; it doesn't rank sites or replace the team's judgement.</p>
      {types.length === 0 ? <p className="empty">No candidate squares with these needs. Loosen one of them.</p> : (
        <ol className="types">
          {types.map((t) => (
            <li key={t.type}>
              <span><b>{t.type}</b>: {t.n} squares ({t.km2} km²). Suggested core {fmtM(t.pick.core)} from the town core, {t.pick.h} m high, {fmtM(t.pick.hw)} from the highway.</span>
              <button onClick={() => onSelect(t.pick.id)}>Select</button>
            </li>
          ))}
        </ol>
      )}
      <p className="note">Thermokarst observations from the NWT aerial survey were checked and left out: they record where photos were taken, not what the ground is.</p>
    </section>
  );
}
