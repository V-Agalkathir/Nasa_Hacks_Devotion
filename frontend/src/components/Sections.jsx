import { TIER, STATUS, LIMITS_FALLBACK } from "../lib/tokens.js";
import { fmtDate, fmtM } from "../lib/data.js";
import { needs } from "../lib/check.js";
import { TierBars } from "./CheckPanel.jsx";

export function ResultsStrip({ mock }) {
  return mock
    ? <div className="strip demo" role="status"><span className="pill">DEMO</span> Demo data: every number on this page is simulated until the radar pipeline delivers.</div>
    : <div className="strip" role="status"><span className="pill">REAL RESULTS</span> Tests were fixed before we looked at the answers (tag prereg-eval). Every failed test is shown below with its number.</div>;
}

export function Header({ manifest, onAbout }) {
  const lp = manifest.latest_pass || manifest.freshness?.latest_pass || {};
  const now = new Date();
  const md = (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
  const winter = md >= 1001 || md < 601;
  const ageDays = (now - new Date(manifest.generated_at)) / 86400000;
  const overdue = !winter && ageDays > 3;
  return (
    <header className="hdr">
      <div>
        <p className="brand">Ground Check <span>· Tuktoyaktuk</span></p>
        <p className="fresh">Last radar pass: {fmtDate(lp.date)}, {lp.sensor}. Updates every 12 days, June to September.
          {overdue && ` Update check overdue; showing data from ${fmtDate(manifest.generated_at.slice(0, 10))}.`}</p>
        <p className="fresh muted">NISAR passes are checked automatically; the 2026 summer gave no usable series.</p>
      </div>
      <span className="season-chip">{winter ? "Winter pause" : "Watching for passes"}</span>
      <button onClick={onAbout}>About</button>
    </header>
  );
}

export function Hero({ promCount, blocks, namedHigher, namedTotal, tests, onCore, onTown, onTests }) {
  const ran = tests?.filter((t) => ["pass", "partial", "fail"].includes(t.status)) ?? [];
  const passed = ran.filter((t) => t.status === "pass" || t.status === "partial").length;
  const couldnt = tests ? tests.filter((t) => !["pass", "partial", "fail"].includes(t.status)).length : 0;
  return (
    <section className="hero">
      <h1>Satellites can't yet certify ground in Tuk.</h1>
      <p className="lead">We tested that honestly. The screen still narrows the search for the relocation team's cores to high, dry, inland ground near the highway.</p>
      <div className="tiles">
        <button className="tile" onClick={onCore}><b>{promCount ?? "–"}</b><span>squares worth a core ({promCount == null ? "–" : (promCount * 0.0576).toFixed(1)} km² in {blocks ?? "–"} blocks): high, dry, inland, near the highway</span><em>Show where</em></button>
        <button className="tile" onClick={onTown}><b>{namedHigher} of {namedTotal}</b><span>named areas are higher risk: they sit on the shoreline</span><em>See the town</em></button>
        <button className="tile" onClick={onTests}><b>{tests ? `${ran.length} tests` : "–"}</b><span>of whether radar can predict the ground: {passed ? `${passed} passed` : "none passed yet"}{couldnt ? `, ${couldnt} more couldn't run` : ""}. That's why cores decide</span><em>See every test</em></button>
      </div>
    </section>
  );
}

export function CompareStrip({ cols, need, onShow, onRemove }) {
  if (!cols.length) return null;
  return (
    <section className="card" id="compare">
      <h2>Side by side</h2>
      <p className="muted">Your needs, applied to every saved check. Up to three.</p>
      <div className="cmp">
        {cols.map((c) => {
          const t = TIER[c.tier.tier];
          const rows = needs(c.agg, need);
          const met = rows.filter((r) => r.glyph === "✓").length;
          return (
            <div key={c.slot} className={`cmp-col${c.slot === "now" ? " unsaved" : ""}`}>
              <p className="eyebrow">{c.slot === "now" ? "not saved yet" : c.slot}</p>
              <h3>{c.name}</h3>
              <p className={`tier-chip${t.hatch ? " hatch" : ""}`} style={{ background: t.fill, color: t.text }}><TierBars n={t.bars} /> {t.short}</p>
              <div className="mix">{Object.entries(c.agg.tiers).filter(([, v]) => v).map(([k, v]) => <span key={k} style={{ width: `${(100 * v) / c.agg.n}%`, background: TIER[k].fill }} />)}</div>
              <dl>
                <dt>Coast</dt><dd>{c.agg.sea <= 100 ? "On the shoreline" : fmtM(c.agg.sea)}</dd>
                <dt>Height</dt><dd>{c.agg.h?.toFixed(1)} m (lowest tenth {c.agg.p10?.toFixed(1)} m)</dd>
                <dt>Ground</dt><dd>{c.agg.mv == null ? "–" : `${Math.abs(c.agg.mv).toFixed(1)} cm ${c.agg.mv < 0 ? "more" : "less"}`} <span className="pill pill-unconf">UNCONFIRMED</span></dd>
                <dt>Highway</dt><dd>{fmtM(c.agg.hw)}</dd>
                <dt>To town</dt><dd>{fmtM(c.agg.core)}</dd>
                <dt>Water</dt><dd>{Math.round(c.agg.wet * 100)}%</dd>
                <dt>Radar reads</dt><dd>{Math.round(c.agg.cov * 100)}%</dd>
                <dt>Needs</dt><dd>{rows.map((r) => r.glyph).join(" ")} · {met} of 5 needs</dd>
              </dl>
              <div className="cmp-actions">
                <button onClick={() => onShow(c)}>Select on map</button>
                {c.slot !== "now" && <button onClick={() => onRemove(c.slot)}>Remove</button>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function TestCards({ validation }) {
  return (
    <section className="card" id="tests">
      <h2>How do we know?</h2>
      <p className="muted">Each test was fixed before we saw the answer. Failures stay on the page.</p>
      {!validation ? <p className="empty">Test results didn't load. Nothing here counts as passed.</p> : (
        <>
          <div className="tests">
            {validation.cards.map((c) => {
              const s = STATUS[c.status] ?? STATUS.not_available;
              const h = typeof c.headline === "object" ? c.headline : { value: c.headline, unit: "" };
              return (
                <article key={c.id} className="test">
                  <span className={`chip ${s.cls}`}>{s.glyph} {s.label}</span>
                  <h3>{c.title}</h3>
                  <p className="num">{h.value} <small>{h.unit}</small></p>
                  <p className="small">{c.baseline}</p>
                  <p>{c.plain ?? c.sentence}</p>
                  {c.method && <p className="note">{c.method}</p>}
                </article>
              );
            })}
          </div>
          <div className="boxes">
            <div className="notebox"><b>What still works</b><p>{validation.what_still_works}</p></div>
            <div className="notebox"><b>What we don't predict</b><p>{(validation.what_we_dont_predict || []).join(" · ")}</p></div>
          </div>
          <details><summary className="small">Changes from the original plan ({validation.deviations?.length ?? 0})</summary>
            <ul className="small">{validation.deviations?.map((d, i) => <li key={i}><b>{d.what}.</b> {d.why}.</li>)}</ul>
          </details>
        </>
      )}
    </section>
  );
}

export function LimitsStrip({ limits }) {
  return <footer className="limits"><ul>{(limits?.length ? limits : LIMITS_FALLBACK).map((l) => <li key={l}>{l}</li>)}</ul></footer>;
}
