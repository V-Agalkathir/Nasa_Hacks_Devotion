import { useEffect, useState } from "react";
import { loadAll } from "./lib/data.js";
import MapView from "./components/MapView.jsx";
import TimeSlider from "./components/TimeSlider.jsx";
import ZonePanel from "./components/ZonePanel.jsx";
import Legend from "./components/Legend.jsx";
import AboutModal from "./components/AboutModal.jsx";

export default function App() {
  const [data, setData] = useState(null);
  const [seasonIdx, setSeasonIdx] = useState(0);
  const [zoneId, setZoneId] = useState("reindeer");
  const [about, setAbout] = useState(false);

  useEffect(() => {
    loadAll().then((d) => { setData(d); setSeasonIdx(d.manifest.seasons.length - 1); });
  }, []);

  if (!data) return <div className="loading">Loading radar data…</div>;
  const season = data.manifest.seasons[seasonIdx];

  return (
    <div className="app">
      <header>
        <h1>Tuktoyaktuk Ground Stability</h1>
        <span className="sub">Thaw-season ground motion from NISAR (L-band) + Sentinel-1 radar</span>
        <button onClick={() => setAbout(true)}>About the data</button>
      </header>
      <main>
        <MapView data={data} season={season} zoneId={zoneId} onZoneClick={setZoneId} />
        <aside>
          <TimeSlider seasons={data.manifest.seasons} value={seasonIdx} onChange={setSeasonIdx} />
          <ZonePanel data={data} zoneId={zoneId} season={season} onSelect={setZoneId} />
          <Legend range={data.manifest.colour_range_cm} units={data.manifest.units} season={season} />
        </aside>
      </main>
      {about && <AboutModal onClose={() => setAbout(false)} />}
    </div>
  );
}
