import { useEffect, useMemo, useRef, useState } from "react";
import { loadAll } from "./lib/data.js";
import { DEFAULT_NEED, PRESETS, aggregate, autoName, coresByType, funnel, presetCells, tierRule } from "./lib/check.js";
import SearchCard from "./components/SearchCard.jsx";
import MapView from "./components/MapView.jsx";
import CheckPanel from "./components/CheckPanel.jsx";
import AboutModal from "./components/AboutModal.jsx";
import { CoreList, LayerSwitch, Legend, RadarNote, RadarSteps, Readout, ShoreDates, Tools } from "./components/MapCard.jsx";
import { CompareStrip, Header, Hero, LimitsStrip, ResultsStrip, TestCards } from "./components/Sections.jsx";

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const isTouch = () => window.matchMedia?.("(pointer: coarse)").matches;

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [layer, setLayer] = useState("screen");
  const [step, setStep] = useState("cls");
  const [shoreYear, setShoreYear] = useState(2025);
  const [tool, setTool] = useState(isTouch() ? "move" : "box");
  const [zoom, setZoom] = useState("region");
  const [sel, setSel] = useState([]);
  const [selName, setSelName] = useState("Nothing selected");
  const [named, setNamed] = useState(null);
  const [selVer, setSelVer] = useState(0);
  const [ran, setRan] = useState(null);
  const [running, setRunning] = useState(false);
  const [need, setNeedRaw] = useState(DEFAULT_NEED);
  const [saved, setSaved] = useState([]);
  const [saveNote, setSaveNote] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const [about, setAbout] = useState(false);
  const [showRoad, setShowRoad] = useState(true);
  const [showNames, setShowNames] = useState(true);
  const booted = useRef(false);
  const nameLock = useRef(false);   // preset names (e.g. "Highway km 26") are not replaced by the auto name

  useEffect(() => {
    loadAll().then(setData).catch((e) => setError(e.message));
  }, []);

  const setNeed = (n) => setNeedRaw(n ?? DEFAULT_NEED);

  function makeReport(ids, name, namedId, d = data) {
    const agg = aggregate(ids, d);
    if (!agg) return null;
    const namedArea = namedId ? d.areas.features.find((f) => f.properties.id === namedId)?.properties : null;
    const tier = namedArea ? { tier: namedArea.tier, coast: namedArea.drivers.find((x) => x.driver === "coast").level,
      height: namedArea.drivers.find((x) => x.driver === "height").level } : tierRule(agg);
    return { ids, name, namedId, named: namedArea, agg, tier, ts: namedId ? d.timeseries?.areas?.[namedId] : null };
  }

  function choosePreset(p, d = data, run = false) {
    const ids = presetCells(p, d);
    nameLock.current = true;
    setSel(ids);
    setSelName(p.label);
    setNamed(p.named ?? null);
    setSelVer((v) => v + 1);
    if (run) setRan({ ...makeReport(ids, p.label, p.named, d), ver: -1 });
  }

  // Start with Reindeer Point selected and checked, and The Point + Highway km 26 saved (spec 2.1).
  useEffect(() => {
    if (!data || booted.current) return;
    booted.current = true;
    if (!data.cells.length) return;
    const mk = (key, slot) => {
      const p = PRESETS.find((x) => x.key === key);
      return { slot, ...makeReport(presetCells(p, data), p.label, p.named, data) };
    };
    setSaved([mk("the_point", "A"), mk("hwy26", "B")].filter((s) => s.agg));
    const p = PRESETS.find((x) => x.key === "reindeer_point");
    const ids = presetCells(p, data);
    nameLock.current = true;
    setSel(ids); setSelName(p.label); setNamed(p.named);
    setRan({ ...makeReport(ids, p.label, p.named, data), ver: 0 });
  }, [data]);

  function onPick(ids, mode) {
    setSel((cur) => {
      const s = new Set(cur);
      if (mode === "replace") return [...new Set(ids)].sort();
      for (const id of ids) {
        if (mode === "add") s.add(id);
        else if (mode === "remove") s.delete(id);
        else if (s.has(id)) s.delete(id); else s.add(id);
      }
      return [...s].sort();
    });
    nameLock.current = false;
    setNamed(null);
    setSelVer((v) => v + 1);
  }
  useEffect(() => { if (data && !nameLock.current) setSelName(autoName(sel, data)); }, [sel]);

  function run() {
    const r = makeReport(sel, selName, named);
    if (!r) return;
    const finish = () => { setRan({ ...r, ver: selVer }); setRunning(false); setSaveNote(null); };
    if (reduceMotion()) return finish();
    setRunning(true);
    setTimeout(finish, 900);
  }

  function save() {
    if (!ran) return;
    if (saved.some((s) => s.ids.join() === ran.ids.join())) return setSaveNote({ label: "Saved", note: "Already in Side by side." });
    if (saved.length >= 3) return setSaveNote({ label: "Save to compare", note: "Side by side holds three. Remove one first." });
    const slot = ["A", "B", "C"].find((x) => !saved.some((s) => s.slot === x));
    setSaved([...saved, { ...ran, slot }]);
    setSaveNote({ label: `Saved as ${slot}`, note: "Keeps this check for Side by side, below." });
  }

  const stale = ran && ran.ver !== -1 && ran.ver !== selVer;
  const cols = useMemo(() => {
    const c = [...saved];
    if (ran && !saved.some((s) => s.ids.join() === ran.ids.join())) c.push({ ...ran, slot: "now" });
    return c;
  }, [saved, ran]);

  const fun = useMemo(() => (data && data.cells.length ? funnel(data.cells, need, data.byId) : null), [data, need]);
  const types = useMemo(() => (fun ? coresByType(fun.cand, data.byId) : []), [fun]);

  if (error) return <div className="loading"><p>We couldn't load the map data. Try again in a minute.</p><p className="small">{error}</p></div>;
  if (!data) return <div className="loading" role="status">Loading the map…</div>;
  const m = data.manifest;
  const tests = data.validation?.cards?.filter((c) => c.id !== "radar_checks");
  const namedHigher = data.areas.features.filter((f) => f.properties.tier === "higher").length;
  const promCount = fun ? fun.cand.ids.size : null;
  const conf = data.cells.filter((c) => c.coring === "conflicting_evidence").length;
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth" });

  return (
    <div className="page">
      <ResultsStrip mock={m.mock} />
      <Header manifest={m} onAbout={() => setAbout(true)} />
      <Hero promCount={promCount} blocks={fun?.cand.blocks.length} namedHigher={namedHigher} namedTotal={data.areas.features.length} tests={tests}
        onCore={() => { setLayer("core"); go("mapcard"); }} onTown={() => { setZoom("town"); go("mapcard"); }} onTests={() => go("tests")} />
      <div className="cols">
        <section className="card mapcard" id="mapcard" aria-label="Map">
          <LayerSwitch layer={layer} onLayer={setLayer} />
          <Tools tool={tool} onTool={setTool} zoom={zoom} onZoom={setZoom} />
          <div className="map-shell">
            <MapView data={data} layer={layer} step={step} shoreYear={shoreYear} tool={tool} zoom={zoom} sel={sel} saved={saved}
              cand={fun?.cand.ids} picks={types.map((t) => t.pick.id)}
              showRoad={showRoad} showNames={showNames} onPick={onPick} onHover={setHoverId} />
            {layer === "radar" && <RadarNote step={step} />}
          </div>
          <Readout cell={hoverId ? data.byId[hoverId] : null} zoom={zoom} />
          {data.failed.cells && <p className="empty">The screening grid didn't load, so selection and the check are off.</p>}
          {layer === "radar" && <RadarSteps years={m.years} step={step} onStep={setStep} />}
          {layer === "coast" && <ShoreDates value={shoreYear} onChange={setShoreYear} coastline={data.coastline} />}
          <Legend layer={layer} step={step} counts={{ prom: promCount, conf }} />
          {layer === "core" && <CoreList cells={data.cells.filter((c) => fun?.cand.ids.has(c.id))} onSelect={(ids) => { onPick(ids, "replace"); }} />}
          <div className="opts">
            <label><input type="checkbox" checked={showRoad} onChange={(e) => setShowRoad(e.target.checked)} /> Highway and roads</label>
            <label><input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} /> Place names and outlines</label>
          </div>
        </section>
        <CheckPanel selName={selName} selCount={sel.length} onPreset={(p) => choosePreset(p)} need={need} setNeed={setNeed}
          onRun={run} running={running} report={ran} stale={stale} onSave={save} saveNote={saveNote}
          onShowCore={() => { setLayer("core"); go("mapcard"); }} />
      </div>
      {fun && <SearchCard fun={fun} need={need} setNeed={setNeed} types={types}
        onSelect={(id) => { onPick([id], "replace"); setLayer("core"); go("mapcard"); }}
        onShowMap={() => { setLayer("core"); setZoom("region"); go("mapcard"); }} />}
      <CompareStrip cols={cols} need={need}
        onShow={(c) => { nameLock.current = true; setSel(c.ids); setSelName(c.name); setNamed(c.namedId ?? null); setSelVer((v) => v + 1); go("mapcard"); }}
        onRemove={(slot) => setSaved(saved.filter((s) => s.slot !== slot))} />
      <TestCards validation={data.validation} />
      <LimitsStrip limits={m.limits} />
      {about && <AboutModal manifest={m} onClose={() => setAbout(false)} />}
    </div>
  );
}
