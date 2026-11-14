"""Step 4 — produce everything the frontend reads (see DATA CONTRACT in README):
  rasters/disp_<season>.png   colourised overlay
  zones.geojson               zone polygons + per-season stats
  timeseries.json             cumulative cm per zone per season
  manifest.json               index of all of the above
Usage: python src/export_web.py
"""
import json
import numpy as np
import rasterio
from rasterio.features import geometry_mask
from shapely.geometry import shape, mapping
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from common import load_config, path

cfg = load_config()
out = path(cfg, "web_out")
(out / "rasters").mkdir(exist_ok=True)
vmin, vmax = cfg["processing"]["colour_range_cm"]
cmap = plt.get_cmap("PuOr")  # colour-blind-safe diverging (orange = sinking)

zones = json.load(open(path(cfg, "zones")))
seasons_out, ts = [], {f["properties"]["id"]: [] for f in zones["features"]}

for s in sorted(cfg["seasons"], key=lambda s: s["id"]):
    tif = path(cfg, "interim") / f"disp_{s['id']}.tif"
    if not tif.exists():
        continue
    with rasterio.open(tif) as src:
        d, tr, b = src.read(1), src.transform, src.bounds
    norm = np.clip((d - vmin) / (vmax - vmin), 0, 1)
    rgba = (cmap(norm) * 255).astype("uint8")
    rgba[..., 3] = np.where(np.isnan(d), 0, 200)
    png = f"rasters/disp_{s['id']}.png"
    plt.imsave(out / png, rgba)

    for f in zones["features"]:
        m = geometry_mask([f["geometry"]], out_shape=d.shape, transform=tr, invert=True)
        vals = d[m & ~np.isnan(d)]
        stats = {"mean_cm": round(float(vals.mean()), 2) if vals.size else None,
                 "p10_cm": round(float(np.percentile(vals, 10)), 2) if vals.size else None,
                 "valid_pct": round(100 * vals.size / max(m.sum(), 1), 1)}
        f["properties"].setdefault("stats", {})[s["id"]] = stats
        ts[f["properties"]["id"]].append({"season": s["id"], **stats})

    seasons_out.append({"id": s["id"], "label": f"Summer {s['id']}", "source": s["source"], "image": png,
                        "coordinates": [[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]]})

json.dump(zones, open(out / "zones.geojson", "w"))
json.dump(ts, open(out / "timeseries.json", "w"), indent=1)
W, S, E, N = cfg["aoi"]["bbox"]
manifest = {"aoi": {"name": cfg["aoi"]["name"], "bbox": cfg["aoi"]["bbox"], "center": [(W + E) / 2, (S + N) / 2], "zoom": 11.5},
            "units": "cm (line-of-sight, negative = subsidence)", "colour_range_cm": [vmin, vmax],
            "seasons": seasons_out, "zones": "zones.geojson", "timeseries": "timeseries.json",
            "coastline": "coastline.geojson", "generated_by": "data-pipeline/src/export_web.py"}
json.dump(manifest, open(out / "manifest.json", "w"), indent=1)
print("wrote", out / "manifest.json", f"({len(seasons_out)} seasons)")
