"""Part 1 / step 3: fetch NISAR GUNW pairs for the AOI WITHOUT downloading whole files.

Each GUNW is ~2.5 GB, mostly 20 m wrapped layers we don't use. This script opens the remote HDF5
over HTTPS (range requests via earthaccess) and copies ONLY the AOI window of the 80 m
unwrapped-interferogram layers, coordinates, projection, the incidence-angle cube and the
identification metadata into a small HDF5 with the SAME internal paths:
    data/raw/nisar/<granule>.h5      (fixed 1->2 interface; Part 2 reads it like a full GUNW)
Typical size: a few MB per pair. Skips pairs already on disk (safe to re-run).

Login: Earthdata username + password (asked once, then saved to your netrc by earthaccess).
Usage: python src/fetch_nisar.py [--limit 1]
"""
import csv, sys
import numpy as np, h5py, earthaccess
from pyproj import Transformer
from common import load_config, path

cfg = load_config()
N = cfg["nisar"]
W, S, E, Nn = cfg["aoi"]["bbox"]
rows = [r for r in csv.DictReader(open(path(cfg, "interim") / "granules.csv")) if r["source"] == "NISAR"]
if "--limit" in sys.argv:
    rows = rows[: int(sys.argv[sys.argv.index("--limit") + 1])]
out_dir = path(cfg, "raw", "nisar")
todo = [r for r in rows if not (out_dir / f"{r['id']}.h5").exists()]
print(f"{len(rows)} NISAR pairs listed, {len(todo)} to fetch -> {out_dir}")
if not todo:
    sys.exit()

import os
from pathlib import Path
# CI (GitHub Actions) writes ~/.netrc from secrets; laptops fall back to the interactive prompt.
if (Path.home() / ".netrc").exists() or os.environ.get("CI"):
    earthaccess.login(strategy="netrc")
else:
    earthaccess.login(strategy="interactive", persist=True)
handles = earthaccess.open([r["url"] for r in todo])


def window(x, y, epsg, pad=3):
    """Row/col slice of a grid (1-D x, y coordinate arrays) covering the AOI, padded by a few pixels."""
    tr = Transformer.from_crs(4326, epsg, always_xy=True)
    xs, ys = tr.transform([W, E, W, E, (W + E) / 2, (W + E) / 2], [S, S, Nn, Nn, S, Nn])
    cols = np.where((x >= min(xs)) & (x <= max(xs)))[0]
    rws = np.where((y >= min(ys)) & (y <= max(ys)))[0]
    if cols.size == 0 or rws.size == 0:
        raise ValueError("AOI not inside this granule")
    return (slice(max(rws.min() - pad, 0), min(rws.max() + pad + 1, len(y))),
            slice(max(cols.min() - pad, 0), min(cols.max() + pad + 1, len(x))))


def copy_attrs(src, dst):
    for k, v in src.attrs.items():
        try:
            dst.attrs[k] = v
        except Exception:
            pass


for r, fobj in zip(todo, handles):
    target = out_dir / f"{r['id']}.h5"
    tmp = target.with_suffix(".part")
    try:
        with h5py.File(fobj, "r") as f, h5py.File(tmp, "w") as o:
            g = N["grid_group"]
            x, y = f[f"{g}/xCoordinates"][()], f[f"{g}/yCoordinates"][()]
            epsg = int(np.asarray(f[f"{g}/projection"][()]).ravel()[0])
            rs, cs = window(x, y, epsg)
            for name in N["layers"]:
                d = f[f"{g}/{name}"]
                o.create_dataset(f"{g}/{name}", data=d[rs, cs], compression="gzip"); copy_attrs(d, o[f"{g}/{name}"])
            o.create_dataset(f"{g}/xCoordinates", data=x[cs]); o.create_dataset(f"{g}/yCoordinates", data=y[rs])
            o.create_dataset(f"{g}/projection", data=f[f"{g}/projection"][()]); copy_attrs(f[f"{g}/projection"], o[f"{g}/projection"])
            # incidence angle: coarse 3-D cube (height, y, x) on its own grid -> crop the same AOI
            rg = N["radar_grid"]
            rx, ry = f[f"{rg}/xCoordinates"][()], f[f"{rg}/yCoordinates"][()]
            rrs, rcs = window(rx, ry, epsg, pad=2)
            for name in ["incidenceAngle", "losUnitVectorX", "losUnitVectorY"]:
                o.create_dataset(f"{rg}/{name}", data=f[f"{rg}/{name}"][:, rrs, rcs], compression="gzip")
            o.create_dataset(f"{rg}/heightAboveEllipsoid", data=f[f"{rg}/heightAboveEllipsoid"][()])
            o.create_dataset(f"{rg}/xCoordinates", data=rx[rcs]); o.create_dataset(f"{rg}/yCoordinates", data=ry[rrs])
            # identification + temporal baseline (dates, track, direction, ids)
            f.copy("science/LSAR/identification", o, name="science/LSAR/identification")
            o.create_dataset("science/LSAR/GUNW/metadata/orbit/temporalBaseline",
                             data=f["science/LSAR/GUNW/metadata/orbit/temporalBaseline"][()])
            o.attrs["source_url"] = r["url"]; o.attrs["aoi_bbox"] = cfg["aoi"]["bbox"]; o.attrs["cropped_by"] = "fetch_nisar.py"
            coh = o[f"{g}/HH/coherenceMagnitude"][()]
        tmp.replace(target)
        print(f"OK {r['ref_date']} -> {r['sec_date']}  window {coh.shape}  EPSG:{epsg}  "
              f"coherence>=0.3: {100 * np.mean(coh >= 0.3):.0f}%  ({target.stat().st_size / 1e6:.1f} MB)")
    except Exception as e:
        tmp.unlink(missing_ok=True)
        print(f"FAILED {r['ref_date']} -> {r['sec_date']}: {e}  (re-run to retry)")
