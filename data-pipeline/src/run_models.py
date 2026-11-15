"""Part 3 entry point: Model A (behaviour), Model B (ground prediction), Model C (shoreline), eval.json.

Order (spec 03 section 0): config -> Model C -> Model A frozen fit, Tests A/B, final fit -> Model B on
final labels -> expectation -> rasters/JSON -> eval.json.

Usage: python src/run_models.py [--only a|b|c]
Outputs: data/interim/models/*.tif, eval.json, expected.json, transects.geojson
"""
from __future__ import annotations

import argparse
import json
import subprocess
import warnings
from datetime import datetime, timezone

import numpy as np

from common import ROOT, load_config, write_tif
from radar_read import cell_utm, rasterize_geojson, reference_mask, water_mask

warnings.filterwarnings("ignore", category=RuntimeWarning)
OUT = ROOT / "data/interim/models"


def git(cmd):
    try:
        return subprocess.check_output(["git"] + cmd, cwd=ROOT, text=True).strip()
    except Exception:
        return None


def named_mask(cfg, buffer_m=0.0):
    p = ROOT / "data/interim/screening/named_areas.geojson"
    if not p.exists():
        return None
    return rasterize_geojson(cfg, json.load(open(p))["features"], buffer_m=buffer_m, all_touched=True).ravel()


def run_model_a(cfg, ev, stack_id=None, key="model_a", write=True):
    from models import behaviour as B, evaluate_a as EA, tdd as T
    mc = cfg["models"]
    bc = mc["behaviour"]
    temps = T.load_temps()
    ref = reference_mask(cfg).ravel()
    water = water_mask(cfg).ravel()
    x, y = (a.ravel() for a in cell_utm(cfg))
    seasons = B.load_stack(cfg, stack_id or bc["stack_id"], temps, mc["tdd"])
    train = [s for s in seasons if s.year in bc["train_years"]]
    tests = [s for s in seasons if s.year in bc["test_a_years"]]
    print(f"Model A [{stack_id or bc['stack_id']}]: train {[s.year for s in train]}, test {[s.year for s in tests]}")
    ta, frozen, comp, conf_f = EA.test_a(cfg, temps, train, tests, ref, water, x, y)
    print("  Test A:", ta["status"], ta["rows"], ta["metrics"]["skill_vs_best_baseline"], ta["metrics"]["rho_block"],
          ta["metrics"]["kappa"])
    s25 = next((s for s in seasons if s.year == 2025), None)
    tb = EA.test_b(cfg, temps, frozen, comp, conf_f, water, x, y, s25)
    print("  Test B:", tb.get("status"), tb.get("metrics"))
    # final fit on all Sentinel-1 seasons
    final = B.fit_model(seasons, bc, ref, water)
    cls = B.classify(final, bc, water)
    conf = B.confidence(final, bc, "C", seasons)
    # where no season covered the cell at all, it is 'can't measure' only if on land
    trend_only = (cls == 3) & ~B.late_flags(final, bc)[0] & final["rising"]
    land = ~water
    shares = {name: round(float((cls[land] == code).mean()), 4)
              for name, code in [("cant", 0), ("stable", 1), ("seasonal", 2), ("degrading", 3)]}
    print("  final class shares (land):", shares)
    tr_shape = (cfg_shape(cfg))
    res_final = {"seasons": [s.year for s in seasons], "class_shares_land": shares}
    if not write:
        ev[key] = {"test_a": ta, "test_b": tb, "final": res_final}
        return cls, conf, water
    OUT.mkdir(parents=True, exist_ok=True)
    write_tif(cfg, OUT / "behaviour.tif", cls.reshape(tr_shape), nodata=255, dtype="uint8")
    cu = np.where(cls == 255, 255, np.clip(np.round(conf * 100), 0, 100)).astype("uint8")
    write_tif(cfg, OUT / "behaviour_conf.tif", cu.reshape(tr_shape), nodata=255, dtype="uint8")
    for name, arr in [("E", final["E"]), ("E_rel", final["Erel"]), ("E_se", final["SE"]), ("E_slope", final["E_slope"]),
                      ("late_season", final["Lp"]), ("n_seasons", final["n_seasons"].astype(float)),
                      ("E_frozen", frozen["E"]), ("E_se_frozen", frozen["SE"]), ("sigma_p", final["sigma_p"])]:
        a = np.where(land, arr, np.nan).astype("float32")
        write_tif(cfg, OUT / f"{name}.tif", a.reshape(tr_shape))
    rob = EA.robustness(cfg, seasons, final, cls, ref, water, bc)
    sens = EA.cluster_check(final, cls, water, bc)
    rain = EA.rain_check(temps, seasons, final, ref, bc)
    # this-season expectation: NISAR 2026 chain is too short, so the latest full Sentinel-1 season is used
    nm = named_mask(cfg, mc["expectation"]["named_area_buffer_m"])
    nm = np.zeros_like(water) if nm is None else nm
    exp, z_last, z_prev = EA.expectation(cfg, temps, frozen, s25, water, nm, x, y) if s25 else ({"mode": "not_available"}, None, None)
    exp["why_this_season"] = ("NISAR 2026 could not form a connected series of at least three passes over most of the area "
                              "(one pair failed to unwrap, others lost coherence), so the flag is demonstrated on the "
                              "latest Sentinel-1 season (2025) using the 2021-2023 sensitivity.")
    if z_last is not None:
        write_tif(cfg, OUT / "expect_z_latest.tif", np.where(land, z_last, np.nan).astype("float32").reshape(tr_shape))
        if z_prev is not None:
            write_tif(cfg, OUT / "expect_z_previous.tif", np.where(land, z_prev, np.nan).astype("float32").reshape(tr_shape))
    json.dump(exp, open(OUT / "expected.json", "w"), indent=1)
    ev[key] = {"stack_id": stack_id or bc["stack_id"],
        "test_a": ta, "test_b": tb,
        "trend_only_degrading_share": round(float(trend_only[land].mean()), 5),
        "rain_check": rain, "robustness": rob, "sensitivity": sens,
        "final": {"seasons": [s.year for s in seasons], "class_shares_land": shares,
                  "E_ref": round(final["E_ref"], 5), "tau": round(final["tau"], 5), "dA_med": round(final["dA_med"], 2),
                  "rising_rule": final.get("rising_rule"),
                  "season_info": [s.info for s in seasons]},
    }
    return cls, conf, water


