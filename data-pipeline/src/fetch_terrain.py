"""Part 1 / step 5: elevation + terrain/surface feature layers on the shared grid.

Outputs (all on the shared grid, float32, NaN = no data):
  data/interim/context/elevation_m.tif          height above mean sea level (CGVD2013), metres
  data/interim/features/elevation.tif           same, copied for Model B
  data/interim/features/slope.tif               degrees
  data/interim/features/roughness.tif           std-dev of elevation in a 3x3 window, metres
  data/interim/features/wetness_index.tif       topographic wetness index ln(a / tan b) (D8)
  data/interim/features/water_occurrence.tif    % of months with water 1984-2021 (JRC GSW v1.4)
  data/interim/features/distance_to_water.tif   metres to nearest water (occurrence >= 50%)
  data/interim/features/distance_to_coast.tif   metres to the sea (water connected to the AOI edge)
  data/interim/features/ndvi_summer.tif         median July-August NDVI, Sentinel-2 L2A 2023-2025

Sources (no accounts):
  HRDEM via NRCan STAC https://datacube.services.geo.ca/stac/api, tried in order
    hrdem-mosaic-2m (dtm) -> hrdem-arcticdem (dtm) -> mrdem-30 (dtm); first one with >=80% AOI cover wins.
    Open Government Licence - Canada.
  JRC Global Surface Water v1.4 occurrence tile 140W_70N (Pekel et al. 2016), unrestricted.
  Sentinel-2 L2A via Microsoft Planetary Computer STAC; "Contains modified Copernicus Sentinel data".
Geology class: NOT fetched (no machine-readable surficial map at block scale found; see spec).
Usage: python src/fetch_terrain.py [--skip-ndvi]
"""
import sys
import numpy as np
from scipy import ndimage
from pystac_client import Client
from common import load_config, path, grid, write_tif, warp_to_grid

cfg = load_config()
tr, H, W = grid(cfg)
feat = path(cfg, "interim", "features"); ctx = path(cfg, "interim", "context")
res = cfg["processing"]["grid_res_deg"]
lat0 = (cfg["aoi"]["bbox"][1] + cfg["aoi"]["bbox"][3]) / 2
dx, dy = res * 111320 * np.cos(np.radians(lat0)), res * 110540          # metres per pixel (x, y)
print(f"shared grid {H}x{W}, pixel ~{dx:.0f} m (E-W) x {dy:.0f} m (N-S)")

# ---------------- elevation ----------------
stac = Client.open("https://datacube.services.geo.ca/stac/api")
elev, used = None, None
for coll in ["hrdem-mosaic-2m", "hrdem-arcticdem", "mrdem-30"]:
    items = list(stac.search(collections=[coll], bbox=cfg["aoi"]["bbox"], max_items=5).items())
    for it in items:
        key = next((k for k in ["dtm", "dem"] if k in it.assets), None)
        if not key:
            continue
        try:
            arr = warp_to_grid(cfg, it.assets[key].href, "bilinear")
        except Exception as e:
            print(f"  {coll}/{it.id}: read failed ({e})"); continue
        cover = np.isfinite(arr).mean()
        print(f"  {coll}/{it.id}: AOI cover {100 * cover:.0f}%")
        if elev is None:
            elev, used = arr, f"{coll}/{it.id}"
        else:
            elev = np.where(np.isfinite(elev), elev, arr)           # fill gaps from next source
        if np.isfinite(elev).mean() >= 0.8:
            break
    if elev is not None and np.isfinite(elev).mean() >= 0.8:
        break
if elev is None:
    sys.exit("No elevation source returned data over the AOI.")
elev[elev < -50] = np.nan
write_tif(cfg, ctx / "elevation_m.tif", elev); write_tif(cfg, feat / "elevation.tif", elev)
print(f"elevation: {used}, cover {100 * np.isfinite(elev).mean():.0f}%, "
      f"range {np.nanmin(elev):.1f} to {np.nanmax(elev):.1f} m")

