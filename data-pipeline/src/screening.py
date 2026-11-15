"""Part 4: site screening — areas.geojson with indicators, tier + drivers, reasons and coring flags.

Areas: three named areas (OSM outlines, approximate) plus screening cells (240 m squares on land within
2 km of the Inuvik-Tuktoyaktuk Highway or the town road network). Every indicator is computed on the
shared grid; distances are metres (UTM 8N cell coordinates / anisotropic distance transforms).

The tier answers: how likely is it that a home built here would have to move again, and why?
Drivers are kept separate: ground (Model A, measured), coast (measured shoreline position and change),
height above the storm-surge reference. Low confidence or failed tests are stated, never hidden.

Usage: python src/screening.py      Output: data/interim/screening/areas.geojson, coring.json
"""
from __future__ import annotations

import json
import warnings
warnings.filterwarnings("ignore")

import numpy as np
from pyproj import Transformer
from scipy import ndimage
from shapely.geometry import Point, box, mapping, shape
from shapely.ops import transform, unary_union

from common import ROOT, grid, load_config
from radar_read import cell_utm, rasterize_geojson, read_grid_tif, water_mask

FW = Transformer.from_crs("EPSG:4326", "EPSG:32608", always_xy=True).transform
INV = Transformer.from_crs("EPSG:32608", "EPSG:4326", always_xy=True).transform

SC = {
    "cell_m": 240,                 # 3 x 80 m radar pixels: enough independent looks per cell
    "corridor_m": 2000,
    "min_land_share": 0.5,
    "surge_m": 2.5,                # storm-surge reference level above mean sea level [unconfirmed: cite before UI]
    "low_margin_m": 1.5,           # 'moderate' band above the surge level
    "coast_near_m": 100,
    "coast_mid_m": 300,
    "wet_high": 0.40,
    "conf": {"high": 0.70, "medium": 0.45},
    "filters_default": {"ground": "any", "min_height_m": 4.0, "max_highway_m": 1000, "min_conf": "medium", "coast_horizon_yr": 25},
    "can_measure_min": 0.5,
}


def dist_m(mask, cfg):
    """Distance in metres from every cell to the nearest True cell (anisotropic grid)."""
    tr, H, W = grid(cfg)
    lat = 69.34
    dx = abs(tr.a) * 111320 * np.cos(np.radians(lat))
    dy = abs(tr.e) * 110570
    if not mask.any():
        return np.full(mask.shape, np.inf)
    return ndimage.distance_transform_edt(~mask, sampling=(dy, dx))


def flood_threshold(elev, sea):
    """Priority-flood minimax: the lowest sea level at which each pixel floods via a connected path (8-neighbour)."""
    import heapq
    H, W = elev.shape
    e = np.where(np.isfinite(elev), elev, 0.0).astype("float64")
    cost = np.full((H, W), np.inf)
    heap = []
    ys, xs = np.nonzero(sea)
    for y, x in zip(ys, xs):
        cost[y, x] = 0.0
        heap.append((0.0, int(y), int(x)))
    heapq.heapify(heap)
    nb = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    while heap:
        c, y, x = heapq.heappop(heap)
        if c > cost[y, x]:
            continue
        for dy, dx in nb:
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W:
                nc = max(c, e[yy, xx])
                if nc < cost[yy, xx]:
                    cost[yy, xx] = nc
                    heapq.heappush(heap, (nc, yy, xx))
    return cost.astype("float32")


