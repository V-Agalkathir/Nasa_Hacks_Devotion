import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { ZONE_COLORS, shortName, labelPoint } from "../lib/data.js";

// Free satellite basemap (Esri World Imagery) — no API key needed. Credit it in the UI + submission.
const STYLE = {
  version: 8,
  sources: {
    sat: { type: "raster", tileSize: 256, attribution: "Imagery © Esri",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] },
  },
  layers: [{ id: "sat", type: "raster", source: "sat" }],
};

const zoneColor = ["match", ["get", "id"], ...Object.entries(ZONE_COLORS).flat(), "#cccccc"];
const lineWidth = (zoneId) => ["case", ["==", ["get", "id"], zoneId ?? ""], 4, 2];

export default function MapView({ data, season, zoneId, onZoneClick, layers }) {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  // Keep the latest props in refs so map event handlers never use stale values.
  const latest = useRef({ season, zoneId, layers, onZoneClick });
  latest.current = { season, zoneId, layers, onZoneClick };

  useEffect(() => {
    const { bbox } = data.manifest.aoi;
    const m = new maplibregl.Map({
      container: el.current, style: STYLE,
      bounds: [[bbox[0], bbox[1]], [bbox[2], bbox[3]]], fitBoundsOptions: { padding: 24 },
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    m.on("load", () => {
      const { season, zoneId, layers } = latest.current;
      m.addSource("disp", { type: "image", url: data.base + season.image, coordinates: season.coordinates });
      m.addLayer({ id: "disp", type: "raster", source: "disp",
        paint: { "raster-opacity": layers.opacity, "raster-fade-duration": 0 },
        layout: { visibility: layers.radar ? "visible" : "none" } });

      if (data.coastline.features.length) {
        m.addSource("coast", { type: "geojson", data: data.coastline });
        m.addLayer({ id: "coast", type: "line", source: "coast",
          paint: { "line-color": "#7fe3ff", "line-width": 2, "line-dasharray": [2, 1] },
          layout: { visibility: layers.coastline ? "visible" : "none" } });
      }

      m.addSource("zones", { type: "geojson", data: data.zones });
      m.addLayer({ id: "zones-fill", type: "fill", source: "zones",
        paint: { "fill-color": zoneColor, "fill-opacity": 0.01 } });
      m.addLayer({ id: "zones-line", type: "line", source: "zones",
        paint: { "line-color": zoneColor, "line-width": lineWidth(zoneId) },
        layout: { visibility: layers.zones ? "visible" : "none" } });

      m.on("click", "zones-fill", (e) => latest.current.onZoneClick(e.features[0].properties.id));
      m.on("mouseenter", "zones-fill", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "zones-fill", () => (m.getCanvas().style.cursor = ""));

      // HTML labels (no glyph server needed). They are buttons, so keyboard users can pick a zone too.
      markers.current = data.zones.features.map((f) => {
        const b = document.createElement("button");
        b.className = "zone-label";
        b.type = "button";
        b.textContent = shortName(f.properties.name);
        b.style.setProperty("--zone", ZONE_COLORS[f.properties.id] ?? "#ccc");
        b.addEventListener("click", (ev) => { ev.stopPropagation(); latest.current.onZoneClick(f.properties.id); });
        return new maplibregl.Marker({ element: b, anchor: "bottom", offset: [0, -4] })
          .setLngLat(labelPoint(f.geometry)).addTo(m);
      });
    });
    return () => { markers.current.forEach((mk) => mk.remove()); m.remove(); };
  }, []);

  // Swap the radar image when the slider moves.
  useEffect(() => {
    const src = map.current?.getSource("disp");
    if (src) src.updateImage({ url: data.base + season.image, coordinates: season.coordinates });
  }, [season]);

  // Highlight the selected zone (outline + label).
  useEffect(() => {
    const m = map.current;
    if (m?.getLayer("zones-line")) m.setPaintProperty("zones-line", "line-width", lineWidth(zoneId));
    markers.current.forEach((mk, i) =>
      mk.getElement().classList.toggle("active", data.zones.features[i].properties.id === zoneId));
  }, [zoneId]);

  // Layer toggles and overlay opacity.
  useEffect(() => {
    const m = map.current;
    if (!m?.isStyleLoaded()) return;
    const vis = (on) => (on ? "visible" : "none");
    if (m.getLayer("disp")) {
      m.setLayoutProperty("disp", "visibility", vis(layers.radar));
      m.setPaintProperty("disp", "raster-opacity", layers.opacity);
    }
    if (m.getLayer("coast")) m.setLayoutProperty("coast", "visibility", vis(layers.coastline));
    if (m.getLayer("zones-line")) m.setLayoutProperty("zones-line", "visibility", vis(layers.zones));
    markers.current.forEach((mk) => (mk.getElement().hidden = !layers.zones));
  }, [layers]);

  return <div ref={el} className="map" role="region" aria-label="Map of Tuktoyaktuk with radar ground-motion overlay" />;
}
