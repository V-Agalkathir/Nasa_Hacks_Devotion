"""Part 2: readers for Sentinel-1 HyP3 pairs and NISAR GUNW pairs, plus shared-grid helpers.

Everything returned is on the shared grid (common.grid(), EPSG:4326, 900 x 560).
See docs/architecture/specs/02-radar-processing.md (sections 1, 2, 9).
"""
from __future__ import annotations

import glob
import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

from common import ROOT, grid

FOUR_PI = 4.0 * np.pi


# ---------------------------------------------------------------- grid helpers
def warp_array(cfg, arr, src_transform, src_crs, resampling="bilinear", min_valid=0.99):
    """Warp a float array (NaN = missing) onto the shared grid without letting NaN edges bleed.

    Value and validity are warped separately; a target cell is kept only where the warped
    validity is >= min_valid (spec 02 section 9). Nearest resampling skips the validity step.
    """
    tr, h, w = grid(cfg)
    arr = np.asarray(arr, dtype="float32")
    if resampling == "nearest":
        out = np.full((h, w), np.nan, "float32")
        reproject(arr, out, src_transform=src_transform, src_crs=src_crs, dst_transform=tr,
                  dst_crs="EPSG:4326", resampling=Resampling.nearest, src_nodata=np.nan, dst_nodata=np.nan)
        return out
    valid = np.isfinite(arr).astype("float32")
    filled = np.where(valid > 0, arr, 0).astype("float32")
    out = np.zeros((h, w), "float32")
    vout = np.zeros((h, w), "float32")
    rs = getattr(Resampling, resampling)
    reproject(filled, out, src_transform=src_transform, src_crs=src_crs, dst_transform=tr,
              dst_crs="EPSG:4326", resampling=rs, init_dest_nodata=False)
    reproject(valid, vout, src_transform=src_transform, src_crs=src_crs, dst_transform=tr,
              dst_crs="EPSG:4326", resampling=rs, init_dest_nodata=False)
    res = np.full((h, w), np.nan, "float32")
    ok = vout >= min_valid
    res[ok] = out[ok] / vout[ok]
    return res


def read_tif(path, nodata_zero=False):
    with rasterio.open(path) as src:
        a = src.read(1).astype("float32")
        if src.nodata is not None and not np.isnan(src.nodata):
            a[a == src.nodata] = np.nan
        if nodata_zero:
            a[a == 0] = np.nan
        return a, src.transform, src.crs


def read_grid_tif(path):
    """Read a raster already on the shared grid."""
    with rasterio.open(path) as src:
        a = src.read(1).astype("float32")
        if src.nodata is not None and not np.isnan(src.nodata):
            a[a == src.nodata] = np.nan
    return a


def cell_centres(cfg):
    """lon, lat arrays (H, W) of cell centres."""
    tr, h, w = grid(cfg)
    cols, rows = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    lon = tr.c + cols * tr.a
    lat = tr.f + rows * tr.e
    return lon, lat


def cell_utm(cfg):
    """UTM 8N (EPSG:32608) x, y in metres of every cell centre (H, W)."""
    from pyproj import Transformer
    lon, lat = cell_centres(cfg)
    t = Transformer.from_crs("EPSG:4326", "EPSG:32608", always_xy=True)
    x, y = t.transform(lon, lat)
    return np.asarray(x), np.asarray(y)


def rasterize_geojson(cfg, features, buffer_m=0.0, all_touched=False):
    """Rasterize GeoJSON features (EPSG:4326) onto the grid, optional buffer in metres."""
    from shapely.geometry import shape, mapping
    from shapely.ops import transform as stransform
    from pyproj import Transformer
    tr, h, w = grid(cfg)
    fwd = Transformer.from_crs("EPSG:4326", "EPSG:32608", always_xy=True).transform
    inv = Transformer.from_crs("EPSG:32608", "EPSG:4326", always_xy=True).transform
    geoms = []
    for f in features:
        g = shape(f["geometry"])
        if buffer_m:
            g = stransform(inv, stransform(fwd, g).buffer(buffer_m))
        geoms.append(mapping(g))
    if not geoms:
        return np.zeros((h, w), bool)
    return rasterize([(g, 1) for g in geoms], out_shape=(h, w), transform=tr, fill=0,
                     all_touched=all_touched, dtype="uint8").astype(bool)


