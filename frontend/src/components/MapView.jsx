import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

// Free satellite basemap (Esri World Imagery) — no API key needed. Credit it in the UI + submission.
const STYLE = {
  version: 8,
  sources: {
    sat: { type: "raster", tileSize: 256, attribution: "Imagery © Esri",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] },
  },
  layers: [{ id: "sat", type: "raster", source: "sat" }],
};

export default function MapView({ data, season, zoneId, onZoneClick }) {
  const el = useRef(null);
  const map = useRef(null);

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current, style: STYLE,
      center: data.manifest.aoi.center, zoom: data.manifest.aoi.zoom });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl(), "top-left");
    m.on("load", () => {
      m.addSource("disp", { type: "image", url: data.base + season.image, coordinates: season.coordinates });
      m.addLayer({ id: "disp", type: "raster", source: "disp", paint: { "raster-opacity": 0.75 } });
      m.addSource("zones", { type: "geojson", data: data.zones, promoteId: "id" });
      m.addLayer({ id: "zones-line", type: "line", source: "zones",
        paint: { "line-color": ["case", ["==", ["get", "id"], zoneId], "#ffffff", "#cccccc"], "line-width": 2 } });
      m.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-opacity": 0 } });
      m.on("click", "zones-fill", (e) => onZoneClick(e.features[0].properties.id));
      m.on("mouseenter", "zones-fill", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "zones-fill", () => (m.getCanvas().style.cursor = ""));
    });
    return () => m.remove();
  }, []);

  // swap raster when the slider moves
  useEffect(() => {
    const src = map.current?.getSource("disp");
    if (src) src.updateImage({ url: data.base + season.image, coordinates: season.coordinates });
  }, [season]);

  // highlight selected zone
  useEffect(() => {
    const m = map.current;
    if (m?.getLayer("zones-line"))
      m.setPaintProperty("zones-line", "line-color", ["case", ["==", ["get", "id"], zoneId], "#ffffff", "#cccccc"]);
  }, [zoneId]);

  return <div ref={el} className="map" />;
}
