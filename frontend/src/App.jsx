import { useEffect, useState } from "react";
import { loadAll } from "./lib/data.js";
import MapView from "./components/MapView.jsx";
import TimeSlider from "./components/TimeSlider.jsx";
import ZonePanel from "./components/ZonePanel.jsx";
import Legend from "./components/Legend.jsx";
import LayerControl from "./components/LayerControl.jsx";
import AboutModal from "./components/AboutModal.jsx";

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [seasonIdx, setSeasonIdx] = useState(0);
  const [zoneId, setZoneId] = useState("reindeer");
  const [layers, setLayers] = useState({ radar: true, opacity: 0.75, zones: true, coastline: true });
  const [about, setAbout] = useState(false);

  useEffect(() => {
    loadAll()
      .then((d) => { setData(d); setSeasonIdx(d.manifest.seasons.length - 1); })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="loading">Couldn't load the radar data ({error}). Check that <code>public/data/manifest.json</code> exists.</div>;
  if (!data) return <div className="loading">Loading radar data…</div>;
  const season = data.manifest.seasons[seasonIdx];

  return (
    <div className="app">
      <header>
        <h1>Tuktoyaktuk Ground Stability</h1>
        <span className="sub">Thaw-season ground motion from NISAR (L-band) + Sentinel-1 radar</span>
        <button onClick={() => setAbout(true)}>About the data</button>
      </header>
      {data.manifest.mock && (
        <div className="banner" role="status">
          Demo data: the radar layers and zone numbers are simulated until the real NISAR and Sentinel-1 results are loaded.
        </div>
      )}
      <main>
        <MapView data={data} season={season} zoneId={zoneId} onZoneClick={setZoneId} layers={layers} />
        <aside>
          <TimeSlider seasons={data.manifest.seasons} value={seasonIdx} onChange={setSeasonIdx} />
          <ZonePanel data={data} zoneId={zoneId} season={season} onSelect={setZoneId} />
          <Legend range={data.manifest.colour_range_cm} units={data.manifest.units} season={season} />
          <LayerControl layers={layers} onChange={setLayers} hasCoastline={data.coastline.features.length > 0} />
        </aside>
      </main>
      {about && <AboutModal onClose={() => setAbout(false)} />}
    </div>
  );
}
