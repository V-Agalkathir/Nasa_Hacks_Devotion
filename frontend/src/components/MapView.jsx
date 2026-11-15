import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { cellsGeoJSON, selectionOutline } from "../lib/data.js";
import { C, CLASS, COAST_BANDS, CORE, HEIGHT_BINS, TIER } from "../lib/tokens.js";

// Free satellite basemap (Esri World Imagery), no API key. Credited in the About box.
const STYLE = {
  version: 8,
  sources: { sat: { type: "raster", tileSize: 256, attribution: "Imagery © Esri",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] } },
  layers: [{ id: "sat", type: "raster", source: "sat", paint: { "raster-saturation": -0.5, "raster-brightness-max": 0.9 } }],
};
const BLANK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const tierFill = ["match", ["get", "tier"], ...Object.entries(TIER).flatMap(([k, v]) => [k, v.fill]), "#ccc"];
const heightFill = ["step", ["get", "h"], HEIGHT_BINS[0].color, 2.5, HEIGHT_BINS[1].color, 4, HEIGHT_BINS[2].color, 8, HEIGHT_BINS[3].color, 15, HEIGHT_BINS[4].color];
const coastFill = ["step", ["get", "sea"], COAST_BANDS[0].color, 100.01, COAST_BANDS[1].color, 300.01, COAST_BANDS[2].color];
const coreFill = ["case", ["get", "cand"], CORE.promising, CORE.other];
const transectColor = ["case", ["!", ["has", "change_m"]], "#0000",
  ["<", ["get", "change_m"], -15], "#542788", ["<=", ["get", "change_m"], 15], "#5E4733", ["<=", ["get", "change_m"], 40], "#E08214", "#7A3214"];

function hatch(fg, bg) {
  const s = 8, c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, s, s);
  g.strokeStyle = fg; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(0, s); g.lineTo(s, 0); g.moveTo(0, 0); g.lineTo(s, s); g.stroke();
  return g.getImageData(0, 0, s, s);
}

