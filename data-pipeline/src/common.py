"""Shared helpers: config, paths, AOI geometry."""
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]


def load_config():
    with open(ROOT / "config.yaml") as f:
        return yaml.safe_load(f)


def path(cfg, key, *sub):
    p = (ROOT / cfg["paths"][key]).resolve().joinpath(*sub)
    p.mkdir(parents=True, exist_ok=True)
    return p


def aoi_wkt(cfg):
    w, s, e, n = cfg["aoi"]["bbox"]
    return f"POLYGON(({w} {s},{e} {s},{e} {n},{w} {n},{w} {s}))"


# ---------- shared grid (fixed interface: config aoi.bbox + processing.grid_res_deg, EPSG:4326) ----------
def grid(cfg):
    """Return (transform, height, width) of the shared output grid."""
    from rasterio.transform import from_bounds
    w, s, e, n = cfg["aoi"]["bbox"]
    res = cfg["processing"]["grid_res_deg"]
    width, height = round((e - w) / res), round((n - s) / res)
    return from_bounds(w, s, e, n, width, height), height, width


def write_tif(cfg, out_path, arr, nodata=float("nan"), dtype="float32"):
    """Write a single-band GeoTIFF on the shared grid (COG-friendly: tiled + deflate)."""
    import rasterio
    tr, h, w = grid(cfg)
    assert arr.shape == (h, w), f"array {arr.shape} != grid {(h, w)}"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out_path, "w", driver="GTiff", height=h, width=w, count=1, dtype=dtype,
                       crs="EPSG:4326", transform=tr, nodata=nodata, compress="deflate",
                       tiled=True, blockxsize=256, blockysize=256) as dst:
        dst.write(arr.astype(dtype), 1)
    return out_path


def warp_to_grid(cfg, src_path_or_url, resampling="bilinear", band=1):
    """Read any raster (local path or https URL, read by window) and resample onto the shared grid."""
    import numpy as np, rasterio
    from rasterio.warp import reproject, Resampling, transform_bounds
    from rasterio.windows import from_bounds as win_from_bounds
    tr, h, w = grid(cfg)
    src_name = f"/vsicurl/{src_path_or_url}" if str(src_path_or_url).startswith("http") else str(src_path_or_url)
    with rasterio.open(src_name) as src:
        b = transform_bounds("EPSG:4326", src.crs, *cfg["aoi"]["bbox"], densify_pts=21)
        pad = 10 * max(abs(src.res[0]), abs(src.res[1]))
        win = win_from_bounds(b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad, src.transform).round_offsets().round_lengths()
        data = src.read(band, window=win, boundless=True, fill_value=src.nodata if src.nodata is not None else 0).astype("float32")
        if src.nodata is not None:
            data[data == src.nodata] = np.nan
        out = np.full((h, w), np.nan, "float32")
        reproject(data, out, src_transform=src.window_transform(win), src_crs=src.crs, dst_transform=tr,
                  dst_crs="EPSG:4326", resampling=getattr(Resampling, resampling), src_nodata=np.nan, dst_nodata=np.nan)
    return out
