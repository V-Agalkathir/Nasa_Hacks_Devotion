"""Independent check: does radar summer movement match measured ground ice at highway boreholes?

Source: NWT Permafrost Database bulk geotechnical download (NWT Geological Survey; data owner GNWT;
cite the publications listed in Publications.csv). Unzip it to data/raw/boreholes/Result/.

Rule fixed before looking at results (15 Nov 2026):
  ice score per borehole = median gravimetric moisture content (%) of samples in the top 5 m
  (frozen ice-rich silts/clays run far above ~40%); boreholes whose logs mention visible ice in the
  top 5 m are flagged too.
  radar value = summer sinking relative to the airport pad (cm per summer, E_rel x dA, positive = sinks more),
  median of cells within 120 m of the borehole.
  Spearman rho(ice score, radar sinking) over boreholes with both values, n >= 10:
    rho >= 0.4 -> "consistent";  rho <= 0 -> "not consistent";  else "inconclusive".
Output: data/interim/models/borehole_check.json (merged into eval.json and validation.json by export).
"""
from __future__ import annotations

import csv
import json
import re
from collections import defaultdict

import numpy as np
from scipy.stats import spearmanr

from common import ROOT, grid, load_config
from radar_read import cell_utm, read_grid_tif

RAW = ROOT / "data/raw/boreholes/Result"


def rows(name):
    with open(RAW / f"{name}.csv", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def num(v):
    try:
        x = float(v)
        return x if np.isfinite(x) else None
    except (TypeError, ValueError):
        return None


ICE = re.compile(r"\b(ice|icy|vx|vs|vr|vc|ice[- ]rich|excess ice|ground ice)\b", re.I)


def main():
    cfg = load_config()
    w, s, e, n = cfg["aoi"]["bbox"]
    loc = {r["SITE_ID"]: (num(r["LATITUDE"]), num(r["LONGITUDE"]), num(r["SITE_ELEVATION_M"])) for r in rows("Location")}
    inside = {k: v for k, v in loc.items() if v[0] and s <= v[0] <= n and w <= v[1] <= e}
    moist = defaultdict(list)
    for r in rows("TestResults"):
        d, mc = num(r["DEPTH_M"]), num(r["MOISTURE_CONTENT"]) or num(r["NATURAL_MOISTURE_CONT_PERCENT"])
        if r["SITE_ID"] in inside and d is not None and d <= 5 and mc is not None:
            moist[r["SITE_ID"]].append(mc)
    for r in rows("Permafrost"):
        d, mc = num(r["DEPTH_M"]), num(r["FROZEN_MOISTURE_CONTENT"])
        if r["SITE_ID"] in inside and d is not None and d <= 5 and mc is not None:
            moist[r["SITE_ID"]].append(mc)
    excess = defaultdict(list)
    for r in rows("Permafrost"):
        d, ex = num(r["DEPTH_M"]), num(r["EXCESS_ICE"])
        if r["SITE_ID"] in inside and d is not None and d <= 5 and ex is not None:
            excess[r["SITE_ID"]].append(ex)
    icy = defaultdict(bool)
    for r in rows("SoilDescription"):
        d = num(r["DEPTH_M"])
        if r["SITE_ID"] in inside and d is not None and d <= 5 and ICE.search((r["SOIL_DESCRIPTION"] or "") + " " + (r["COMMENTS"] or "")):
            icy[r["SITE_ID"]] = True

    md = ROOT / "data/interim/models"
    ev = json.load(open(md / "eval.json"))
    dA = ev["model_a"]["final"]["dA_med"]
    sink = (read_grid_tif(md / "E_rel.tif") * dA).ravel()          # positive = sinks more than the airport pad
    cls = read_grid_tif(md / "behaviour.tif").ravel()
    x, y = (a.ravel() for a in cell_utm(cfg))
    from pyproj import Transformer
    tf = Transformer.from_crs("EPSG:4326", "EPSG:32608", always_xy=True)
    sites = []
    for sid, (lat, lon, elev) in sorted(inside.items()):
        bx, by = tf.transform(lon, lat)
        near = np.hypot(x - bx, y - by) <= 120
        v = sink[near]
        c = cls[near]
        score = float(np.median(moist[sid])) if moist[sid] else None
        sites.append({"site": sid, "lat": round(lat, 5), "lon": round(lon, 5),
                      "moisture_top5m_median_pct": None if score is None else round(score, 1),
                      "n_samples": len(moist[sid]), "visible_ice_logged_top5m": icy[sid],
                      "excess_ice_top5m_median": None if not excess[sid] else round(float(np.median(excess[sid])), 2),
                      "radar_sinking_cm_per_summer": None if not np.isfinite(v).any() else round(float(np.nanmedian(v)), 2),
                      "radar_class_mode": None if not np.isin(c, [0, 1, 2, 3]).any() else int(np.bincount(c[np.isin(c, [0, 1, 2, 3])].astype(int)).argmax()),
                      "n_cells": int(np.isfinite(v).sum())})
    both = [r for r in sites if r["moisture_top5m_median_pct"] is not None and r["radar_sinking_cm_per_summer"] is not None]
    rho = p = None
    if len(both) >= 10:
        rho, p = spearmanr([r["moisture_top5m_median_pct"] for r in both], [r["radar_sinking_cm_per_summer"] for r in both])
        rho, p = float(rho), float(p)
    status = ("not_available" if rho is None else "consistent" if rho >= 0.4 else "not consistent" if rho <= 0 else "inconclusive")
    icy_s = [r["radar_sinking_cm_per_summer"] for r in sites if r["visible_ice_logged_top5m"] and r["radar_sinking_cm_per_summer"] is not None]
    dry_s = [r["radar_sinking_cm_per_summer"] for r in sites if not r["visible_ice_logged_top5m"] and r["radar_sinking_cm_per_summer"] is not None]
    out = {
        "status": status, "rule": "Spearman rho(top-5 m moisture, radar sinking) >= 0.4 consistent, <= 0 not consistent, n >= 10; fixed before running",
        "n_boreholes_in_area": len(inside), "n_compared": len(both),
        "rho": None if rho is None else round(rho, 3), "p": None if p is None else round(p, 3),
        "radar_sinking_median_icy_logged": None if not icy_s else round(float(np.median(icy_s)), 2), "n_icy": len(icy_s),
        "radar_sinking_median_no_ice_logged": None if not dry_s else round(float(np.median(dry_s)), 2), "n_no_ice": len(dry_s),
        "source": "NWT Permafrost Database bulk geotechnical download (NWT Geological Survey, data owner GNWT): ITH 2013 winter drilling (NWT Open Report 2019-014, doi:10.46887/2019-014) and ITH 2017 embankment drilling (NWT Open Report 2019-016, doi:10.46887/2019-016)",
        "sites": sites,
    }
    json.dump(out, open(md / "borehole_check.json", "w"), indent=1)
    print(json.dumps({k: v for k, v in out.items() if k != "sites"}, indent=1))
    for r in sites:
        print(r)


if __name__ == "__main__":
    main()