export default function MapView({ data, layer, step, shoreYear, tool, zoom, sel, saved, cand, picks, showRoad, showNames, onPick, onHover }) {
  const el = useRef(null);
  const boxEl = useRef(null);
  const map = useRef(null);
  const ready = useRef(false);
  const lastUrl = useRef(BLANK);
  const latest = useRef({});
  latest.current = { tool, onPick, onHover, sel, cand, picks };

  useEffect(() => {
    const b = data.manifest.bounds || data.manifest.area.bbox;
    const m = new maplibregl.Map({ container: el.current, style: STYLE, attributionControl: { compact: true },
      bounds: [[b[0], b[1]], [b[2], b[3]]], fitBoundsOptions: { padding: 12 }, dragRotate: false, touchPitch: false });
    map.current = m;
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    let done = false;
    const init = () => {
      if (done) return;
      done = true;
      m.addImage("hatch-cant", hatch("#5E4733", "#D9D3BD"));
      m.addImage("hatch-norecord", hatch("#A8977A", "#E5DCB0"));
      const coords = data.manifest.area.image_coordinates;
      m.addSource("overlay", { type: "image", url: BLANK, coordinates: coords });
      m.addLayer({ id: "overlay", type: "raster", source: "overlay", paint: { "raster-opacity": 0.9, "raster-fade-duration": 0, "raster-resampling": "nearest" } });
      m.addSource("cells", { type: "geojson", data: cellsGeoJSON(data.cells, latest.current.cand, new Set(latest.current.picks)) });
      m.addLayer({ id: "cells-fill", type: "fill", source: "cells", paint: { "fill-color": tierFill, "fill-opacity": 0.82 } });
      m.addLayer({ id: "cells-hatch", type: "fill", source: "cells", filter: ["==", ["get", "tier"], "not_enough_data"], paint: { "fill-pattern": "hatch-cant" } });
      m.addLayer({ id: "cells-norecord", type: "fill", source: "cells", paint: { "fill-pattern": "hatch-norecord", "fill-opacity": 0.85 }, layout: { visibility: "none" } });
      m.addLayer({ id: "cells-line", type: "line", source: "cells", paint: { "line-color": "#311E10", "line-opacity": 0.12, "line-width": 0.5 } });
      m.addSource("coast", { type: "geojson", data: data.coastline });
      m.addLayer({ id: "shore-other", type: "line", source: "coast", filter: ["==", ["get", "kind"], "shoreline"],
        paint: { "line-color": "#FFFCF0", "line-width": 1.2, "line-opacity": 0.45, "line-dasharray": [2, 2] }, layout: { visibility: "none" } });
      m.addLayer({ id: "shore-sel", type: "line", source: "coast", filter: ["==", ["get", "year"], 2025],
        paint: { "line-color": "#FFFCF0", "line-width": 2.4 }, layout: { visibility: "none" } });
      m.addLayer({ id: "transects", type: "line", source: "coast", filter: ["==", ["get", "kind"], "transect"],
        paint: { "line-color": transectColor, "line-width": 2.2 }, layout: { visibility: "none" } });
      const hw = { type: "FeatureCollection", features: [] };
      m.addSource("roads", { type: "geojson", data: hw });
      m.addLayer({ id: "roads", type: "line", source: "roads", paint: { "line-color": "#311E10", "line-width": 1.6, "line-opacity": 0.7 } });
      m.addSource("named", { type: "geojson", data: data.areas });
      m.addLayer({ id: "named", type: "line", source: "named", paint: { "line-color": "#FFFCF0", "line-width": 2, "line-dasharray": [3, 2] } });
      m.addLayer({ id: "picks", type: "line", source: "cells", filter: ["==", ["get", "pick"], true],
        paint: { "line-color": "#FFFCF0", "line-width": 4 }, layout: { visibility: "none" } });
      m.addSource("boreholes", { type: "geojson", data: data.boreholes || { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "boreholes", type: "circle", source: "boreholes",
        paint: { "circle-radius": 5, "circle-color": ["case", ["get", "ice_rich"], "#311E10", "#FFFCF0"], "circle-stroke-color": "#311E10", "circle-stroke-width": 1.5 },
        layout: { visibility: "none" } });
      m.addSource("conflict", { type: "geojson", data: { type: "FeatureCollection", features: data.cells.filter((c) => c.coring === "conflicting_evidence")
        .map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [c.lon, c.lat] } })) } });
      m.addLayer({ id: "conflict", type: "circle", source: "conflict", paint: { "circle-radius": 6, "circle-color": CORE.conflicting, "circle-stroke-color": "#FFFCF0", "circle-stroke-width": 2 }, layout: { visibility: "none" } });
      m.addSource("saved", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      // line-dasharray can't be data-driven, so one layer per saved slot: A dashed, B dotted, C dash-dot
      for (const [slot, dash] of [["A", [4, 2]], ["B", [1, 2]], ["C", [4, 2, 1, 2]]]) {
        m.addLayer({ id: `saved-${slot}`, type: "line", source: "saved", filter: ["==", ["get", "slot"], slot],
          paint: { "line-color": "#311E10", "line-width": 2, "line-dasharray": dash } });
      }
      m.addSource("sel", { type: "geojson", data: selectionOutline([], data.byId) });
      m.addLayer({ id: "sel-halo", type: "line", source: "sel", paint: { "line-color": "#FFFCF0", "line-width": 6 } });
      m.addLayer({ id: "sel-line", type: "line", source: "sel", paint: { "line-color": "#311E10", "line-width": 2.5 } });
      fetch(data.base + "roads.geojson").then((r) => (r.ok ? r.json() : null)).then((g) => g && m.getSource("roads")?.setData(g)).catch(() => {});
      wireTools(m);
      ready.current = true;
      if (import.meta.env.DEV) window.__map = m;
      apply();
    };
    const tryInit = () => { if (m.style && m.style._loaded) init(); };
    tryInit();
    m.on("styledata", tryInit);
    m.once("load", init);
    return () => m.remove();
  }, []);

  function wireTools(m) {
    let start = null, painting = false;
    const pick = (pt) => m.queryRenderedFeatures(pt, { layers: ["cells-fill"] }).map((f) => f.properties.id);
    m.on("mousemove", "cells-fill", (e) => latest.current.onHover(e.features[0]?.properties.id));
    m.on("click", "cells-fill", (e) => {
      const t = latest.current.tool, id = e.features[0]?.properties.id;
      if (!id) return;
      latest.current.onPick([id], t === "paint" ? "add" : t === "erase" ? "remove" : "toggle");
      latest.current.onHover(id);
    });
    const down = (e) => {
      const t = latest.current.tool;
      if (t === "move") return;
      const p = e.point;
      if (t === "box") {
        start = p;
        boxEl.current.style.display = "block";
        Object.assign(boxEl.current.style, { left: `${p.x}px`, top: `${p.y}px`, width: "0px", height: "0px" });
      } else painting = true;
    };
    const move = (e) => {
      const t = latest.current.tool;
      if (start && t === "box") {
        const p = e.point;
        Object.assign(boxEl.current.style, { left: `${Math.min(p.x, start.x)}px`, top: `${Math.min(p.y, start.y)}px`,
          width: `${Math.abs(p.x - start.x)}px`, height: `${Math.abs(p.y - start.y)}px` });
      } else if (painting) {
        const ids = pick(e.point);
        if (ids.length) latest.current.onPick(ids, t === "erase" ? "remove" : "add");
      }
    };
    const up = (e) => {
      if (start) {
        const p = e.point;
        boxEl.current.style.display = "none";
        if (Math.abs(p.x - start.x) > 6 && Math.abs(p.y - start.y) > 6) {
          const ids = pick([[Math.min(p.x, start.x), Math.min(p.y, start.y)], [Math.max(p.x, start.x), Math.max(p.y, start.y)]]);
          latest.current.onPick([...new Set(ids)], "replace");
        }
      }
      start = null;
      painting = false;
    };
    m.on("mousedown", down); m.on("touchstart", down);
    m.on("mousemove", move); m.on("touchmove", move);
    m.on("mouseup", up); m.on("touchend", up);
  }

  function apply() {
    const m = map.current;
    if (!m || !ready.current) return;
    const vis = (on) => (on ? "visible" : "none");
    let url = BLANK;
    if (layer === "radar") {
      if (step === "cls") url = data.base + "rasters/behaviour.png";
      else if (step !== "2026") url = data.base + `rasters/motion_${step}.png`;
    }
    if (url !== lastUrl.current) {
      lastUrl.current = url;
      m.getSource("overlay").updateImage({ url, coordinates: data.manifest.area.image_coordinates });
    }
    m.setLayoutProperty("overlay", "visibility", vis(layer === "radar" && step !== "2026"));
    const fill = { screen: tierFill, height: heightFill, coast: coastFill, core: coreFill, radar: "#000" }[layer];
    m.setPaintProperty("cells-fill", "fill-color", fill);
    m.setPaintProperty("cells-fill", "fill-opacity", layer === "radar" ? 0 : layer === "core" ? ["case", ["get", "cand"], 0.9, 0.5] : 0.82);
    m.setLayoutProperty("cells-hatch", "visibility", vis(layer === "screen"));
    m.setLayoutProperty("cells-norecord", "visibility", vis(layer === "radar" && step === "2026"));
    m.setLayoutProperty("cells-line", "visibility", vis(layer !== "radar"));
    m.setLayoutProperty("shore-other", "visibility", vis(layer === "coast"));
    m.setLayoutProperty("shore-sel", "visibility", vis(layer === "coast"));
    m.setLayoutProperty("transects", "visibility", vis(layer === "coast"));
    m.setFilter("shore-sel", ["all", ["==", ["get", "kind"], "shoreline"], ["==", ["get", "year"], shoreYear]]);
    m.setFilter("shore-other", ["all", ["==", ["get", "kind"], "shoreline"], ["!=", ["get", "year"], shoreYear]]);
    m.setLayoutProperty("conflict", "visibility", "none");
    m.setLayoutProperty("picks", "visibility", vis(layer === "core"));
    m.setLayoutProperty("boreholes", "visibility", vis(layer === "core"));
    m.setLayoutProperty("roads", "visibility", vis(showRoad));
    m.setLayoutProperty("named", "visibility", vis(showNames));
    if (tool === "move") m.dragPan.enable(); else m.dragPan.disable();
  }

  useEffect(() => { apply(); }, [layer, step, shoreYear, tool, showRoad, showNames]);
  useEffect(() => {
    if (!ready.current) return;
    map.current.getSource("cells").setData(cellsGeoJSON(data.cells, cand, new Set(picks)));
  }, [cand, (picks || []).join()]);
  useEffect(() => {
    if (!ready.current) return;
    map.current.getSource("sel").setData(selectionOutline(sel, data.byId));
  }, [sel]);
  useEffect(() => {
    if (!ready.current) return;
    const feats = saved.flatMap((s) => {
      const o = selectionOutline(s.ids, data.byId);
      o.properties = { slot: s.slot };
      return [o];
    });
    map.current.getSource("saved").setData({ type: "FeatureCollection", features: feats });
  }, [saved]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const b = zoom === "town" ? data.manifest.town_bounds || [-133.10, 69.36, -132.92, 69.47] : data.manifest.bounds || data.manifest.area.bbox;
    m.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 12, duration: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 500 });
  }, [zoom]);

  return (
    <div className="map-wrap">
      <div ref={el} className="map" role="region" aria-label="Map of Tuktoyaktuk and the highway corridor. Use the Try chips or the core list to select land by keyboard." />
      <div ref={boxEl} className="box-sel" aria-hidden="true" />
    </div>
  );
}
