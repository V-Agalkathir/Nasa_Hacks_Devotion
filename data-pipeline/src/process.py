"""Step 3 — turn interferograms into ONE cumulative-displacement GeoTIFF per thaw season (cm, EPSG:4326, AOI grid).
  NISAR GUNW (.h5)   -> unwrapped phase -> line-of-sight displacement
  Sentinel-1 HyP3    -> *_los_disp.tif (metres) already provided
Season cumulative = sum of consecutive pairs in that season.
Output: data/interim/disp_<season>.tif     Usage: python src/process.py
NOTE sign convention: we output NEGATIVE = ground moving away from satellite (≈ subsidence). Verify on one pair.
"""
import glob
import numpy as np
import h5py
import rasterio
from rasterio.transform import from_origin, from_bounds
from rasterio.warp import reproject, Resampling
from rasterio.crs import CRS
from common import load_config, path

cfg = load_config()
W, S, E, N = cfg["aoi"]["bbox"]
res = cfg["processing"]["grid_res_deg"]
width, height = int((E - W) / res), int((N - S) / res)
dst_transform = from_bounds(W, S, E, N, width, height)
dst_crs = CRS.from_epsg(4326)
min_coh = cfg["processing"]["min_coherence"]


def to_grid(arr, src_transform, src_crs):
    out = np.full((height, width), np.nan, dtype="float32")
    reproject(arr.astype("float32"), out, src_transform=src_transform, src_crs=src_crs,
              dst_transform=dst_transform, dst_crs=dst_crs, resampling=Resampling.bilinear,
              src_nodata=np.nan, dst_nodata=np.nan)
    return out


def nisar_pair_cm(fp):
    n = cfg["nisar"]
    with h5py.File(fp, "r") as f:
        phase = f[n["unwrapped_phase_path"]][()]
        coh = f[n["coherence_path"]][()]
        x, y = f[n["x_path"]][()], f[n["y_path"]][()]
        epsg = int(np.asarray(f[n["epsg_path"]][()]).ravel()[0])
    disp_cm = -phase * n["wavelength_m"] / (4 * np.pi) * 100
    disp_cm[coh < min_coh] = np.nan
    tr = from_origin(x[0], y[0], x[1] - x[0], y[0] - y[1])
    return to_grid(disp_cm, tr, CRS.from_epsg(epsg)), str(fp)


def s1_pair_cm(fp):
    with rasterio.open(fp) as src:
        d = src.read(1).astype("float32") * 100
        if src.nodata is not None:
            d[d == src.nodata] = np.nan
        return to_grid(d, src.transform, src.crs), str(fp)


raw = path(cfg, "raw")
for s in cfg["seasons"]:
    y0, y1 = s["start"].replace("-", ""), s["end"].replace("-", "")
    if s["source"] == "NISAR":
        files = sorted(glob.glob(str(raw / "*GUNW*.h5")))
        pairs = [nisar_pair_cm(f) for f in files if s["id"] in f]   # crude season filter by year in filename
    else:
        files = sorted(glob.glob(str(raw / "s1" / "**" / "*los_disp.tif"), recursive=True))
        pairs = [s1_pair_cm(f) for f in files if f"_{s['id']}" in f]
    if not pairs:
        print(f"[{s['id']}] no files found — skipping"); continue
    stack = np.stack([p[0] for p in pairs])
    cum = np.nansum(stack, axis=0)
    cum[np.all(np.isnan(stack), axis=0)] = np.nan
    out = path(cfg, "interim") / f"disp_{s['id']}.tif"
    with rasterio.open(out, "w", driver="GTiff", height=height, width=width, count=1, dtype="float32",
                       crs=dst_crs, transform=dst_transform, nodata=np.nan, compress="deflate") as dst:
        dst.write(cum, 1)
    print(f"[{s['id']}] {len(pairs)} pairs -> {out}  (min {np.nanmin(cum):.1f} cm, max {np.nanmax(cum):.1f} cm)")