# ---------------------------------------------------------------- pairs
@dataclass
class Pair:
    stack_id: str
    sensor: str
    band: str
    ref: date
    sec: date
    path: str
    pid: str
    extra: dict = field(default_factory=dict)

    @property
    def days(self):
        return (self.sec - self.ref).days

    @property
    def season(self):
        return self.ref.year


S1_RE = re.compile(r"(S1[A-D]{2})_(\d{8})T\d{6}_(\d{8})T\d{6}_")
NISAR_RE = re.compile(r"NISAR_L2_(PR|UR)_GUNW_.*?_(\d{8})T\d{6}_\d{8}T\d{6}_(\d{8})T\d{6}_\d{8}T\d{6}_.*?_(\d{3})\.h5$")


def _d(s):
    return datetime.strptime(s, "%Y%m%d").date()


def inventory_s1(cfg, stack_id="s1_p137"):
    raw = ROOT / cfg["paths"]["raw"] / "s1"
    pairs = {}
    for p in sorted(glob.glob(str(raw / "**" / "*_unw_phase.tif"), recursive=True)):
        m = S1_RE.search(Path(p).name)
        if not m:
            continue
        pr = Pair(stack_id, "Sentinel-1", "C", _d(m.group(2)), _d(m.group(3)), p,
                  Path(p).name.replace("_unw_phase.tif", ""), {"platforms": m.group(1)})
        pr.extra["cross_platform"] = m.group(1)[2] != m.group(1)[3]
        key = (pr.ref, pr.sec)
        pairs.setdefault(key, pr)
    return sorted(pairs.values(), key=lambda q: (q.ref, q.sec))


def inventory_nisar(cfg, stack_id="nisar_t159"):
    raw = ROOT / cfg["paths"]["raw"] / "nisar"
    pref = cfg["nisar"].get("version_preference", ["PR", "UR"])
    best, dropped = {}, {}
    for p in sorted(glob.glob(str(raw / "*.h5"))):
        m = NISAR_RE.search(Path(p).name)
        if not m:
            continue
        typ, d1, d2, ver = m.group(1), _d(m.group(2)), _d(m.group(3)), int(m.group(4))
        rank = (-pref.index(typ) if typ in pref else -99, ver)
        key = (d1, d2)
        pr = Pair(stack_id, "NISAR", "L", d1, d2, p, Path(p).stem, {"rank": rank})
        if key in best:
            loser = min(best[key], pr, key=lambda q: q.extra["rank"])
            winner = best[key] if loser is pr else pr
            dropped.setdefault(key, []).append(loser.pid)
            best[key] = winner
        else:
            best[key] = pr
    out = sorted(best.values(), key=lambda q: (q.ref, q.sec))
    for q in out:
        q.extra["dropped_duplicates"] = dropped.get((q.ref, q.sec), [])
    return out


# ---------------------------------------------------------------- readers
def read_s1_pair(cfg, pr: Pair):
    """Return dict of grid arrays: phase (rad), coh, theta (rad, incidence), los_disp_m (HyP3, sign check)."""
    base = pr.path.replace("_unw_phase.tif", "")
    ph, t, crs = read_tif(pr.path, nodata_zero=True)
    out = {"phase": warp_array(cfg, ph, t, crs)}
    coh, t2, c2 = read_tif(base + "_corr.tif", nodata_zero=True)
    out["coh"] = warp_array(cfg, coh, t2, c2)
    lvt, t3, c3 = read_tif(base + "_lv_theta.tif", nodata_zero=True)
    out["theta"] = warp_array(cfg, (np.pi / 2 - lvt).astype("float32"), t3, c3)
    if Path(base + "_los_disp.tif").exists():
        ld, t4, c4 = read_tif(base + "_los_disp.tif", nodata_zero=True)
        out["los_disp_m"] = warp_array(cfg, ld, t4, c4)
    # native-grid copies for the HyP3 sign regression (avoids resampling effects)
    out["_native"] = {"phase": ph, "coh": coh}
    if Path(base + "_los_disp.tif").exists():
        out["_native"]["los_disp_m"] = ld
    return out


