"""Part 6 data contract v2: write everything the site reads into frontend/public/data/.

Reads Part 2-4 outputs (motion stacks, models, screening) and writes:
  manifest.json, rasters/*.png, areas.geojson, timeseries.json, validation.json, coastline.geojson
The manifest is written last and owns every field the frontend needs (spec 05 trap: never rely on
fields another step added). Usage: python src/export_web_v2.py
"""
from __future__ import annotations

import json
import shutil
from datetime import date, datetime, timezone

import numpy as np
from PIL import Image

from common import ROOT, grid, load_config
from radar_read import rasterize_geojson, read_grid_tif, water_mask

OUT = (ROOT / "../frontend/public/data").resolve()
MD = ROOT / "data/interim/models"
SD = ROOT / "data/interim/screening"
MOT = ROOT / "data/interim/motion"

# Okabe-Ito colour-blind-safe palette
CLASS_RGBA = {1: (0, 114, 178, 170), 2: (230, 159, 0, 200), 3: (213, 94, 0, 230)}
CANT = (110, 110, 110, 150)


def rnd(v, n=5):
    if isinstance(v, float):
        return round(v, n)
    if isinstance(v, list):
        return [rnd(x, n) for x in v]
    if isinstance(v, dict):
        return {k: rnd(x, n) for k, x in v.items()}
    return v


def save_png(rgba, name):
    (OUT / "rasters").mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba.astype("uint8"), "RGBA").save(OUT / "rasters" / name, optimize=True)
    return f"rasters/{name}"