def cfg_shape(cfg):
    from common import grid
    _, h, w = grid(cfg)
    return (h, w)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="abc")
    a = ap.parse_args()
    cfg = load_config()
    OUT.mkdir(parents=True, exist_ok=True)
    evp = OUT / "eval.json"
    ev = json.load(open(evp)) if evp.exists() else {}
    ev.update({"schema": "eval/2", "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "prereg_tag": "prereg-eval", "prereg_commit": git(["rev-list", "-n", "1", "prereg-eval"]),
               "code_version": git(["rev-parse", "--short", "HEAD"])})
    ev["deviations"] = DEVIATIONS
    ev["limits"] = ["Block scale, not houses", "Thaw season only", "Motion is relative to a reference area (airport gravel pad)",
                    "A screen for where to look, not a sign-off"]
    if "c" in a.only:
        from models import shoreline
        ev["model_c"] = shoreline.run(cfg)
    if "a" in a.only:
        # Pre-registered run (official status) on the stack frozen at prereg-eval.
        # Post-hoc variant (S1 pairs deramped), chosen on training-season consistency only after the
        # pre-registered Test A failed. Decision rule fixed before running it: publish the variant's map
        # only if its Test A status is better than the official one; the official status is always reported.
        run_model_a(cfg, ev, "s1_p137", "model_a_prereg", write=False)
        run_model_a(cfg, ev, "s1_p137_deramp", "model_a_posthoc_deramp", write=False)
        order = ["fail", "partial", "pass"]
        st0 = ev["model_a_prereg"]["test_a"]["status"]
        st1 = ev["model_a_posthoc_deramp"]["test_a"]["status"]
        pick = "s1_p137_deramp" if order.index(st1) > order.index(st0) else "s1_p137"
        run_model_a(cfg, ev, pick, "model_a", write=True)
        ev["model_a"]["published_map_from"] = pick
        ev["model_a"]["official_status_note"] = (f"Pre-registered Test A status: {st0}. Post-hoc deramp variant: {st1}. "
                                                 "The pre-registered status is the official result.")
    if "b" in a.only:
        from models import ground_pred
        ev["model_b"], ev["reindeer_point_consistency"] = ground_pred.run(cfg)
    json.dump(ev, open(evp, "w"), indent=1, default=lambda o: o.tolist() if hasattr(o, "tolist") else str(o))
    print("wrote", evp)


DEVIATIONS = [
    {"date": "2026-11-15", "what": "Training years 2021-2023 instead of 2018-2023; min_seasons 3 instead of 4",
     "why": "Sentinel-1 2018-2020 were never processed by HyP3 (no Earthdata access overnight); only three training summers exist"},
    {"date": "2026-11-15", "what": "Thaw onset from air temperature only",
     "why": "Station snow depth reports 3-4 cm in late June at 14 C daily mean; judged unusable on training data"},
    {"date": "2026-11-15", "what": "Computation on the shared EPSG:4326 grid with distances and blocks from UTM 8N cell coordinates",
     "why": "Part 1 and Part 2 rasters are on the shared grid; every distance is still in metres"},
    {"date": "2026-11-15", "what": "Confidence c_fit floor uses tau instead of 2*sigma_ref",
     "why": "Motion is referenced to the airport, so sigma_ref is ~0 and the spec formula would give zero confidence to every stable cell"},
    {"date": "2026-11-15", "what": "Test B uses NISAR sensitivity from 12-day increments; the class comparison (kappa) is not available",
     "why": "The 2026 NISAR chain breaks (24 Aug-5 Sep pair failed to unwrap; several pairs lost coherence), so no cell has the five connected dates the class rules need"},
    {"date": "2026-11-15", "what": "This-season expectation demonstrated on Sentinel-1 2025",
     "why": "NISAR 2026 has no connected series of three or more passes over most of the area"},
    {"date": "2026-11-15", "what": "Model C uses the satellite waterline 1985-2025; hindcast fits <= 2004 and predicts 2005-2025 (spec: air photos 1947-1985 fit)",
     "why": "Automatic air-photo shorelines failed visual review (traced mosaic edges and an inner harbour); decided before any hindcast error was seen"},
    {"date": "2026-11-15", "what": "Sentinel-1 2022 to mid-2025 cover only the northern half of the area (town); the highway corridor has 2021 and 2025 only",
     "why": "HyP3 products for those dates were single-frame; corridor cells fall back to short-record rules"},
]

if __name__ == "__main__":
    main()
