"""Part 1 / step 7: dated shorelines 1947-2025 for the shoreline model (Model C). Needs no radar.

Shoreline definition (all sources): the WATERLINE = boundary between the sea and land on the image date.
Tuk is microtidal (<~0.5 m), so waterline vs. date-of-image tide is a small error compared with
1-2 m/yr retreat. (The bluff edge is sharper on air photos but not visible on 30 m Landsat, so the
waterline is the only definition consistent across all sources.)

Sources (no accounts)
  1947-2004  NRCan National Air Photo Library mosaics, STAC collection "napl-tuktoyaktuk"
             (14 dates, datacube.services.geo.ca), Open Government Licence - Canada.
             Mosaics are NOT co-registered: each is aligned to the 2004 mosaic by phase
             cross-correlation over a land window; the residual shift is recorded as error.
  1985-2016  Landsat Collection 2 Level-2 (5/7/8), Microsoft Planetary Computer, July-Sept, one per year.
  2017-2025  Sentinel-2 L2A, Planetary Computer, July-Sept, one per year.
Method: water index (air photos: darkness; satellites: MNDWI/NDWI) -> Otsu threshold -> keep the sea
(largest water body touching the window edge) -> its boundary = shoreline.
AUTOMATIC EXTRACTION MUST BE CHECKED BY EYE: previews are saved next to the output. Fix or delete bad
lines in data/interim/shoreline/shorelines_reviewed.geojson (Model C prefers it if present).

Outputs
  data/interim/shoreline/shorelines.geojson   one MultiLineString per date:
      date, source, position_error_m, method, registration_shift_m
  data/raw/shoreline/airphotos/<date>.tif      cropped air-photo mosaic (for checking / manual digitising)
  data/interim/shoreline/previews/<date>.png   image + extracted line
Usage: python src/fetch_shorelines.py [--skip-satellite] [--skip-airphotos]
"""
import json, sys
import numpy as np, rasterio
from rasterio.windows import from_bounds as win_from_bounds
from rasterio.warp import transform_bounds
from rasterio.enums import Resampling
from pyproj import Transformer
from scipy import ndimage
from skimage.filters import threshold_otsu
from skimage.measure import find_contours
from pystac_client import Client
from common import load_config, path

cfg = load_config()
COAST = cfg.get("shoreline", {}).get("window", [-133.12, 69.41, -132.94, 69.48])   # town, the Point, Tuk Island
RES_M = 5.0                                                                       # working resolution for air photos
raw = path(cfg, "raw", "shoreline", "airphotos"); out = path(cfg, "interim", "shoreline"); prev = path(cfg, "interim", "shoreline", "previews")


def read_window(href, res_m=None, bands=(1,), resampling=Resampling.average):
    """Read the coastal window from a remote COG, optionally decimated to ~res_m metres."""
    with rasterio.open(href) as src:
        b = transform_bounds("EPSG:4326", src.crs, *COAST, densify_pts=21)
        win = win_from_bounds(*b, src.transform).round_offsets().round_lengths()
        scale = 1.0
        if res_m:
            scale = max(1.0, res_m / abs(src.res[0]))
        shape = (len(bands), max(1, int(win.height / scale)), max(1, int(win.width / scale)))
        data = src.read(list(bands), window=win, out_shape=shape, resampling=resampling, boundless=True).astype("float32")
        t = src.window_transform(win) * rasterio.Affine.scale(win.width / shape[2], win.height / shape[1])
        if src.nodata is not None:
            data[data == src.nodata] = np.nan
        return data, t, src.crs


def sea_line(water_index, t, crs, dark_is_water=False):
    """Threshold a water index, keep the sea, return its boundary as lon/lat lines."""
    v = water_index[np.isfinite(water_index)]
    thr = threshold_otsu(v)
    water = (water_index < thr) if dark_is_water else (water_index > thr)
    water = ndimage.binary_opening(np.nan_to_num(water).astype(bool), iterations=2)
    lab, n = ndimage.label(water)
    if n == 0:
        return [], water
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    if not edge:
        return [], water
    sizes = ndimage.sum(water, lab, list(edge))
    sea = lab == list(edge)[int(np.argmax(sizes))]
    sea = ndimage.binary_fill_holes(sea)
    to_ll = Transformer.from_crs(crs, 4326, always_xy=True)
    lines = []
    for c in find_contours(sea.astype(float), 0.5):
        if len(c) < 20:          # drop specks
            continue
        xs, ys = rasterio.transform.xy(t, c[:, 0], c[:, 1])
        lon, lat = to_ll.transform(xs, ys)
        lines.append([[round(a, 6), round(b, 6)] for a, b in zip(lon, lat)])
    return lines, sea


def preview(img, sea, name):
    try:
        import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(6, 6)); ax.imshow(img, cmap="gray"); ax.contour(sea, [0.5], colors="r", linewidths=0.6)
        ax.set_title(name); ax.axis("off"); fig.savefig(prev / f"{name}.png", dpi=90, bbox_inches="tight"); plt.close(fig)
    except Exception as e:
        print("  preview failed:", e)


