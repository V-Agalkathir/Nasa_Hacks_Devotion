"""Model C: shoreline arrival-year ranges (spec 03 section 4), computed in UTM 8N metres.

Adaptation (recorded in eval.json): the 1947-1985 air-photo shorelines failed visual review (automatic
darkness threshold traced mosaic edges and an inner harbour, not the coast), so the record used is the
satellite waterline 1985-2025 (Landsat 30 m, Sentinel-2 10 m). Hindcast: fit on dates <= 2004, predict
every epoch 2005-2025.
"""
from __future__ import annotations

import json

import numpy as np
from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, Point, Polygon, shape, mapping
from shapely.ops import transform, unary_union

from common import ROOT
from radar_read import read_grid_tif

FW = Transformer.from_crs("EPSG:4326", "EPSG:32608", always_xy=True).transform
INV = Transformer.from_crs("EPSG:32608", "EPSG:4326", always_xy=True).transform
SEAWARD = 400.0   # transect origin, metres seaward of the 2025 shoreline (> 40 yr x 3 m/yr + margin)


def load_shorelines():
    p = ROOT / "data/interim/shoreline/shorelines_reviewed.geojson"
    if not p.exists():
        p = ROOT / "data/interim/shoreline/shorelines.geojson"
    g = json.load(open(p))
    out = []
    for f in g["features"]:
        pr = f["properties"]
        src = pr.get("source", "")
        kind = "airphoto" if "NAPL" in src else ("landsat" if "landsat" in src else ("sentinel2" if "sentinel-2" in src else "other"))
        yr = int(pr["date"][:4]) + (int(pr["date"][5:7]) - 1) / 12 + int(pr["date"][8:10]) / 365
        out.append({"date": pr["date"], "t": yr, "kind": kind, "sigma": float(pr.get("position_error_m") or 15.0),
                    "geom": transform(FW, shape(f["geometry"]))})
    return sorted(out, key=lambda d: d["t"])


def window_box(cfg):
    w = cfg.get("shoreline", {}).get("window", [-133.12, 69.41, -132.94, 69.48])
    return transform(FW, Polygon([(w[0], w[1]), (w[2], w[1]), (w[2], w[3]), (w[0], w[3])]))


