"""Generates FAKE season rasters so the frontend team can build before real data lands.
Writes data/interim/disp_<season>.tif, then run export_web.py as normal.
Fake pattern: subsidence strongest near the Point, weakest at Reindeer Point, worsening each year.
DELETE the mock rasters (data/interim/disp_*.tif) before exporting real data.
"""
import numpy as np
import rasterio
from rasterio.transform import from_bounds
from common import load_config, path

cfg = load_config()
W, S, E, N = cfg["aoi"]["bbox"]
res = cfg["processing"]["grid_res_deg"]
w, h = int((E - W) / res), int((N - S) / res)
lon, lat = np.meshgrid(np.linspace(W, E, w), np.linspace(N, S, h))
rng = np.random.default_rng(0)
dist_point = np.hypot((lon + 133.041) * 0.35, lat - 69.452)  # rough km-ish scaling

for i, s in enumerate(sorted(cfg["seasons"], key=lambda s: s["id"])):
    base = -2.0 - 6.0 * np.exp(-dist_point / 0.02) * (1 + 0.15 * i)
    d = (base + rng.normal(0, 0.6, base.shape)).astype("float32")
    d[rng.random(d.shape) < 0.05] = np.nan  # simulate decorrelated pixels
    with rasterio.open(path(cfg, "interim") / f"disp_{s['id']}.tif", "w", driver="GTiff", height=h, width=w,
                       count=1, dtype="float32", crs="EPSG:4326", transform=from_bounds(W, S, E, N, w, h),
                       nodata=np.nan) as dst:
        dst.write(d, 1)
print("mock rasters written — now run: python src/export_web.py")