# ---------------- slope, roughness, wetness index ----------------
z = np.where(np.isfinite(elev), elev, np.nanmedian(elev))
gy, gx = np.gradient(z, dy, dx)
slope = np.degrees(np.arctan(np.hypot(gx, gy)))
mean = ndimage.uniform_filter(z, 3); sq = ndimage.uniform_filter(z ** 2, 3)
rough = np.sqrt(np.clip(sq - mean ** 2, 0, None))
# D8 flow accumulation: process cells from high to low, pass area to the steepest lower neighbour
order = np.argsort(-z, axis=None)
acc = np.ones(z.size, dtype="float64")
nbr = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
dist = [np.hypot(dy * a, dx * b) for a, b in nbr]
zf = z.ravel()
for k in order:
    r, c = divmod(int(k), W)
    best, bj = 0.0, -1
    for (a, b), dd in zip(nbr, dist):
        rr, cc = r + a, c + b
        if 0 <= rr < H and 0 <= cc < W:
            drop = (zf[k] - zf[rr * W + cc]) / dd
            if drop > best:
                best, bj = drop, rr * W + cc
    if bj >= 0:
        acc[bj] += acc[k]
a_spec = acc.reshape(H, W) * dx * dy / np.sqrt(dx * dy)                 # specific catchment area (m)
twi = np.log(a_spec / np.maximum(np.tan(np.radians(slope)), 1e-3))
for name, arr in [("slope", slope), ("roughness", rough), ("wetness_index", twi)]:
    arr = np.where(np.isfinite(elev), arr, np.nan)
    write_tif(cfg, feat / f"{name}.tif", arr); print(f"{name}: median {np.nanmedian(arr):.2f}")

# ---------------- surface water (JRC GSW) ----------------
JRC = "https://storage.googleapis.com/global-surface-water/downloads2021/occurrence/occurrence_140W_70Nv1_4_2021.tif"
occ = warp_to_grid(cfg, JRC, "average")
occ[occ > 100] = np.nan
write_tif(cfg, feat / "water_occurrence.tif", occ)
water = np.nan_to_num(occ) >= 50
d_water = ndimage.distance_transform_edt(~water, sampling=(dy, dx))
write_tif(cfg, feat / "distance_to_water.tif", d_water)
lab, n = ndimage.label(water)
edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
sizes = ndimage.sum(water, lab, range(1, n + 1))
sea_ids = [i for i in edge if sizes[i - 1] > 0.02 * water.size]         # big water bodies touching the edge
sea = np.isin(lab, sea_ids)
d_coast = ndimage.distance_transform_edt(~sea, sampling=(dy, dx))
write_tif(cfg, feat / "distance_to_coast.tif", d_coast)
print(f"water: {100 * water.mean():.0f}% of AOI, sea {100 * sea.mean():.0f}%")

# ---------------- summer NDVI (Sentinel-2) ----------------
if "--skip-ndvi" not in sys.argv:
    import planetary_computer as pc
    cat = Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=pc.sign_inplace)
    stack = []
    for yr in [2025, 2024, 2023]:
        items = cat.search(collections=["sentinel-2-l2a"], bbox=cfg["aoi"]["bbox"],
                           datetime=f"{yr}-07-01/{yr}-08-31", query={"eo:cloud_cover": {"lt": 15}},
                           sortby=[{"field": "eo:cloud_cover", "direction": "asc"}], max_items=3).items()
        for it in items:
            try:
                off = 1000 if float(it.properties.get("s2:processing_baseline", "0")) >= 4 else 0  # L2A offset since 2022
                red = warp_to_grid(cfg, it.assets["B04"].href, "average") - off
                nir = warp_to_grid(cfg, it.assets["B08"].href, "average") - off
                scl = warp_to_grid(cfg, it.assets["SCL"].href, "nearest")
                ok = np.isin(scl, [4, 5, 6, 7])                          # veg, bare, water, unclassified
                nd = np.where(ok, (nir - red) / np.maximum(nir + red, 1), np.nan)
                stack.append(nd); print(f"  NDVI from {it.id} (cloud {it.properties['eo:cloud_cover']:.0f}%)")
            except Exception as e:
                print(f"  skip {it.id}: {e}")
    if stack:
        ndvi = np.nanmedian(np.stack(stack), axis=0)
        write_tif(cfg, feat / "ndvi_summer.tif", ndvi); print(f"ndvi_summer: {len(stack)} scenes")
print("done ->", feat)