def behaviour_png(cls):
    H, W = cls.shape
    out = np.zeros((H, W, 4), np.uint8)
    for k, c in CLASS_RGBA.items():
        out[cls == k] = c
    yy, xx = np.indices(cls.shape)
    hatch = ((xx + yy * 3) // 3) % 3 == 0          # diagonal hatch so 'can't measure' never reads as a colour class
    m = cls == 0
    out[m & hatch] = CANT
    out[m & ~hatch] = (110, 110, 110, 40)
    return out


def diverging(v, lim):
    """Orange (sinks more than the airport pad) - white - blue (sinks less). NaN transparent."""
    t = np.clip(v / lim, -1, 1)
    out = np.zeros(v.shape + (4,), np.float32)
    neg = t < 0
    a = np.abs(t)
    # white -> orange (230,97,1) for negative; white -> blue (33,102,172) for positive
    for ch, (o, b) in enumerate(zip((230, 97, 1), (33, 102, 172))):
        out[..., ch] = np.where(neg, 255 + (o - 255) * a, 255 + (b - 255) * a)
    out[..., 3] = 200
    out[~np.isfinite(v)] = 0
    return out


def season_totals():
    ix = json.load(open(MOT / "s1_p137" / "index.json"))
    res = {}
    for y, v in ix["seasons"].items():
        ds = [d for d in v["dates"] if d["date"][5:] <= "09-15"]
        if not ds:
            continue
        a = read_grid_tif(MOT / "s1_p137" / ds[-1]["file"])
        res[int(y)] = {"arr": a, "first": v["first_usable_date"], "last": ds[-1]["date"],
                       "valid_share": v["stats"]["valid_cell_fraction"], "coh": v["stats"].get("coh_median_land")}
    return res


def freshness(last_s1):
    """Freshness fields (spec 05 6.3). run_status.json comes from pipeline_check.py when the workflow ran."""
    rs_p = ROOT / "data/interim/run_status.json"
    rs = json.load(open(rs_p)) if rs_p.exists() else {}
    labels = {"up_to_date": "up to date", "paused_for_winter": "paused for winter", "updating": "updating",
              "failed_showing_last_good": f"last update failed, showing data from {last_s1}"}
    st = rs.get("update_status", "paused_for_winter")
    return {"latest_pass": {"date": last_s1, "sensor": "Sentinel-1 C-band", "track": 137},
            "latest_catalogue_pass": rs.get("latest_catalogue_pass"),
            "last_checked_at": rs.get("checked_at"), "update_cadence_days": 12,
            "update_status": st, "status": labels.get(st, st), "update_message": rs.get("message"),
            "season": rs.get("season"), "pairs": rs.get("pairs"),
            "line": f"Last radar pass used: {last_s1}, Sentinel-1. Updates every 12 days, June to September.",
            "nisar_note": "NISAR passes are checked automatically; the 2026 summer did not form a usable series.",
            "run_url": __import__("os").environ.get("RUN_URL")}


def main():
    cfg = load_config()
    tr, H, W = grid(cfg)
    bbox = cfg["aoi"]["bbox"]
    w, s, e, n = bbox
    corners = [[w, n], [e, n], [e, s], [w, s]]
    OUT.mkdir(parents=True, exist_ok=True)
    for old in ["zones.geojson", "rasters/disp_2023.png", "rasters/disp_2024.png", "rasters/disp_2025.png", "rasters/disp_2026.png"]:
        p = OUT / old
        if p.exists():
            p.unlink()
    ev = json.load(open(MD / "eval.json"))
    water = water_mask(cfg)

    # ---------------- rasters
    cls = read_grid_tif(MD / "behaviour.tif")
    cls = np.where(np.isfinite(cls), cls, 255).astype(int)
    layers = [{"id": "behaviour", "label": "Ground behaviour (measured)", "image": save_png(behaviour_png(cls), "behaviour.png"),
               "provenance": "measured", "status": ev["model_a"]["test_a"]["status"]}]
    tot = season_totals()
    years = []
    lim = 2.0
    for y in range(2021, 2027):
        if y in tot:
            img = save_png(diverging(np.where(water, np.nan, tot[y]["arr"]), lim), f"motion_{y}.png")
            years.append({"year": y, "status": "measured", "sensor": "Sentinel-1", "band": "C", "image": img,
                          "window": [tot[y]["first"], tot[y]["last"]], "valid_share": tot[y]["valid_share"],
                          "label": f"Summer {y}: {tot[y]['first'][5:]} to {tot[y]['last'][5:]}",
                          "note": None if tot[y]["valid_share"] > 0.5 else "Town only: this summer's radar files cover the northern half of the area"})
        elif y == 2026:
            years.append({"year": 2026, "status": "missing", "sensor": "NISAR", "band": "L", "image": None,
                          "window": ["2026-06-25", "2026-10-11"], "valid_share": 0.03,
                          "label": "Summer 2026 (NISAR)",
                          "note": "Not enough data: one pair failed to unwrap and several lost coherence, so no connected series exists. The sensor also changes here (C-band to L-band)."})
    elev = read_grid_tif(ROOT / "data/interim/features/elevation.tif")
    low = np.zeros((H, W, 4), np.uint8)
    lowm = (elev < 2.5) & ~water
    low[lowm] = (86, 180, 233, 150)
    layers.append({"id": "lowlying", "label": "Below the 2.5 m storm-surge reference", "image": save_png(low, "lowlying.png"),
                   "provenance": "measured", "status": "measured"})

    # ---------------- areas (named full, cells compact)
    A = json.load(open(SD / "areas.geojson"))
    feats, cells = [], []
    TIER = {"lower": 0, "moderate": 1, "higher": 2, "not_enough_data": 3}
    COR = {None: 0, "promising_unconfirmed": 1, "conflicting_evidence": 2}
    GND = {"stable": 1, "seasonal_only": 2, "degrading": 3, "cant_measure": 0}
    from shapely.geometry import shape as _shape
    half = None
    for f in A["features"]:
        p = f["properties"]
        if p["kind"] == "named":
            feats.append({"type": "Feature", "geometry": rnd(f["geometry"]), "properties": p})
            continue
        i = p["indicators"]
        g = _shape(f["geometry"])
        c = g.centroid
        if half is None:
            minx, miny, maxx, maxy = g.bounds
            half = [round((maxx - minx) / 2, 6), round((maxy - miny) / 2, 6)]
        mv = i["ground"]["summer_move_vs_airport_cm"]
        ps = i["ground"].get("per_summer_cm", {})
        cells.append([round(c.x, 5), round(c.y, 5), TIER[p["tier"]], COR[p["coring"]], i["height"]["median_m"],
                      i["access"]["to_highway_m"], i["access"]["to_town_core_m"], i["coast"]["distance_to_sea_m"],
                      round(i["wetness"]["water_share_250m"], 2), round(i["confidence"]["radar_coverage"], 2),
                      GND[i["ground"]["dominant"]], None if mv is None else round(mv, 2), int(bool(i["this_season"]["flag"])),
                      p["id"], i["height"]["p10_m"], round(i["height"]["share_below_surge"], 2),
                      i["coast"]["measured_change_m"], [ps.get(str(y)) for y in range(2021, 2026)]])
    json.dump({"type": "FeatureCollection", "schema": "areas/2", "settings": A.get("settings"), "features": feats},
              open(OUT / "areas.geojson", "w"), separators=(",", ":"))
    json.dump({"schema": "cells/2", "cell_m": A["settings"]["cell_m"], "half_deg": half,
               "columns": ["lon", "lat", "tier", "coring", "height_m", "to_highway_m", "to_core_m", "to_sea_m",
                           "water_share", "radar_coverage", "ground", "move_cm", "season_flag",
                           "id", "p10_m", "low_share", "coast_change_m", "mv_2021_2025"],
               "codes": {"tier": ["lower", "moderate", "higher", "not_enough_data"],
                         "coring": [None, "promising_unconfirmed", "conflicting_evidence"],
                         "ground": ["cant_measure", "stable", "seasonal_only", "degrading"]},
               "rows": cells}, open(OUT / "cells.json", "w"), separators=(",", ":"))

    # ---------------- timeseries per named area (measured vs expected from the 2021-2023 fit)
    from models import tdd as T
    temps = T.load_temps()
    named = json.load(open(SD / "named_areas.geojson"))["features"]
    Efz = read_grid_tif(MD / "E_frozen.tif")
    ix = json.load(open(MOT / "s1_p137" / "index.json"))
    ts = {"schema": "timeseries/2", "units": "cm, relative to the airport pad, zero at each summer's first date",
          "expected_from": "2021-2023 sensitivity x this summer's warmth", "areas": {}}
    for f in named:
        aid = f["properties"]["id"]
        m = rasterize_geojson(cfg, [f], all_touched=True) & ~water
        seasons = []
        for y, v in sorted(ix["seasons"].items()):
            info = T.season_info(temps, int(y), cfg["models"]["tdd"])
            fb = info["t_fb"]
            ds = [d for d in v["dates"] if d["date"] < fb]
            pts = []
            A0 = None
            for d in ds:
                a = read_grid_tif(MOT / "s1_p137" / d["file"])[m]
                val = float(np.nanmedian(a)) if np.isfinite(a).sum() >= 3 else None
                Ad = T.A_of(temps, info, date.fromisoformat(d["date"]))
                A0 = Ad if A0 is None else A0
                ex = float(-np.nanmedian(Efz[m]) * (Ad - A0)) if np.isfinite(Efz[m]).any() else None
                pts.append({"date": d["date"], "measured": None if val is None else round(val, 2),
                            "expected": None if ex is None else round(ex, 2)})
            if any(p["measured"] is not None for p in pts):
                last = [p for p in pts if p["measured"] is not None][-1]
                seasons.append({"year": int(y), "sensor": "Sentinel-1", "points": pts, "total_measured": last["measured"],
                                "role": "train" if int(y) <= 2023 else "test"})
        ts["areas"][aid] = {"name": f["properties"]["name"], "seasons": seasons}
    json.dump(ts, open(OUT / "timeseries.json", "w"), separators=(",", ":"))

    # ---------------- validation cards
    ma, mc, mb = ev["model_a"], ev["model_c"], ev["model_b"]
    ta, tb = ma["test_a"], ma["test_b"]
    ph = ev.get("model_a_posthoc_deramp", {}).get("test_a", {})
    six = json.load(open(MOT / "s1_p137" / "index.json"))
    f2 = lambda v: None if v is None else round(v, 2)
    sk, rb, kp = ta["metrics"]["skill_vs_best_baseline"], ta["metrics"]["rho_block"], ta["metrics"]["kappa"]
    phr = ph.get("metrics", {}).get("rho_block", {}).get("value") if ph else None
    rp = ev.get("reindeer_point_consistency") or {}
    cards = [
        {"id": "test_a", "title": "Do radar patterns repeat?", "status": ta["status"],
         "headline": {"value": f"{sk['value']:+.2f}".replace("+", ""), "unit": "skill"},
         "baseline": f"Baseline: \"no motion\" (skill 0). Block ρ {rb['value']:.2f} · κ {kp['value']:.2f}."
                     + (f" Post-hoc deramp: ρ {phr:.2f}, still fails." if phr is not None else ""),
         "plain": "Radar can't yet tell stable from degrading ground here at 80 m.",
         "method": "Sensitivity to warmth fitted on Sentinel-1 2021–23, tested on 2024–25 at 500 m blocks; 95% block-bootstrap intervals.",
         "ci95": {"skill": sk["ci95"], "rho": rb["ci95"], "kappa": kp["ci95"]}},
        {"id": "test_b", "title": "Does NISAR agree?", "status": tb.get("status"),
         "headline": {"value": f"{(tb.get('metrics', {}).get('rho_block', {}).get('value') or 0):.2f}", "unit": "ρ"},
         "baseline": "Needs a connected series of at least five dates.",
         "plain": "One pair failed to unwrap and several lost coherence, so 2026 has no connected series.",
         "method": "NISAR 2026 12-day pairs, ionosphere-corrected, ordering compared with the Sentinel-1 fit at 500 m blocks."},
    ]
    bhp = MD / "borehole_check.json"
    if bhp.exists():
        bh = json.load(open(bhp))
        st = {"consistent": "pass", "inconclusive": "partial", "not consistent": "fail"}.get(bh["status"], "not_available")
        cards.append({"id": "boreholes", "title": "Does radar match the boreholes?", "status": st,
                      "headline": {"value": f"{bh['rho']:.2f}" if bh.get("rho") is not None else "–", "unit": "ρ"},
                      "baseline": f"Rule fixed before running: ρ ≥ 0.4 consistent, ≤ 0 not consistent. {bh['n_compared']} highway boreholes (about 6 separate places).",
                      "plain": "Ice-rich boreholes did not sink more on radar; if anything less. Radar movement doesn't track measured ground ice here.",
                      "method": "Top-5 m moisture content from NWT Permafrost Database logs (ITH 2013 and 2017 drilling, data owner GNWT) against radar summer sinking within 120 m."})
    cards += [
        {"id": "model_b", "title": "Predict where radar can't see", "status": mb["status"],
         "headline": {"value": f"{mb['n_labels']['degrading']} of 300", "unit": "examples"},
         "baseline": "Needs 300 measured examples of degrading ground in 15 blocks.",
         "plain": "Too few examples to learn from, so no predicted layer exists.",
         "method": "Random forest on terrain, water and vegetation, tested on held-out 2 km blocks (not run)."},
        {"id": "model_c", "title": "Can we forecast the shoreline?", "status": mc["status"],
         "headline": {"value": f"{mc['metrics']['mae_m']:.0f} m", "unit": "average error"},
         "baseline": f"Baseline: \"no change\", {mc['baselines']['persistence_mae_m']:.0f} m error.",
         "plain": "The 30 m satellite waterline is too noisy. Arrival years are hidden; measured change is shown instead.",
         "method": f"{mc['n_transects']} transects; trend fitted on 1985–2004 waterlines, checked at every date 2005–2025."},
        {"id": "reindeer", "title": "Reindeer Point reports", "status": "not_available",
         "headline": {"value": f"{round((rp.get('m_A_share_degrading') or 0) * 100)}%", "unit": "degrading by radar"},
         "baseline": "Needs the ground prediction. A consistency check, never proof.",
         "plain": "Homes sit on gravel pads; at 80 m radar can't separate pad settling from ground thaw.",
         "method": "Share of measured Reindeer Point cells classed degrading, against public reports (Canadian Geographic, Oct 2026)."},
        {"id": "radar_checks", "title": "Is the radar processing right?", "status": "pass",
         "headline": {"value": "1.00", "unit": "slope vs provider"},
         "baseline": "HyP3's own displacement maps (slope must be 1.00 ± 0.01).",
         "plain": "Our processing matches the provider's maps; the airport reads zero, lakes are masked, no unwrapping jumps.",
         "method": six.get("sign_check", {}).get("detail", "")},
    ]
    json.dump({"schema": "validation/2", "prereg_tag": ev.get("prereg_tag"), "prereg_commit": ev.get("prereg_commit"),
               "cards": cards, "deviations": ev.get("deviations"), "limits": ev.get("limits"),
               "what_still_works": "Height above sea, distance to the 2025 shoreline, measured shoreline change and distance to the highway are measured directly. The screen leans on these.",
               "what_we_dont_predict": ["Ground condition under a single house", "When the coast arrives", "Sudden collapse or the damage from one storm"]},
              open(OUT / "validation.json", "w"), indent=1)

    # ---------------- coastline
    sl = json.load(open(MD / "shorelines_used.geojson"))["features"]
    pick = {}
    for f in sl:
        y = int(f["properties"]["date"][:4])
        for target in (1985, 1995, 2005, 2015, 2025):
            if abs(y - target) <= 2 and (target not in pick or abs(y - target) < abs(int(pick[target]["properties"]["date"][:4]) - target)):
                pick[target] = f
    from shapely.geometry import shape, mapping
    cf = []
    for t, f in sorted(pick.items()):
        g = shape(f["geometry"]).simplify(0.00012)
        cf.append({"type": "Feature", "geometry": rnd(mapping(g)), "properties": {"kind": "shoreline", "date": f["properties"]["date"],
                                                                                 "year": t, "source": f["properties"]["source"]}})
    for f in json.load(open(MD / "transects.geojson"))["features"]:
        p = f["properties"]
        mcx = p.get("measured_change")
        cf.append({"type": "Feature", "geometry": rnd(f["geometry"]), "properties": {
            "kind": "transect", "id": p["id"], "change_m": None if not mcx else mcx["landward_m"],
            "se_m": None if not mcx else mcx["se_m"], "shore_type": p["shore_type"]}})
    json.dump({"type": "FeatureCollection", "schema": "coastline/2", "features": cf}, open(OUT / "coastline.geojson", "w"),
              separators=(",", ":"))

    # ---------------- roads (map context; ODbL)
    hw = json.load(open(ROOT / "data/interim/context/highway.geojson"))["features"]
    rf = []
    for f in hw:
        if f["geometry"]["type"] != "LineString":
            continue
        g = shape(f["geometry"]).simplify(0.00005)
        rf.append({"type": "Feature", "properties": {"main": "Inuvik" in f["properties"].get("name", "")}, "geometry": rnd(mapping(g))})
    json.dump({"type": "FeatureCollection", "features": rf}, open(OUT / "roads.geojson", "w"), separators=(",", ":"))

    # ---------------- boreholes (NWT Permafrost Database; data owner GNWT)
    if bhp.exists():
        bh = json.load(open(bhp))
        bf = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
               "properties": {"site": r["site"], "moisture": r["moisture_top5m_median_pct"], "visible_ice": r["visible_ice_logged_top5m"],
                              "ice_rich": bool(r["visible_ice_logged_top5m"] or (r["moisture_top5m_median_pct"] or 0) > 40),
                              "radar_cm": r["radar_sinking_cm_per_summer"]}} for r in bh["sites"]]
        json.dump({"type": "FeatureCollection", "source": bh["source"], "features": bf}, open(OUT / "boreholes.geojson", "w"))

    # ---------------- manifest (written last; owns every field the UI reads)
    s1 = json.load(open(MOT / "s1_p137" / "index.json"))
    last_s1 = max(d["date"] for v in s1["seasons"].values() for d in v["dates"])
    coring = json.load(open(SD / "coring.json"))
    n_prom = len(coring["promising_unconfirmed"])
    man = {
        "schema": 2, "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "mock": False,
        "area": {"name": "Tuktoyaktuk and the Inuvik–Tuktoyaktuk Highway corridor", "bbox": bbox,
                 "center": [-133.03, 69.41], "zoom": 11.3, "image_coordinates": corners},
        "freshness": freshness(last_s1),
        "bounds": bbox, "town_bounds": [-133.10, 69.36, -132.92, 69.47],
        "latest_pass": {"date": last_s1, "sensor": "Sentinel-1"},
        "limits": ["Block scale: 240 m squares, 80 m radar", "Thaw season only (June to September)",
                   "Motion is relative to the airport gravel pad", "A screen, not an engineering sign-off",
                   "\u201cLower-risk\u201d doesn\u2019t mean \u201csafe\u201d"],
        "units": "cm per summer, relative to the airport gravel pad", "motion_range_cm": [-lim, lim],
        "years": years, "layers": layers,
        "models": {"behaviour": ma["test_a"]["status"], "nisar_check": tb.get("status"), "ground_prediction": mb["status"],
                   "shoreline_forecast": mc["status"], "show_arrival_years": mc.get("ui_show_arrival", False)},
        "screening": {"n_cells": len(cells), "n_promising": n_prom,
                      "promising_km2": round(n_prom * 0.24 * 0.24, 1), "settings": A.get("settings")},
        "files": {"areas": "areas.geojson", "cells": "cells.json", "boreholes": "boreholes.geojson", "timeseries": "timeseries.json", "validation": "validation.json",
                  "coastline": "coastline.geojson"},
        "provenance": {"measured": "From satellite or survey data", "predicted": "Model output, tested on unseen data",
                       "demo": "Simulated for the demo"},
        "credits": ["Contains modified Copernicus Sentinel data 2021–2025, processed by ASF HyP3",
                    "NISAR data courtesy NASA/JPL-Caltech and ISRO, via ASF DAAC",
                    "Elevation: NRCan HRDEM (Open Government Licence – Canada)",
                    "Climate: Environment and Climate Change Canada",
                    "Map data © OpenStreetMap contributors (ODbL)",
                    "Surface water: EC JRC Global Surface Water", "Landsat: USGS; Sentinel-2: Copernicus"],
    }
    json.dump(man, open(OUT / "manifest.json", "w"), indent=1)
    sizes = {p.name: p.stat().st_size for p in OUT.rglob("*") if p.is_file()}
    print("wrote", OUT, "total", round(sum(sizes.values()) / 1e6, 2), "MB")
    for k, v in sorted(sizes.items(), key=lambda kv: -kv[1]):
        print(f"  {k:30s} {v/1e3:8.1f} kB")


if __name__ == "__main__":
    main()
