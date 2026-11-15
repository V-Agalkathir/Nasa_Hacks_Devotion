import { useEffect, useState } from "react";
import { DEFAULT_FILTER, loadAll } from "./lib/data.js";
import MapView from "./components/MapView.jsx";
import AreaPanel from "./components/AreaPanel.jsx";
import AboutModal from "./components/AboutModal.jsx";
import { CoastView, CompareView, CoringView, GroundControls, TrustView } from "./components/Views.jsx";

const VIEWS = [
  ["map", "Ground map"], ["compare", "Compare areas"], ["core", "Where to core"], ["coast", "Coastline"], ["trust", "How do we know?"],
];

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState("map");
  const [selected, setSelected] = useState("reindeer_point");
  const [overlay, setOverlay] = useState(null);
  const [yearIdx, setYearIdx] = useState(0);
  const [filter, setFilter] = useState(DEFAULT_FILTER);
  const [coastYears, setCoastYears] = useState([1985, 2005, 2025]);
  const [about, setAbout] = useState(false);

  useEffect(() => {
    loadAll().then((d) => {
      setData(d);
      const ys = d.manifest.years;
      const lastMeasured = ys.map((y) => y.status).lastIndexOf("measured");
      setYearIdx(Math.max(lastMeasured, 0));
    }).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="loading">Couldn't load the data ({error}). The site needs <code>public/data/manifest.json</code>.</div>;
  if (!data) return <div className="loading" role="status">Loading Ground Check…</div>;
  const m = data.manifest;
  const mapOverlay = view === "map" ? overlay : null;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <h1>Ground Check <span>· Tuktoyaktuk</span></h1>
          <p className="hook">Where can Tuk rebuild without having to move again?</p>
        </div>
        <button onClick={() => setAbout(true)}>About</button>
      </header>
      {m.mock && <div className="banner" role="status">Demo data: some layers are simulated.</div>}
      <nav className="views" aria-label="Views">
        {VIEWS.map(([k, l]) => (
          <button key={k} aria-current={view === k ? "page" : undefined} className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>
        ))}
      </nav>
      <main>
        <div className="map-col">
          <MapView data={data} view={view} overlay={mapOverlay} selected={selected} onSelect={setSelected} filter={filter} coastYears={coastYears} />
          <div className="limits" role="note">Block scale, not houses · Thaw season only · Motion relative to the airport pad · A screen, not a sign-off</div>
        </div>
        <aside>
          {view === "map" && (
            <>
              <section className="card decision">
                <p><b>Radar can't yet tell stable from degrading ground here.</b> Relative to the airport pad, summer movement stays within about 1 cm, and the patterns didn't repeat between years. So the tiers below come from coast and height, and cores decide the ground.</p>
              </section>
              <GroundControls data={data} overlay={overlay} setOverlay={setOverlay} yearIdx={yearIdx} setYearIdx={setYearIdx} />
              <AreaPanel data={data} selected={selected} />
            </>
          )}
          {view === "compare" && <CompareView data={data} onSelect={(id) => { setSelected(id); }} filter={filter} setFilter={setFilter} />}
          {view === "core" && (<><CoringView data={data} onSelect={setSelected} />{selected?.startsWith("cell-") && <AreaPanel data={data} selected={selected} />}</>)}
          {view === "coast" && <CoastView data={data} coastYears={coastYears} setCoastYears={setCoastYears} />}
          {view === "trust" && <TrustView data={data} />}
          <p className="fresh small muted">{m.freshness.line} {m.freshness.status === "paused for winter" ? "Paused for winter." : ""}</p>
        </aside>
      </main>
      {about && <AboutModal manifest={m} validation={data.validation} onClose={() => setAbout(false)} />}
    </div>
  );
}