def smooth_line(line, step=10.0, win_m=200.0):
    n = max(int(line.length / step), 2)
    pts = np.array([line.interpolate(i * step).coords[0] for i in range(n + 1)])
    k = max(int(win_m / step) // 2, 1)
    if len(pts) <= 2 * k + 1:
        return LineString(pts)
    ker = np.ones(2 * k + 1) / (2 * k + 1)
    xs = np.convolve(pts[:, 0], ker, mode="valid")
    ys = np.convolve(pts[:, 1], ker, mode="valid")
    return LineString(np.c_[xs, ys])


def build_transects(cfg, sc, ref_line, sea_test):
    box = window_box(cfg).buffer(-60)
    parts = ref_line.geoms if hasattr(ref_line, "geoms") else [ref_line]
    trans = []
    for part in parts:
        seg = part.intersection(box)
        segs = seg.geoms if hasattr(seg, "geoms") else [seg]
        for s in segs:
            if s.is_empty or s.length < 300:
                continue
            sm = smooth_line(s, win_m=sc["smooth_m"])
            L = sm.length
            for k in range(int(L // sc["spacing_m"]) + 1):
                d = k * sc["spacing_m"]
                p = np.array(sm.interpolate(d).coords[0])
                a = np.array(sm.interpolate(max(d - 25, 0)).coords[0])
                b = np.array(sm.interpolate(min(d + 25, L)).coords[0])
                tvec = b - a
                if np.linalg.norm(tvec) == 0:
                    continue
                tvec /= np.linalg.norm(tvec)
                nvec = np.array([-tvec[1], tvec[0]])
                # orient the normal seaward
                if not sea_test(p + 80 * nvec) and sea_test(p - 80 * nvec):
                    nvec = -nvec
                elif not sea_test(p + 80 * nvec):
                    continue
                start = p + SEAWARD * nvec
                end = p - sc["inland_long_m"] * nvec
                trans.append({"start": start, "end": end, "anchor": p, "nvec": nvec,
                              "az": float((np.degrees(np.arctan2(-nvec[0], -nvec[1])) + 360) % 360)})
    # drop crossings: keep a transect only if it does not cross an earlier kept one inside 300 m of its anchor
    kept = []
    for t in trans:
        ln = LineString([t["start"], t["anchor"] - 300 * t["nvec"]])
        if any(ln.crosses(LineString([u["start"], u["anchor"] - 300 * u["nvec"]])) for u in kept[-6:]):
            t["crossing"] = True
            continue
        t["crossing"] = False
        kept.append(t)
    for i, t in enumerate(kept):
        t["id"] = f"T{i + 1:04d}"
    return kept


def positions(trans, shores, sc):
    """x_{j,k}: distance from the seaward origin to the shoreline, positive landward. Anchored at 2025."""
    win = sc["search_window_m"]
    for t in trans:
        ln = LineString([t["start"], t["end"]])
        xs = {}
        prev = SEAWARD
        for s in sorted(shores, key=lambda d: -d["t"]):          # backwards from the latest line
            inter = ln.intersection(s["geom"])
            if inter.is_empty:
                continue
            pts = [inter] if inter.geom_type == "Point" else [g for g in getattr(inter, "geoms", []) if g.geom_type == "Point"]
            if not pts:
                continue
            d = np.array([ln.project(p) for p in pts])
            d = d[np.abs(d - SEAWARD) <= win]
            if d.size == 0:
                continue
            x = float(d[np.argmin(np.abs(d - prev))])
            if abs(x - prev) > win:
                continue
            xs[s["date"]] = (s["t"], x, s["sigma"])
            prev = x
        t["obs"] = sorted(xs.values())
    return trans


def wls(t, x, sig, proc=None):
    """Weighted LS x = a + r (t - tw), with process noise found so that reduced chi2 <= 1."""
    t, x, sig = map(np.asarray, (t, x, sig))
    if len(t) < 3:
        return None

    def fit(sp):
        w = 1 / (sig ** 2 + sp ** 2)
        tw = np.sum(w * t) / np.sum(w)
        r = np.sum(w * (t - tw) * x) / np.sum(w * (t - tw) ** 2)
        a = np.sum(w * x) / np.sum(w)
        res = x - (a + r * (t - tw))
        chi = np.sum(w * res ** 2) / max(len(t) - 2, 1)
        return a, r, tw, w, chi

    sp = 0.0 if proc is None else proc
    a, r, tw, w, chi = fit(sp)
    if proc is None and chi > 1:
        lo, hi = 0.0, 500.0
        for _ in range(50):
            mid = (lo + hi) / 2
            if fit(mid)[4] > 1:
                lo = mid
            else:
                hi = mid
        sp = hi
        a, r, tw, w, chi = fit(sp)
    se_r = np.sqrt(1 / np.sum(w * (t - tw) ** 2))
    se_a = np.sqrt(1 / np.sum(w))
    return {"a": a, "r": r, "tw": tw, "se_r": se_r, "se_a": se_a, "sigma_proc": sp, "n": len(t)}


def predict(f, t):
    return f["a"] + f["r"] * (t - f["tw"])


def pi_half(f, t, sig_obs, k=1.0):
    return 1.645 * np.sqrt(sig_obs ** 2 + f["sigma_proc"] ** 2 + f["se_a"] ** 2 + (t - f["tw"]) ** 2 * (k * f["se_r"]) ** 2)


def run(cfg):
    sc = cfg["models"]["shoreline"]
    thr = cfg["models"]["thresholds"]["shoreline"]
    shores_all = load_shorelines()
    shores = [s for s in shores_all if s["kind"] in ("landsat", "sentinel2")]
    excluded = sorted({s["date"] for s in shores_all if s["kind"] == "airphoto"})
    latest = max(shores, key=lambda s: s["t"])
    dco = read_grid_tif(ROOT / "data/interim/features/distance_to_coast.tif")
    from common import grid
    tr, H, W = grid(cfg)
    inv_tr = ~tr

    def sea_test(p):
        lon, lat = INV(p[0], p[1])
        c, r = inv_tr * (lon, lat)
        r, c = int(r), int(c)
        if 0 <= r < H and 0 <= c < W:
            return bool(dco[r, c] <= 0)
        return False

    trans = build_transects(cfg, sc, latest["geom"], sea_test)
    trans = positions(trans, shores, sc)
    # islands from closed OSM coastline rings
    coast = json.load(open(ROOT / "data/interim/context/coast.geojson"))["features"]
    rings = [Polygon(transform(FW, shape(f["geometry"])).coords) for f in coast
             if f["geometry"]["type"] == "LineString" and f["geometry"]["coordinates"][0] == f["geometry"]["coordinates"][-1]
             and len(f["geometry"]["coordinates"]) > 3]
    islands = [r for r in rings if r.is_valid and r.area < 3e6]
    named = json.load(open(ROOT / "data/interim/screening/named_areas.geojson"))["features"]
    named_geoms = {f["properties"]["id"]: transform(FW, shape(f["geometry"])) for f in named}

    fit_to, rec_from = 2004.99, 1995.0
    rows = []
    for t in trans:
        obs = t["obs"]
        tt = np.array([o[0] for o in obs]); xx = np.array([o[1] for o in obs]); ss = np.array([o[2] for o in obs])
        t["n_dates"] = len(obs)
        tr_m = tt <= fit_to
        t["hindcast_ok"] = tr_m.sum() >= sc["hindcast_min_dates"] and (~tr_m).sum() >= 1
        if t["hindcast_ok"]:
            f = wls(tt[tr_m], xx[tr_m], ss[tr_m])
            fr = None
            rm = tr_m & (tt >= rec_from)
            if rm.sum() >= sc["select_recent_min_dates"]:
                fr = wls(tt[rm], xx[rm], ss[rm])
            last_x = xx[tr_m][np.argmax(tt[tr_m])]
            for k in np.nonzero(~tr_m)[0]:
                rows.append({"tid": t["id"], "t": tt[k], "epoch": obs[k][0], "obs": xx[k], "pred": predict(f, tt[k]),
                             "pred_recent": predict(fr, tt[k]) if fr else predict(f, tt[k]),
                             "persist": last_x, "half": pi_half(f, tt[k], ss[k]), "rate": f["r"], "tw": f["tw"],
                             "a": f["a"], "lead": tt[k] - tt[tr_m].max(), "sig": ss[k], "f": f})
    # regional baseline: AOI-median training rate applied to every transect (anchored at its training fit mean)
    rates = np.array([r["rate"] for r in rows])
    reg_rate = float(np.median([r["rate"] for r in {r["tid"]: r for r in rows}.values()])) if rows else np.nan
    for r in rows:
        r["pred_reg"] = r["a"] + reg_rate * (r["t"] - r["tw"])
    # epochs
    by_epoch = {}
    for r in rows:
        by_epoch.setdefault(round(r["epoch"], 3), []).append(r)
    ep_out, beats_p, beats_r, cov = [], 0, 0, []
    for ep, rs in sorted(by_epoch.items()):
        e = np.array([x["pred"] - x["obs"] for x in rs])
        ep_ = np.array([x["persist"] - x["obs"] for x in rs])
        er = np.array([x["pred_reg"] - x["obs"] for x in rs])
        inside = np.array([abs(x["pred"] - x["obs"]) <= x["half"] for x in rs])
        mae, mae_p, mae_r = float(np.mean(np.abs(e))), float(np.mean(np.abs(ep_))), float(np.mean(np.abs(er)))
        if len(rs) < 20:
            continue
        beats_p += mae < mae_p
        beats_r += (mae < mae_r) and (mae < mae_p)
        cov.append(float(inside.mean()))
        lead = float(np.median([x["lead"] for x in rs]))
        k = float(np.percentile(np.abs(e), 90) / np.median([x["half"] for x in rs]))
        ep_out.append({"epoch": round(ep, 2), "n": len(rs), "mae_m": round(mae, 1), "bias_m": round(float(np.mean(e)), 1),
                       "persistence_mae_m": round(mae_p, 1), "regional_rate_mae_m": round(mae_r, 1),
                       "coverage": round(float(inside.mean()), 3), "lead_yr": round(lead, 1), "k": round(k, 2)})
    allr = rows
    e_all = np.array([x["pred"] - x["obs"] for x in allr]) if allr else np.array([np.nan])
    med_cov = float(np.median(cov)) if cov else np.nan
    if not ep_out:
        status = "not_available"
    elif beats_p < thr["min_epochs_beating"] or med_cov < thr["coverage_partial"]:
        status = "fail"
    elif beats_r >= thr["min_epochs_beating"] and med_cov >= thr["coverage_pass"]:
        status = "pass"
    else:
        status = "partial"
    longest = max(ep_out, key=lambda d: d["lead_yr"]) if ep_out else None
    k_infl = max(1.0, longest["k"]) if longest else 1.0
    # acceleration factor b from bias at the longest lead
    b = 0.0
    if longest:
        rs = by_epoch[[ep for ep in by_epoch if round(ep, 2) == longest["epoch"]][0]]
        bias = np.median([x["pred"] - x["obs"] for x in rs])
        retreat = np.median([x["obs"] - x["persist"] for x in rs])
        if bias < 0 and retreat > 0:
            b = float(-bias / retreat)
    # estimator selection (pre-registered: long vs recent, lower median absolute error on 2005-2025)
    mae_long = np.median(np.abs([x["pred"] - x["obs"] for x in allr])) if allr else np.nan
    mae_rec = np.median(np.abs([x["pred_recent"] - x["obs"] for x in allr])) if allr else np.nan
    selected = "recent" if (np.isfinite(mae_rec) and mae_rec <= mae_long) else "long"

    # future rates and arrival years
    rng = np.random.default_rng(cfg["models"]["seed"])
    feats = []
    future = []
    for t in trans:
        obs = t["obs"]
        if len(obs) < 5:
            t["future"] = None
            continue
        tt = np.array([o[0] for o in obs]); xx = np.array([o[1] for o in obs]); ss = np.array([o[2] for o in obs])
        fl = wls(tt, xx, ss)
        rm = tt >= sc["recent_from"]
        fr = wls(tt[rm], xx[rm], ss[rm]) if rm.sum() >= sc["recent_min_dates"] else fl
        cen, oth = (fr, fl) if selected == "recent" else (fl, fr)
        t["future"] = {"long": fl, "recent": fr, "central": cen, "other": oth}
        future.append(t)
    # along-shore smoothing of central rate (5-transect median), keep raw values
    rc = np.array([t["future"]["central"]["r"] for t in future])
    half = sc["smooth_transects"] // 2
    rs_ = np.array([np.median(rc[max(0, i - half):i + half + 1]) for i in range(len(rc))])
    x2025 = {}
    for i, t in enumerate(future):
        t["future"]["central_smoothed_r"] = float(rs_[i])
        obs_latest = [o for o in t["obs"] if abs(o[0] - latest["t"]) < 0.01]
        x2025[t["id"]] = obs_latest[0][1] if obs_latest else float(predict(t["future"]["long"], latest["t"]))

    def arrival(t, D, sigma_now):
        F = t["future"]
        mix = sc["mix_accel"] if b > 0 else sc["mix"]
        comp = rng.choice(["central", "other", "accelerated"] if b > 0 else ["central", "other"], size=sc["mc_draws"],
                          p=[mix["central"], mix["other"], mix["accelerated"]] if b > 0 else [mix["central"], mix["other"]])
        rc_ = F["central_smoothed_r"]
        mu = np.where(comp == "central", rc_, np.where(comp == "other", F["other"]["r"], rc_ * (1 + b)))
        se = np.where(comp == "other", F["other"]["se_r"], F["central"]["se_r"]) * k_infl
        r = rng.normal(mu, se)
        none_share = float((r <= sc["r_none_m_yr"]).mean())
        r = np.maximum(r, sc["r_floor_m_yr"])
        delta = rng.normal(0, sigma_now, sc["mc_draws"])
        T_ = 2025 + np.maximum(D + delta, 0) / r
        lo, hi = np.percentile(T_, sc["percentiles"])
        rnd = sc["round_years"]
        lo_r, hi_r = int(np.floor(lo / rnd) * rnd), int(np.ceil(hi / rnd) * rnd)
        if hi_r - lo_r < rnd:
            hi_r = lo_r + rnd
        cap = sc["horizon_cap_year"]
        if none_share > 0.5 or lo > cap:
            return {"lo": None, "hi": None, "arrival_not_before": cap, "text": f"not expected before {cap}"}
        if hi > cap:
            return {"lo": lo_r, "hi": None, "text": f"from {lo_r}, possibly after {cap}"}
        return {"lo": lo_r, "hi": hi_r, "text": f"between {lo_r} and {hi_r}"}

    area_arrivals = {a: [] for a in named_geoms}
    hind_by_t = {}
    for r in rows:
        hind_by_t.setdefault(r["tid"], []).append(r)
    for t in future:
        anchor_x = x2025[t["id"]]
        p2025 = t["start"] - anchor_x * t["nvec"]
        ln_in = LineString([p2025, t["end"]])
        island = any(isl.boundary.distance(Point(t["anchor"])) < 40 for isl in islands)
        shore_type = "island" if island else "open"
        arr = {str(D): arrival(t, D, latest["sigma"]) for D in (25, 50, 100, 200, 400)}
        dist_to = {}
        for aid, g in named_geoms.items():
            if ln_in.intersects(g):
                inter = ln_in.intersection(g)
                d = float(min(ln_in.project(Point(c)) for c in (inter.coords if inter.geom_type == "LineString" else
                                                               [pt for gg in getattr(inter, "geoms", [inter]) for pt in gg.coords])))
                dist_to[aid] = d
                area_arrivals[aid].append((d, t["id"], arrival(t, d, latest["sigma"]), shore_type))
        hb = hind_by_t.get(t["id"], [])
        he = np.array([x["pred"] - x["obs"] for x in hb]) if hb else None
        F = t["future"]
        props = {
            "id": t["id"], "n_dates": t["n_dates"], "n_fit_dates": F["long"]["n"], "definition": "waterline",
            "shore_type": shore_type, "crossing": t["crossing"], "baseline_azimuth_deg": round(t["az"]),
            "baseline_offset_m": SEAWARD,
            "rate_long_m_yr": round(F["long"]["r"], 2), "rate_recent_m_yr": round(F["recent"]["r"], 2),
            "rate_central_m_yr": round(F["central_smoothed_r"], 2), "rate_central_raw_m_yr": round(F["central"]["r"], 2),
            "rate_se_m_yr": round(F["central"]["se_r"] * k_infl, 2), "sigma_proc_m": round(F["central"]["sigma_proc"], 1),
            "rate_estimator": selected,
            "hindcast": None if he is None else {"fit_to": 2004, "n_epochs": int(len(he)), "mae_m": round(float(np.mean(np.abs(he))), 1),
                                                 "bias_m": round(float(np.mean(he)), 1),
                                                 "within_90pi": round(float(np.mean([abs(x["pred"] - x["obs"]) <= x["half"] for x in hb])), 2)},
            "protected": False, "low_confidence": shore_type in ("island", "spit"),
            "arrival": arr, "distance_to_named_m": {k: round(v) for k, v in dist_to.items()},
            "provenance": "modelled",
        }
        # measured change (no forecast): mean position 2021-2025 minus mean 2005-2009, positive = land lost
        ob = np.array(t["obs"])
        e_ = ob[(ob[:, 0] >= 2005) & (ob[:, 0] < 2010)]
        l_ = ob[(ob[:, 0] >= 2021) & (ob[:, 0] < 2026)]
        if len(e_) >= 2 and len(l_) >= 2:
            ch = float(l_[:, 1].mean() - e_[:, 1].mean())
            se = float(np.sqrt(np.var(l_[:, 1], ddof=1) / len(l_) + np.var(e_[:, 1], ddof=1) / len(e_)))
            props["measured_change"] = {"from": "2005-2009", "to": "2021-2025", "landward_m": round(ch, 1), "se_m": round(se, 1),
                                        "n_early": int(len(e_)), "n_late": int(len(l_)), "provenance": "measured"}
            t["measured"] = (ch, se)
        geom = LineString([t["start"], t["end"]])
        feats.append({"type": "Feature", "geometry": mapping(transform(INV, geom)), "properties": props})
    out_dir = ROOT / "data/interim/models"
    out_dir.mkdir(parents=True, exist_ok=True)
    json.dump({"type": "FeatureCollection", "features": feats}, open(out_dir / "transects.geojson", "w"))
    # dated shorelines for the map (satellite record + note on air photos)
    sl = [{"type": "Feature", "properties": {"date": s["date"], "source": s["kind"], "position_error_m": s["sigma"]},
           "geometry": mapping(transform(INV, s["geom"].simplify(8)))} for s in shores]
    json.dump({"type": "FeatureCollection", "features": sl}, open(out_dir / "shorelines_used.geojson", "w"))
    # named-area arrival: earliest likely range among transects reaching the area
    areas = {}
    for aid, lst in area_arrivals.items():
        if not lst:
            areas[aid] = {"reached_by_transects": 0, "text": "no shoreline transect reaches this area within 1 km",
                          "lo": None, "hi": None, "arrival_not_before": 2100}
            continue
        def key(item):
            a = item[2]
            return a["lo"] if a["lo"] is not None else 9999
        d, tid, a, st = min(lst, key=key)
        areas[aid] = {**a, "transect": tid, "distance_m": round(d), "reached_by_transects": len(lst), "shore_type": st}
    # measured shoreline change near each named area: transects whose 2025 point lies within 300 m of it
    for aid, g in named_geoms.items():
        vals = [t["measured"] for t in future if "measured" in t and Point(t["anchor"]).distance(g) <= 300]
        if vals:
            ch = np.array([v[0] for v in vals])
            areas[aid]["measured_change"] = {"landward_m_median": round(float(np.median(ch)), 1),
                                             "landward_m_p90": round(float(np.percentile(ch, 90)), 1),
                                             "n_transects": len(vals), "from": "2005-2009", "to": "2021-2025"}
        else:
            areas[aid]["measured_change"] = None
    json.dump(areas, open(out_dir / "area_arrival.json", "w"), indent=1)
    res = {
        "status": status, "n_transects": len(trans), "n_transects_hindcast": len(hind_by_t), "n_transects_future": len(future),
        "record": "satellite waterline 1985-2025 (Landsat 30 m, Sentinel-2 10 m)",
        "air_photos_excluded": {"dates": excluded, "reason": "automatic extraction failed visual review (traced mosaic edges / inner harbour)"},
        "hindcast_design": "fit on dates <= 2004, predict each epoch 2005-2025",
        "selected_estimator": selected,
        "metrics": {"mae_m": round(float(np.mean(np.abs(e_all))), 1), "rmse_m": round(float(np.sqrt(np.mean(e_all ** 2))), 1),
                    "bias_m": round(float(np.mean(e_all)), 1), "coverage_median_epoch": None if not np.isfinite(med_cov) else round(med_cov, 3),
                    "epochs_beating_persistence": int(beats_p), "epochs_beating_regional_and_persistence": int(beats_r)},
        "baselines": {"persistence_mae_m": round(float(np.mean([abs(x["persist"] - x["obs"]) for x in allr])), 1) if allr else None,
                      "regional_rate_mae_m": round(float(np.mean([abs(x["pred_reg"] - x["obs"]) for x in allr])), 1) if allr else None,
                      "regional_rate_m_yr": round(reg_rate, 2)},
        "by_epoch": ep_out, "interval_inflation": round(k_infl, 2), "acceleration_b": round(b, 3),
        "median_rate_central_m_yr": round(float(np.median(rs_)), 2) if len(rs_) else None,
        "area_arrival": areas,
        "ui_show_arrival": status in ("pass", "partial"),
        "measured_change_median_m": round(float(np.median([t["measured"][0] for t in future if "measured" in t])), 1),
        "headline": None,
        "protected_stretches": "not supplied by Part 1; no transect flagged; ranges are the unprotected trend",
    }
    if longest:
        res["headline"] = (f"Fitting on 1985-2004 predicted shoreline position {longest['lead_yr']:.0f} years later to within "
                           f"{longest['mae_m']:.0f} m on average (regional-rate baseline {longest['regional_rate_mae_m']:.0f} m, "
                           f"no-change baseline {longest['persistence_mae_m']:.0f} m).")
    print("  Model C:", status, res["metrics"], res["baselines"], "selected", selected, "b", round(b, 3), "k", round(k_infl, 2))
    return res