def phase_shift(ref, img):
    """Translation (rows, cols) that aligns img to ref, by FFT phase correlation."""
    a = np.nan_to_num(ref - np.nanmean(ref)); b = np.nan_to_num(img - np.nanmean(img))
    h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1]); a, b = a[:h, :w], b[:h, :w]
    F = np.fft.fft2(a) * np.conj(np.fft.fft2(b)); F /= np.maximum(np.abs(F), 1e-9)
    r = np.abs(np.fft.ifft2(F)); dy, dx = np.unravel_index(np.argmax(r), r.shape)
    return (dy - h if dy > h // 2 else dy), (dx - w if dx > w // 2 else dx)


features = []

# ---------------- air photos 1947-2004 ----------------
if "--skip-airphotos" not in sys.argv:
    stac = Client.open("https://datacube.services.geo.ca/stac/api")
    items = sorted(stac.search(collections=["napl-tuktoyaktuk"], max_items=50).items(), key=lambda i: i.datetime)
    seen = {}
    for it in items:                       # one mosaic per date: prefer the finer scale (smaller "Nk")
        d = it.datetime.date().isoformat(); k = int(it.id.split("-")[-1].rstrip("k"))
        if d not in seen or k < seen[d][0]:
            seen[d] = (k, it)
    print(f"air photos: {len(seen)} dates")
    ref = None
    for d in sorted(seen, reverse=True):   # 2004 first = registration reference
        _, it = seen[d]
        try:
            data, t, crs = read_window(it.assets["mosaic"].href, RES_M)
            img = data[0]
            with rasterio.open(raw / f"{d}.tif", "w", driver="GTiff", height=img.shape[0], width=img.shape[1], count=1,
                               dtype="float32", crs=crs, transform=t, compress="deflate") as dst:
                dst.write(img, 1)
            shift_m = 0.0
            if ref is None:
                ref = (img, t)
            else:
                ry, rx = phase_shift(ref[0], img)
                if abs(ry) < 60 and abs(rx) < 60:   # accept plausible shifts only (<300 m)
                    t = t * rasterio.Affine.translation(-rx, -ry)
                    shift_m = float(np.hypot(rx, ry) * RES_M)
            lines, sea = sea_line(img, t, crs, dark_is_water=True)
            # error = working pixel + mosaic georeferencing (~10 m, unconfirmed) + residual registration uncertainty
            err = round(float(np.sqrt(RES_M ** 2 + 10.0 ** 2 + (0.2 * shift_m) ** 2)), 1)
            features.append({"type": "Feature", "geometry": {"type": "MultiLineString", "coordinates": lines},
                             "properties": {"date": d, "source": f"NRCan NAPL air photo mosaic ({it.id})", "method": "auto-otsu-darkness",
                                            "registration_shift_m": round(shift_m, 1), "position_error_m": err}})
            preview(img, sea, d); print(f"  {d}: {len(lines)} line(s), shift {shift_m:.0f} m, error ~{err} m")
        except Exception as e:
            print(f"  {d}: FAILED ({e})")

# ---------------- satellites 1985-2025 ----------------
if "--skip-satellite" not in sys.argv:
    import planetary_computer as pc
    cat = Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=pc.sign_inplace)
    for yr in range(1985, 2026):
        coll = "sentinel-2-l2a" if yr >= 2017 else "landsat-c2-l2"
        q = {"eo:cloud_cover": {"lt": 20}}
        if coll == "landsat-c2-l2":
            q["platform"] = {"in": ["landsat-5", "landsat-8"]}   # skip Landsat 7 (scan-line gaps after 2003)
        items = list(cat.search(collections=[coll], bbox=COAST, datetime=f"{yr}-07-01/{yr}-09-15", query=q,
                                sortby=[{"field": "eo:cloud_cover", "direction": "asc"}], max_items=3).items())
        if not items:
            print(f"  {yr}: no clear scene"); continue
        it = items[0]
        try:
            if coll == "sentinel-2-l2a":
                g, *_ = read_window(it.assets["B03"].href); s, t, crs = read_window(it.assets["B11"].href)
                g = ndimage.zoom(g[0], (s.shape[1] / g.shape[1], s.shape[2] / g.shape[2]), order=1); s = s[0]
                err = 10.0
            else:
                gk = "green"; sk = "swir16"
                g, t, crs = read_window(it.assets[gk].href); s, *_ = read_window(it.assets[sk].href); g, s = g[0], s[0]
                err = 15.0
            mndwi = (g - s) / np.maximum(g + s, 1e-6)
            lines, sea = sea_line(mndwi, t, crs)
            if not lines:
                print(f"  {yr}: no shoreline found"); continue
            features.append({"type": "Feature", "geometry": {"type": "MultiLineString", "coordinates": lines},
                             "properties": {"date": it.datetime.date().isoformat(), "source": f"{coll} {it.id}",
                                            "method": "auto-otsu-mndwi", "registration_shift_m": 0.0, "position_error_m": err}})
            preview(mndwi, sea, it.datetime.date().isoformat()); print(f"  {yr}: {it.id} ({it.properties['eo:cloud_cover']:.0f}% cloud)")
        except Exception as e:
            print(f"  {yr}: FAILED ({e})")

features.sort(key=lambda f: f["properties"]["date"])
fc = {"type": "FeatureCollection",
      "note": "Waterline shorelines, auto-extracted; check previews/ and save fixes as shorelines_reviewed.geojson",
      "features": features}
json.dump(fc, open(out / "shorelines.geojson", "w"))
dates = [f["properties"]["date"] for f in features]
print(f"wrote {out / 'shorelines.geojson'}: {len(dates)} dates ({dates[0] if dates else '-'} .. {dates[-1] if dates else '-'})")
print(f"pre-1986 dates for the hindcast fit: {sum(d < '1986' for d in dates)}  (need >= 3)")