def main():
    cfg = load_config()
    tr, H, W = grid(cfg)
    md = ROOT / "data/interim/models"
    feat = ROOT / "data/interim/features"
    ev = json.load(open(md / "eval.json"))
    cls = read_grid_tif(md / "behaviour.tif")
    conf = read_grid_tif(md / "behaviour_conf.tif") / 100.0
    Erel = read_grid_tif(md / "E_rel.tif")
    dA = ev["model_a"]["final"]["dA_med"]
    move_cm = Erel * dA                                  # summer movement relative to airport, cm (negative = sinks more)
    move_cm = -move_cm
    # per-summer totals (cm vs airport pad, last date <= 15 Sep) for the per-area summer chart
    mot = ROOT / "data/interim/motion/s1_p137"
    mix = json.load(open(mot / "index.json"))
    summers = {}
    for y, v in sorted(mix["seasons"].items()):
        ds = [d for d in v["dates"] if d["date"][5:] <= "09-15"]
        if ds:
            summers[int(y)] = read_grid_tif(mot / ds[-1]["file"])
    elev = read_grid_tif(feat / "elevation.tif")
    fl_path = md / "flood_threshold.tif"
    if fl_path.exists():
        flood = read_grid_tif(fl_path)
    else:
        from common import write_tif
        flood = flood_threshold(elev, read_grid_tif(feat / "distance_to_coast.tif") <= 0)
        write_tif(cfg, fl_path, flood)
    occ = read_grid_tif(feat / "water_occurrence.tif")
    dco = read_grid_tif(feat / "distance_to_coast.tif")
    water = water_mask(cfg)
    z = read_grid_tif(md / "expect_z_latest.tif") if (md / "expect_z_latest.tif").exists() else np.full((H, W), np.nan)
    zp = read_grid_tif(md / "expect_z_previous.tif") if (md / "expect_z_previous.tif").exists() else np.full((H, W), np.nan)
    hw = [f for f in json.load(open(ROOT / "data/interim/context/highway.geojson"))["features"] if f["geometry"]["type"] == "LineString"]
    main_hw = [f for f in hw if "Inuvik" in f["properties"].get("name", "") or f["properties"].get("ref") in ("10", "NT 10")]
    road = rasterize_geojson(cfg, hw, buffer_m=15, all_touched=True)
    d_road = dist_m(road, cfg)
    d_hw = dist_m(rasterize_geojson(cfg, main_hw, buffer_m=15, all_touched=True), cfg) if main_hw else d_road
    named = json.load(open(ROOT / "data/interim/screening/named_areas.geojson"))["features"]
    core_geom = shape([f for f in named if f["properties"]["id"] == "town_core"][0]["geometry"])
    d_core = dist_m(rasterize_geojson(cfg, [{"geometry": mapping(core_geom)}], all_touched=True), cfg)
    wet_near = ndimage.uniform_filter((water | (occ >= 25)).astype(float), size=(5, 13))  # ~250 m window
    x, y = cell_utm(cfg)
    transects = json.load(open(md / "transects.geojson"))["features"]
    tr_pts = []
    for f in transects:
        mc = f["properties"].get("measured_change")
        if mc:
            a = transform(FW, shape(f["geometry"]))
            tr_pts.append((a, mc["landward_m"], mc["se_m"]))
    mc_ok = ev["model_c"].get("ui_show_arrival", False)
    a_status = ev["model_a"]["test_a"]["status"]

    # ---------------- areas: named + screening cells
    areas = []
    for f in named:
        g = transform(FW, shape(f["geometry"]))
        areas.append({"id": f["properties"]["id"], "name": f["properties"]["name"], "kind": "named", "geom_utm": g,
                      "props": f["properties"]})
    corridor = (d_road <= SC["corridor_m"]) & ~water
    x0, y0 = np.nanmin(x[corridor]), np.nanmin(y[corridor])
    ci = np.floor((x - x0) / SC["cell_m"]).astype(int)
    cj = np.floor((y - y0) / SC["cell_m"]).astype(int)
    cid = np.where(corridor, ci * 10000 + cj, -1)
    land_all = ~water
    cell_ids, counts = np.unique(cid[cid >= 0], return_counts=True)
    for c, n in zip(cell_ids, counts):
        i, j = divmod(c, 10000)
        g = box(x0 + i * SC["cell_m"], y0 + j * SC["cell_m"], x0 + (i + 1) * SC["cell_m"], y0 + (j + 1) * SC["cell_m"])
        areas.append({"id": f"C{i:03d}_{j:03d}", "name": None, "kind": "cell", "geom_utm": g, "_cid": c})

    out = []
    coring = {"promising_unconfirmed": [], "conflicting_evidence": []}
    for a in areas:
        if a["kind"] == "named":
            m = rasterize_geojson(cfg, [{"geometry": mapping(transform(INV, a["geom_utm"]))}], all_touched=True)
        else:
            m = cid == a["_cid"]
        tot = m.sum()
        if tot == 0:
            continue
        land = m & land_all
        if a["kind"] == "cell" and land.sum() / tot < SC["min_land_share"]:
            continue
        if land.sum() < 3:
            continue
        c = cls[land]
        share = {k: float((c == v).mean()) for k, v in [("stable", 1), ("seasonal_only", 2), ("degrading", 3), ("cant_measure", 0)]}
        measured = np.isin(c, [1, 2, 3])
        can_measure = float(measured.mean())
        dom = max(["stable", "seasonal_only", "degrading"], key=lambda k: share[k]) if can_measure >= SC["can_measure_min"] else "cant_measure"
        mv = move_cm[land][measured] if measured.any() else np.array([np.nan])
        cf = float(np.nanmedian(conf[land][measured])) if measured.any() else 0.0
        # confidence: coverage x model confidence, capped low while Test A fails
        conf_score = cf * can_measure
        conf_lbl = "high" if conf_score >= SC["conf"]["high"] else ("medium" if conf_score >= SC["conf"]["medium"] else "low")
        ground_tested = a_status in ("pass", "partial")
        ground_conf = conf_lbl if ground_tested else "low"
        el = elev[land]
        h_med = float(np.nanmedian(el))
        h_p10 = float(np.nanpercentile(el, 10))
        fv = flood[land]
        fv = fv[np.isfinite(fv)]
        fl_p10 = float(np.percentile(fv, 10)) if fv.size else None
        fl_med = float(np.median(fv)) if fv.size else None
        low_share = float((el < SC["surge_m"]).mean())
        wet = float(np.nanmean(wet_near[m]))
        d_hw_m = float(np.nanmin(d_hw[m]))
        d_core_m = float(np.nanmin(d_core[m]))
        d_sea_m = float(np.nanmin(dco[m]))
        mv_years = {}
        for yy, arr in summers.items():
            vv = arr[land]
            mv_years[yy] = round(float(np.nanmedian(vv)), 2) if np.isfinite(vv).sum() >= max(3, 0.3 * land.sum()) else None
        zz = z[land]; zq = zp[land]
        flagged = (zz < -2)
        share_flag = float(np.nanmean(flagged[np.isfinite(zz)])) if np.isfinite(zz).any() else None
        med_z = float(np.nanmedian(zz)) if np.isfinite(zz).any() else None
        med_zp = float(np.nanmedian(zq)) if np.isfinite(zq).any() else None
        prev_flag = (np.nanmean((zq < -2)[np.isfinite(zq)]) >= 0.3 and med_zp < -1.5) if np.isfinite(zq).any() else False
        season_flag = bool(share_flag is not None and share_flag >= 0.3 and med_z < -1.5 and prev_flag)
        # coast: measured change of transects within 300 m of the area
        near = [(ch, se) for ln, ch, se in tr_pts if ln.distance(a["geom_utm"]) <= 300]
        coast_change = float(np.median([n[0] for n in near])) if near else None
        # ---------------- tier
        drivers = []
        if d_sea_m <= SC["coast_near_m"]:
            coast_txt, coast_level = f"Coast: shoreline within {SC['coast_near_m']} m (measured 2025 waterline)", 2
        elif d_sea_m <= SC["coast_mid_m"]:
            coast_txt, coast_level = f"Coast: shoreline {d_sea_m:.0f} m away (measured 2025 waterline)", 1
        else:
            coast_txt, coast_level = "Coast: not a factor here (more than 300 m inland)", 0
        if coast_change is not None and coast_level > 0:
            coast_txt += f"; moved {coast_change:+.0f} m landward 2005-09 to 2021-25 (measured, ±15 m)"
        if low_share >= 0.5:
            h_txt, h_level = f"Height: mostly below the {SC['surge_m']} m storm-surge reference (median {h_med:.1f} m)", 2
        elif h_p10 < SC["surge_m"] + SC["low_margin_m"]:
            h_txt, h_level = f"Height: parts within {SC['low_margin_m']} m of the storm-surge reference (median {h_med:.1f} m)", 1
        else:
            h_txt, h_level = f"Height: above storm-surge reach (median {h_med:.1f} m)", 0
        if dom == "cant_measure":
            g_txt, g_level = "Ground: radar can't measure most of this area", None
        else:
            mvm = float(np.nanmedian(mv))
            g_txt = (f"Ground: moves {abs(mvm):.1f} cm {'more' if mvm < 0 else 'less'} than the airport pad each summer "
                     f"(measured; {share['degrading']*100:.0f}% degrading) — unconfirmed: radar patterns did not repeat between years")
            g_level = 2 if share["degrading"] >= 0.25 else (1 if share["seasonal_only"] + share["degrading"] >= 0.5 else 0)
        level = max(coast_level, h_level, g_level if (g_level is not None and ground_tested) else 0)
        if level == 2:
            tier = "higher"
        elif level == 1:
            tier = "moderate"
        elif dom == "cant_measure" and coast_level == 0 and h_level == 0:
            tier = "not_enough_data"
        else:
            tier = "lower"
        reason_bits = []
        retreat_sig = coast_change is not None and near and coast_change > 2 * max(np.median([n[1] for n in near]), 1.0)
        if coast_level:
            where = "on the shoreline" if coast_level == 2 else "near the shoreline"
            reason_bits.append(where + (" with measured retreat" if retreat_sig else ""))
        if h_level:
            reason_bits.append("low-lying" if h_level == 2 else "partly low-lying")
        if not reason_bits:
            reason_bits.append("high, inland ground" if tier == "lower" else "radar can't see the ground")
        reason = (f"{tier.replace('_', ' ').capitalize()} second-move risk: {', '.join(reason_bits)}. "
                  "Ground condition is not confirmed by radar; a core is needed before building.")
        if coast_level == 0:
            reason += " The coast is not a factor here, so this tier reflects height and ground only."
        drivers = [{"driver": "coast", "text": coast_txt, "level": coast_level, "provenance": "measured"},
                   {"driver": "height", "text": h_txt, "level": h_level, "provenance": "measured"},
                   {"driver": "ground", "text": g_txt, "level": g_level, "provenance": "measured",
                    "confidence": ground_conf, "tested": ground_tested}]
        # ---------------- filters and coring
        passes = {"min_height_m": h_med >= SC["filters_default"]["min_height_m"],
                  "max_highway_m": d_hw_m <= SC["filters_default"]["max_highway_m"],
                  "coast": coast_level == 0, "dry": wet < SC["wet_high"]}
        promising = (a["kind"] == "cell" and all(passes.values()) and dom in ("stable",) and can_measure >= 0.7
                     and not season_flag)
        conflicting = (a["kind"] == "cell" and passes["min_height_m"] and passes["max_highway_m"] and passes["coast"] and
                       (season_flag or (0.3 <= can_measure < 0.7) or share["degrading"] >= 0.1))
        props = {
            "id": a["id"], "name": a["name"], "kind": a["kind"], "approximate": True,
            "tier": tier, "reason": reason, "drivers": drivers,
            "indicators": {
                "ground": {"dominant": dom, "shares": {k: round(v, 3) for k, v in share.items()},
                           "per_summer_cm": {str(k): v for k, v in mv_years.items()},
                           "summer_move_vs_airport_cm": None if not np.isfinite(np.nanmedian(mv)) else round(float(np.nanmedian(mv)), 2),
                           "provenance": "measured", "test_a_status": a_status},
                "getting_worse": {"value": None, "text": "Not shown: a trend could not be separated from noise with five summers",
                                  "provenance": "measured"},
                "this_season": {"flag": season_flag, "share_flagged": None if share_flag is None else round(share_flag, 3),
                                "median_z": None if med_z is None else round(med_z, 2), "season": 2025,
                                "relative_to": "rest of mapped area that summer", "provenance": "measured"},
                "coast": {"distance_to_sea_m": round(d_sea_m), "measured_change_m": None if coast_change is None else round(coast_change, 1),
                          "arrival": None, "arrival_note": "Arrival-year ranges hidden: the shoreline forecast failed its hindcast test",
                          "provenance": "measured"},
                "flood": {"p10_m": None if fl_p10 is None else round(fl_p10, 2), "median_m": None if fl_med is None else round(fl_med, 2),
                          "provenance": "measured (elevation) + bathtub model"},
                "height": {"median_m": round(h_med, 1), "p10_m": round(h_p10, 1), "share_below_surge": round(low_share, 3),
                           "surge_reference_m": SC["surge_m"], "provenance": "measured"},
                "wetness": {"water_share_250m": round(wet, 3), "provenance": "measured"},
                "access": {"to_highway_m": round(d_hw_m), "to_town_core_m": round(d_core_m), "provenance": "measured"},
                "confidence": {"label": conf_lbl, "ground_confidence": ground_conf, "radar_coverage": round(can_measure, 3),
                               "score": round(conf_score, 3)},
            },
            "filters": passes,
            "coring": "promising_unconfirmed" if promising else ("conflicting_evidence" if conflicting else None),
            "provenance": {"ground": "measured", "coast": "measured", "height": "measured", "access": "measured",
                           "tier": "rule on measured inputs"},
        }
        if a["kind"] == "named":
            props["outline_source"] = a["props"].get("outline_source")
            props["description"] = a["props"].get("description")
        geom = transform(INV, a["geom_utm"])
        out.append({"type": "Feature", "geometry": mapping(geom), "properties": props})
        if props["coring"]:
            cx, cy = a["geom_utm"].centroid.coords[0]
            coring[props["coring"]].append({"id": a["id"], "lonlat": [round(v, 5) for v in INV(cx, cy)],
                                            "to_highway_m": round(d_hw_m), "to_town_core_m": round(d_core_m),
                                            "height_m": round(h_med, 1)})
    # order the coring list by distance from town (a route along the highway, not a ranking)
    for k in coring:
        coring[k].sort(key=lambda r: r["to_town_core_m"])
    sd = ROOT / "data/interim/screening"
    json.dump({"type": "FeatureCollection", "schema": "areas/2", "settings": SC, "features": out}, open(sd / "areas.geojson", "w"))
    json.dump({"order": "by distance from the town core along the corridor; not a ranking of sites",
               "wording": "Suggests where a core would tell the relocation team the most. It does not rank sites or replace their judgement.",
               **coring}, open(sd / "coring.json", "w"), indent=1)
    tiers = {}
    for f in out:
        tiers[f["properties"]["tier"]] = tiers.get(f["properties"]["tier"], 0) + 1
    print("areas:", len(out), "tiers:", tiers, "coring:", {k: len(v) for k, v in coring.items() if isinstance(v, list)})
    for f in out:
        if f["properties"]["kind"] == "named":
            p = f["properties"]
            print(" ", p["id"], p["tier"], "|", p["reason"])
            for d in p["drivers"]:
                print("     -", d["text"])


if __name__ == "__main__":
    main()