def _nisar_group(h, cfg):
    g = cfg["nisar"]["grid_group"]
    if "xCoordinates" in h[g]:
        return g, g
    return g, g + "/HH"


def read_nisar_pair(cfg, pr: Pair, apply_iono=True, iono_sign=1):
    import h5py
    with h5py.File(pr.path, "r") as h:
        g, cg = _nisar_group(h, cfg)
        x = h[cg + "/xCoordinates"][()]
        y = h[cg + "/yCoordinates"][()]
        epsg = int(np.asarray(h[cg + "/projection"][()]).item())
        ph = h[g + "/HH/unwrappedPhase"][()].astype("float32")
        coh = h[g + "/HH/coherenceMagnitude"][()].astype("float32")
        cc = h[g + "/HH/connectedComponents"][()].astype("float32")
        iono = h[g + "/HH/ionospherePhaseScreen"][()].astype("float32")
        rg = cfg["nisar"]["radar_grid"]
        inc = h[rg + "/incidenceAngle"][()]
        hae = h[rg + "/heightAboveEllipsoid"][()]
        rx = h[rg + "/xCoordinates"][()]
        ry = h[rg + "/yCoordinates"][()]
    dx, dy = x[1] - x[0], y[0] - y[1]
    tr = from_origin(x[0] - dx / 2, y[0] + dy / 2, dx, dy)
    crs = f"EPSG:{epsg}"
    cc[(cc == 255)] = np.nan
    iono_cov = float(np.isfinite(iono).mean())
    phase_raw = ph.copy()
    if apply_iono and iono_cov >= 0.9:
        ph = ph - iono_sign * np.nan_to_num(iono)
    # incidence at the ellipsoid height closest to 0 m (Tuk is near sea level)
    k = int(np.argmin(np.abs(hae - 0.0)))
    inc0 = inc[k].astype("float32")
    rdx, rdy = rx[1] - rx[0], ry[0] - ry[1]
    rtr = from_origin(rx[0] - rdx / 2, ry[0] + rdy / 2, rdx, rdy)
    out = {
        "phase": warp_array(cfg, ph, tr, crs),
        "phase_raw": warp_array(cfg, phase_raw, tr, crs),
        "coh": warp_array(cfg, coh, tr, crs),
        "cc": warp_array(cfg, cc, tr, crs, resampling="nearest"),
        "iono": warp_array(cfg, iono, tr, crs),
        "theta": np.deg2rad(warp_array(cfg, inc0, rtr, crs, min_valid=0.5)),
        "iono_coverage": iono_cov,
        "epsg": epsg,
    }
    return out


# ---------------------------------------------------------------- reference & masks
def reference_mask(cfg):
    """Airport gravel (runway buffered 30 m + apron), spec 02 section 4."""
    p = ROOT / "data/interim/context/aeroway.geojson"
    feats = [f for f in json.load(open(p))["features"]
             if f["properties"].get("aeroway") in ("runway", "apron", "taxiway")]
    m = rasterize_geojson(cfg, feats, buffer_m=30.0)
    return m


def water_mask(cfg, occ_min=50):
    from scipy import ndimage
    feat = ROOT / "data/interim/features"
    occ = read_grid_tif(feat / "water_occurrence.tif")
    dco = read_grid_tif(feat / "distance_to_coast.tif")
    water = (occ >= occ_min) | (dco <= 0)
    osm = ROOT / "data/interim/context/water.geojson"
    if osm.exists():
        polys = [f for f in json.load(open(osm))["features"] if f["geometry"]["type"] == "Polygon"]
        water |= rasterize_geojson(cfg, polys)
    water = ndimage.binary_dilation(water, iterations=1)
    return water
