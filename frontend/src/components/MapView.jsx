import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { NAMED_COLORS, TIER, cellsToGeoJSON, labelPoint } from "../lib/data.js";

// Free satellite basemap (Esri World Imagery), no API key. Credited in the About box.
const STYLE = {
  version: 8,
  sources: {
    sat: { type: "raster", tileSize: 256, attribution: "Imagery © Esri",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] },
  },
  layers: [{ id: "sat", type: "raster", source: "sat", paint: { "raster-saturation": -0.35 } }],
};
const BLANK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const tierColor = ["match", ["get", "tier"], ...Object.entries(TIER).flatMap(([k, v]) => [k, v.color]), "#888"];
const namedColor = ["match", ["get", "id"], ...Object.entries(NAMED_COLORS).flat(), "#ddd"];
const YEAR_COLORS = { 1985: "#fde725", 1995: "#5ec962", 2005: "#21918c", 2015: "#3b528b", 2025: "#ffffff" };

export default function MapView({ data, view, overlay, selected, onSelect, filter, coastYears }) {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  const latest = useRef({ onSelect });
  latest.current = { onSelect };
  const ready = useRef(false);
  const lastUrl = useRef(BLANK);

  useEffect(() => {
    const { bbox, image_coordinates } = data.manifest.area;
    const m = new maplibregl.Map({
      container: el.current, style: STYLE, attributionControl: { compact: true },
      bounds: [[bbox[0], 69.36], [bbox[2], 69.47]], fitBoundsOptions: { padding: 16 },
    });
    map.current = m;

    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    // Add our layers as soon as the (inline) style is parsed, so they never wait for slow basemap tiles.
    // An inline style can finish loading inside the constructor, so check before listening.
    let done = false;
    const init = () => {
      if (done) return;
      done = true;
      m.addSource("overlay", { type: "image", url: BLANK, coordinates: image_coordinates });
      m.addLayer({ id: "overlay", type: "raster", source: "overlay", paint: { "raster-opacity": 0.85, "raster-fade-duration": 0, "raster-resampling": "nearest" } });
      m.addSource("cells", { type: "geojson", data: cellsToGeoJSON(data.cells, filter) });
      m.addLayer({ id: "cells-fill", type: "fill", source: "cells", paint: { "fill-color": tierColor, "fill-opacity": 0.45 } });
      m.addLayer({ id: "cells-core", type: "line", source: "cells", filter: ["==", ["get", "coring"], "promising_unconfirmed"],
        paint: { "line-color": "#ffffff", "line-width": 1.4 }, layout: { visibility: "none" } });
      m.addLayer({ id: "cells-conflict", type: "line", source: "cells", filter: ["==", ["get", "coring"], "conflicting_evidence"],
        paint: { "line-color": "#CC79A7", "line-width": 2.5 }, layout: { visibility: "none" } });
      m.addLayer({ id: "cells-sel", type: "line", source: "cells", filter: ["==", ["get", "id"], ""],
        paint: { "line-color": "#fff", "line-width": 3 } });
      m.addSource("coast", { type: "geojson", data: data.coastline });
      m.addLayer({ id: "shorelines", type: "line", source: "coast", filter: ["==", ["get", "kind"], "shoreline"],
        paint: { "line-color": ["match", ["get", "year"], ...Object.entries(YEAR_COLORS).flatMap(([k, v]) => [Number(k), v]), "#fff"], "line-width": 1.6 },
        layout: { visibility: "none" } });
      m.addLayer({ id: "transects", type: "line", source: "coast", filter: ["all", ["==", ["get", "kind"], "transect"], ["has", "change_m"]],
        paint: { "line-color": ["interpolate", ["linear"], ["coalesce", ["get", "change_m"], 0], -20, "#2166ac", 0, "#f7f7f7", 20, "#e66101"],
          "line-width": 2, "line-opacity": 0.8 }, layout: { visibility: "none" } });
      m.addSource("named", { type: "geojson", data: data.areas });
      m.addLayer({ id: "named-fill", type: "fill", source: "named", paint: { "fill-color": namedColor, "fill-opacity": 0.08 } });
      m.addLayer({ id: "named-line", type: "line", source: "named", paint: { "line-color": namedColor, "line-width": 2.5 } });
      const click = (e) => {
        const f = e.features?.[0];
        if (f) latest.current.onSelect(f.properties.id);
      };
      for (const id of ["named-fill", "cells-fill"]) {
        m.on("click", id, (e) => { if (id === "cells-fill" && m.queryRenderedFeatures(e.point, { layers: ["named-fill"] }).length) return; click(e); });
        m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
      }
      markers.current = data.areas.features.map((f) => {
        const b = document.createElement("button");
        b.className = "zone-label";
        b.type = "button";
        b.textContent = f.properties.name;
        b.style.setProperty("--zone", NAMED_COLORS[f.properties.id] ?? "#ccc");
        b.addEventListener("click", (ev) => { ev.stopPropagation(); latest.current.onSelect(f.properties.id); });
        // Town core sits just south of The Point: put its label below its outline so the two never overlap.
        const below = f.properties.id === "town_core";
        const [lx, ly] = labelPoint(f.geometry, below ? "bottom" : "top");
        return new maplibregl.Marker({ element: b, anchor: below ? "top" : "bottom", offset: [0, below ? 4 : -4] }).setLngLat([lx, ly]).addTo(m);
      });
      ready.current = true;
      if (import.meta.env.DEV) window.__map = m;
      apply();
    };
    // isStyleLoaded() also waits for tiles; the parsed-style flag is what addSource/addLayer need.
    const tryInit = () => { if (m.style && m.style._loaded) init(); };
    tryInit();
    m.on("styledata", tryInit);
    m.once("load", init);
    return () => { markers.current.forEach((mk) => mk.remove()); m.remove(); };
  }, []);

  function apply() {
    const m = map.current;
    if (!m || !ready.current) return;
    const vis = (on) => (on ? "visible" : "none");
    const url = overlay ? data.base + overlay : BLANK;
    if (lastUrl.current !== url) {
      lastUrl.current = url;
      m.getSource("overlay").updateImage({ url, coordinates: data.manifest.area.image_coordinates });
    }
    m.setLayoutProperty("overlay", "visibility", vis(!!overlay));
    const showCells = view === "map" || view === "core" || view === "compare";
    m.setLayoutProperty("cells-fill", "visibility", vis(showCells && !overlay));
    m.setPaintProperty("cells-fill", "fill-opacity", view === "core"
      ? ["case", ["==", ["get", "coring"], "promising_unconfirmed"], 0.55, ["get", "pass"], 0.18, 0.06]
      : ["case", ["get", "pass"], 0.45, 0.08]);
    m.setLayoutProperty("cells-core", "visibility", vis(view === "core"));
    m.setLayoutProperty("cells-conflict", "visibility", vis(view === "core"));
    m.setLayoutProperty("shorelines", "visibility", vis(view === "coast"));
    m.setLayoutProperty("transects", "visibility", vis(view === "coast"));
    m.setFilter("shorelines", ["all", ["==", ["get", "kind"], "shoreline"], ["in", ["get", "year"], ["literal", coastYears]]]);
    m.setFilter("cells-sel", ["==", ["get", "id"], selected?.startsWith("cell-") ? selected : ""]);
    m.setPaintProperty("named-line", "line-width", ["case", ["==", ["get", "id"], selected ?? ""], 4.5, 2.5]);
    markers.current.forEach((mk, i) => mk.getElement().classList.toggle("active", data.areas.features[i].properties.id === selected));
  }

  useEffect(() => { apply(); }, [view, overlay, selected, coastYears]);
  // Bring a chosen square into view (list clicks), without animation if the user prefers reduced motion.
  useEffect(() => {
    const m = map.current;
    if (!m || !selected?.startsWith("cell-")) return;
    const c = data.cells.find((x) => x.id === selected);
    if (!c) return;
    const b = m.getBounds();
    if (!b.contains([c.lon, c.lat])) {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      m.easeTo({ center: [c.lon, c.lat], zoom: Math.max(m.getZoom(), 12), duration: reduce ? 0 : 600 });
    }
  }, [selected]);
  // Where-to-core looks along the highway: zoom out to show the corridor.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (view === "core") m.fitBounds([[-133.25, 69.2], [-132.9, 69.46]], { padding: 16, duration: 0 });
  }, [view]);
  useEffect(() => {
    const s = map.current?.getSource("cells");
    if (s) { s.setData(cellsToGeoJSON(data.cells, filter)); apply(); }
  }, [filter]);

  return <div ref={el} className="map" role="region" aria-label="Map of Tuktoyaktuk and the highway corridor. The area table in the side panel is the text alternative." />;
}
