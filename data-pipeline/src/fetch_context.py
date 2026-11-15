"""Part 1 / step 6: context layers from OpenStreetMap (roads, water, coastline, services).

Source: Overpass API (no account), with a mirror fallback. Licence: ODbL, credit
"(c) OpenStreetMap contributors". Derived databases must stay share-alike; we only publish
these layers as map overlays and distances, with attribution.
Outputs in data/interim/context/:
  highway.geojson   Inuvik-Tuktoyaktuk Highway + town roads (LineStrings)
  water.geojson     lakes/ponds/rivers (Polygons)
  coast.geojson     OSM coastline ways (LineStrings)
  services.geojson  school, health centre, store, airport, etc. (Points)
Do NOT use GNWT building footprints (licence not stated).
Usage: python src/fetch_context.py
"""
import json, time
import requests
from common import load_config, path

cfg = load_config()
w, s, e, n = cfg["aoi"]["bbox"]
BB = f"{s},{w},{n},{e}"
SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
           "https://overpass.private.coffee/api/interpreter"]
QUERIES = {
    "highway": f'way["highway"]({BB});',
    "water": f'(way["natural"="water"]({BB});relation["natural"="water"]({BB});way["waterway"]({BB}););',
    "coast": f'way["natural"="coastline"]({BB});',
    "services": f'(nwr["amenity"~"school|clinic|hospital|doctors|community_centre|place_of_worship|fire_station|police|townhall"]({BB});'
                f'nwr["shop"]({BB});nwr["aeroway"~"aerodrome|terminal"]({BB});nwr["healthcare"]({BB}););',
}


def overpass(q):
    body = f"[out:json][timeout:90];{q}out geom center;"
    for url in SERVERS:
        for attempt in range(2):
            try:
                r = requests.post(url, data={"data": body}, timeout=120,
                                  headers={"User-Agent": "devotion-tuk-ground-check/1.0 (NASA Space Apps)"})
                r.raise_for_status()
                return r.json()["elements"]
            except Exception as ex:
                print(f"  {url.split('/')[2]} failed ({ex}); retrying"); time.sleep(5)
    raise RuntimeError("all Overpass servers failed")


def to_feature(el, as_polygon):
    tags = el.get("tags", {})
    props = {"osm_id": f"{el['type']}/{el['id']}", **{k: tags[k] for k in ("name", "highway", "ref", "amenity", "shop",
                                                                             "aeroway", "natural", "waterway", "healthcare") if k in tags}}
    if el["type"] == "node":
        geom = {"type": "Point", "coordinates": [el["lon"], el["lat"]]}
    elif "geometry" in el:
        coords = [[p["lon"], p["lat"]] for p in el["geometry"]]
        closed = len(coords) > 3 and coords[0] == coords[-1]
        geom = ({"type": "Polygon", "coordinates": [coords]} if as_polygon and closed
                else {"type": "LineString", "coordinates": coords})
    elif "center" in el:
        geom = {"type": "Point", "coordinates": [el["center"]["lon"], el["center"]["lat"]]}
    else:
        return None
    return {"type": "Feature", "properties": props, "geometry": geom}


out = path(cfg, "interim", "context")
for name, q in QUERIES.items():
    els = overpass(q)
    feats = [f for f in (to_feature(el, as_polygon=(name == "water")) for el in els) if f]
    if name == "services":   # services as points (centre of buildings/areas)
        for f in feats:
            g = f["geometry"]
            if g["type"] != "Point":
                xs, ys = zip(*(g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"]))
                f["geometry"] = {"type": "Point", "coordinates": [sum(xs) / len(xs), sum(ys) / len(ys)]}
    fc = {"type": "FeatureCollection", "attribution": "(c) OpenStreetMap contributors, ODbL", "features": feats}
    json.dump(fc, open(out / f"{name}.geojson", "w"))
    print(f"{name}: {len(feats)} features")
    time.sleep(2)   # be polite to Overpass
hw = [f for f in json.load(open(out / "highway.geojson"))["features"]
      if "Inuvik" in f["properties"].get("name", "") or f["properties"].get("ref") == "10"]
print(f"Inuvik-Tuk Highway segments inside AOI: {len(hw)}  (AOI contains highway: {'yes' if hw else 'CHECK'})")
