"""Part 2: build per-season vertical motion stacks from radar pairs.

Implements docs/architecture/specs/02-radar-processing.md, steps 1-17:
read -> ionosphere (NISAR) -> masks -> phase to LOS cm -> warp -> water -> reference (airport)
-> connectivity flag -> usable season -> closure / 24-day test -> least-squares inversion
-> min-valid rule -> LOS to vertical -> quality layers -> write + index.json -> sanity checks.

Usage:  python src/radar_stack.py [--stack s1_p137|nisar_t159|all]
Outputs: data/interim/motion/<stack_id>/cum_<YYYYMMDD>.tif, coh_/valid_/noise_/flags_<season>.tif, index.json
"""
from __future__ import annotations

import argparse
import json
import subprocess
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from scipy import ndimage

from common import ROOT, grid, load_config, write_tif
from radar_read import (FOUR_PI, inventory_nisar, inventory_s1, read_grid_tif, read_nisar_pair,
                        read_s1_pair, reference_mask, water_mask)

RADAR_DEFAULTS = {
    "phase_sign": {"S1": -1, "NISAR": -1},
    "coherence_min": {"C": 0.30, "L": 0.35},
    "min_valid_pair_fraction": 0.7,
    "ref_min_valid_cells": 20,
    "min_region_cells": 25,
    "closure_threshold_fraction": 0.25,
    "first_date": {"min_coherent_ratio": 0.5, "thaw_days": 5, "thaw_window": 7},
    "season_end": {"nisar_t159": "10-15"},
    "nisar_apply_ionosphere": True,
    "nisar_ionosphere_sign": 1,
    "slope_flag_deg": 5,
    "coast_flag_m": 100,
    "ramp_warn_cm": 2.0,
    "out_dir": "data/interim/motion",
}


def rcfg(cfg):
    r = dict(RADAR_DEFAULTS)
    r.update(cfg.get("radar", {}) or {})
    return r


def git_sha():
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return None


def load_temps():
    df = pd.read_csv(ROOT / "data/interim/climate/daily_temperature.csv", parse_dates=["date"])
    return df.set_index("date")


# ------------------------------------------------------------------ helpers
def plane_ramp_cm(a, mask):
    yy, xx = np.indices(a.shape)
    m = mask & np.isfinite(a)
    if m.sum() < 50:
        return None
    A = np.c_[xx[m], yy[m], np.ones(m.sum())]
    c, *_ = np.linalg.lstsq(A, a[m], rcond=None)
    corners = np.array([[0, 0, 1], [a.shape[1], 0, 1], [0, a.shape[0], 1], [a.shape[1], a.shape[0], 1]]) @ c
    return float(np.ptp(corners))


def robust_plane(a, iters=3, k=3.0):
    """Best-fit plane over valid cells, refitted twice without outliers. Returns the plane (H, W)."""
    yy, xx = np.indices(a.shape)
    m = np.isfinite(a)
    if m.sum() < 100:
        return np.zeros_like(a)
    for _ in range(iters):
        A = np.c_[xx[m], yy[m], np.ones(m.sum())]
        c, *_ = np.linalg.lstsq(A, a[m], rcond=None)
        r = a - (c[0] * xx + c[1] * yy + c[2])
        s = 1.4826 * np.nanmedian(np.abs(r[m]))
        m = np.isfinite(a) & (np.abs(r) <= k * max(s, 1e-6))
    return (c[0] * xx + c[1] * yy + c[2]).astype("float32")


def connected_to_reference(good, ref, min_cells):
    """Label 8-connected good cells; return (connected_mask, keep_mask)."""
    lab, n = ndimage.label(good, structure=np.ones((3, 3)))
    if n == 0:
        return np.zeros_like(good), np.zeros_like(good)
    sizes = ndimage.sum(good, lab, index=np.arange(1, n + 1))
    keep = good & (sizes[np.maximum(lab - 1, 0)] >= min_cells) & (lab > 0)
    ref_labels = lab[ref & good]
    if ref_labels.size == 0:
        return np.zeros_like(good), keep
    main = np.bincount(ref_labels).argmax()
    return (lab == main), keep


def components(n_dates, edges):
    parent = list(range(n_dates))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for i, j in edges:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri
    root0 = find(0)
    return np.array([find(k) == root0 for k in range(n_dates)])


def best_component(n_dates, edges):
    """Date component with the most dates (ties: earliest). Its first date becomes the cell's zero.

    Spec 02 keeps the component containing the season's first usable date; Part 3 (2.2) allows each
    pixel its own first valid date, so we keep the largest component instead. This keeps the highway
    corridor in seasons where the earliest pairs did not cover it. Recorded in index.json.
    """
    parent = list(range(n_dates))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    touched = set()
    for i, j in edges:
        touched |= {i, j}
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[max(ri, rj)] = min(ri, rj)
    if not touched:
        return None
    groups = {}
    for k in sorted(touched):
        groups.setdefault(find(k), []).append(k)
    best = max(groups.values(), key=lambda g: (len(g), -g[0]))
    m = np.zeros(n_dates, bool)
    m[best] = True
    return m


def invert(dates, pairs_idx, D, V):
    """Least squares per cell grouped by validity pattern.

    dates: list of N dates; pairs_idx: list of (i, j); D: (P, M) values; V: (P, M) bool valid.
    Returns X (N, M) with X[0]=0 where connected, NaN otherwise; rms (M); split flag (M).
    """
    N, (P, M) = len(dates), D.shape
    X = np.full((N, M), np.nan, "float32")
    rms = np.full(M, np.nan, "float32")
    split = np.zeros(M, bool)
    if P == 0:
        return X, rms, split
    packed = np.packbits(V, axis=0)  # (ceil(P/8), M)
    keys = np.ascontiguousarray(packed.T).view(np.dtype((np.void, packed.shape[0]))).ravel()
    uniq, inv = np.unique(keys, return_inverse=True)
    for u in range(len(uniq)):
        cells = np.nonzero(inv == u)[0]
        used = np.nonzero(V[:, cells[0]])[0]
        if used.size == 0:
            continue
        edges = [pairs_idx[k] for k in used]
        comp = best_component(N, edges)
        if comp is None or comp.sum() < 2:
            continue
        start = int(np.argmax(comp))
        rows = [k for k in used if comp[pairs_idx[k][0]] and comp[pairs_idx[k][1]]]
        cols = [n for n in range(N) if comp[n] and n != start]
        colpos = {n: c for c, n in enumerate(cols)}
        A = np.zeros((len(rows), len(cols)))
        for r, k in enumerate(rows):
            i, j = pairs_idx[k]
            if j != start:
                A[r, colpos[j]] = 1.0
            if i != start:
                A[r, colpos[i]] = -1.0
        B = D[rows][:, cells].astype("float64")
        sol, *_ = np.linalg.lstsq(A, B, rcond=None)
        X[start, cells] = 0.0
        for n, c in colpos.items():
            X[n, cells] = sol[c]
        if not comp.all():
            split[cells] = True
        if len(rows) > len(cols):
            res = A @ sol - B
            rms[cells] = np.sqrt((res ** 2).mean(axis=0))
    return X, rms, split


# ------------------------------------------------------------------ main per stack
def process_stack(cfg, stack_id):
    R = rcfg(cfg)
    st = cfg["stacks"][stack_id]
    sensor_key = "NISAR" if st["sensor"] == "NISAR" else "S1"
    band = st["band"]
    lam = st["wavelength_m"]
    sgn = R["phase_sign"][sensor_key]
    coh_min = R["coherence_min"][band]
    cm_per_rad = sgn * lam / FOUR_PI * 100.0
    closure_cm = R["closure_threshold_fraction"] * lam * 100.0
    tr, H, W = grid(cfg)
    out_dir = ROOT / R["out_dir"] / stack_id
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in list(out_dir.glob("*.tif")) + list(out_dir.glob("pairs/*.tif")):
        if old.name != "stable_ref.tif":
            old.unlink()

    pairs = inventory_nisar(cfg, stack_id) if sensor_key == "NISAR" else inventory_s1(cfg, stack_id)
    ref = reference_mask(cfg)
    water = water_mask(cfg)
    feat = ROOT / "data/interim/features"
    slope = read_grid_tif(feat / "slope.tif")
    dcoast = read_grid_tif(feat / "distance_to_coast.tif")
    temps = load_temps()
    alt_ref = s1_stable_mask(cfg) if sensor_key == "NISAR" else None
    if alt_ref is not None:
        print(f"  alternative reference: {int(alt_ref.sum())} Sentinel-1 stable cells")

    index = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "code_version": git_sha(),
        "stack_id": stack_id, "sensor": st["sensor"], "band": band, "wavelength_m": lam,
        "track": st.get("track"), "frame": st.get("frame"), "relative_orbit": st.get("relative_orbit"),
        "flight_dir": st["flight_dir"], "polarisation": "HH" if sensor_key == "NISAR" else "VV",
        "grid": {"crs": "EPSG:4326", "bbox": cfg["aoi"]["bbox"], "res_deg": cfg["processing"]["grid_res_deg"],
                 "width": W, "height": H},
        "units": "cm", "component": "vertical",
        "sign": "negative = sinking, relative to the reference area",
        "phase_to_los_sign": sgn,
        "reference": {"method": "airport_polygon", "file": "data/interim/context/aeroway.geojson",
                      "n_cells": int(ref.sum()),
                      "meaning": "Values are motion relative to the airport gravel pad", "diagnostics": {}},
        "corrections": {"ionosphere": "n/a" if sensor_key == "S1" else "pending", "deramp": False},
        "thresholds": {"coherence_min": coh_min, "min_valid_pair_fraction": R["min_valid_pair_fraction"],
                       "closure_cm": round(closure_cm, 2), "slope_flag_deg": R["slope_flag_deg"],
                       "coast_flag_m": R["coast_flag_m"]},
        "seasons": {},
    }

    by_season = defaultdict(list)
    for p in pairs:
        if p.ref.year == p.sec.year:
            by_season[p.ref.year].append(p)

    sign_checks = []
    incid = []
    for season in sorted(by_season):
        sp = by_season[season]
        print(f"[{stack_id}] season {season}: {len(sp)} pairs")
        data, plog = [], []
        for p in sp:
            d = read_nisar_pair(cfg, p, R["nisar_apply_ionosphere"], R["nisar_ionosphere_sign"]) \
                if sensor_key == "NISAR" else read_s1_pair(cfg, p)
            masked = {}
            coh = d["coh"]
            dl = d["phase"] * cm_per_rad
            if sensor_key == "S1" and "_native" in d and "los_disp_m" in d["_native"]:
                n = d["_native"]
                ok = np.isfinite(n["phase"]) & np.isfinite(n["los_disp_m"]) & (n["coh"] >= 0.5)
                if ok.sum() > 100:
                    a = np.polyfit(sgn * n["phase"][ok] * lam / FOUR_PI, n["los_disp_m"][ok], 1)[0]
                    sign_checks.append(float(a))
            bad_coh = ~(coh >= coh_min)
            masked["coherence"] = int((bad_coh & np.isfinite(dl)).sum())
            conn_flag = np.zeros((H, W), bool)
            dl[bad_coh] = np.nan
            masked["water"] = int((water & np.isfinite(dl)).sum())
            dl[water] = np.nan
            ref_used, ref_name = ref, "airport"
            if sensor_key == "NISAR":
                cc = d["cc"]
                bad_cc = ~(cc > 0)
                masked["conncomp"] = int((bad_cc & np.isfinite(dl)).sum())
                dl[bad_cc] = np.nan
                # airport first; if L-band lost it, ground Sentinel-1 found moving with the airport
                if (ref & np.isfinite(dl)).sum() < R["ref_min_valid_cells"] and alt_ref is not None:
                    ref_used, ref_name = alt_ref, "s1_stable_patches"
                labs = cc[ref_used & np.isfinite(dl)]
                if labs.size:
                    main = np.bincount(labs.astype(int)).argmax()
                    # no closure test exists for NISAR, so cells in other components (possible whole-cycle
                    # offsets) are masked rather than flagged (deviation from spec 02 5.3, recorded)
                    other = np.isfinite(dl) & (cc != main)
                    masked["other_component"] = int(other.sum())
                    dl[other] = np.nan
                    ref_used = ref_used & (cc == main)
                if R.get("nisar_deramp", True):
                    dl = dl - robust_plane(dl)
                    masked["deramp"] = True
                index["corrections"]["ionosphere"] = "applied" if d["iono_coverage"] >= 0.9 and R["nisar_apply_ionosphere"] else "unavailable"
            refv = dl[ref_used & np.isfinite(dl)]
            used, reason = True, None
            if refv.size < R["ref_min_valid_cells"]:
                used, reason = False, "reference not coherent"
            else:
                dl = dl - np.median(refv)
                masked["reference"] = ref_name
                # QC (NISAR): after referencing, the land median of a 12-day pair should be near zero.
                # A large offset means the reference sits across an unwrapping error: drop the pair.
                if sensor_key == "NISAR":
                    lm = float(np.nanmedian(dl[~water])) if np.isfinite(dl[~water]).any() else 0.0
                    masked["land_median_cm"] = round(lm, 2)
                    if abs(lm) > R.get("nisar_max_land_offset_cm", 2.0):
                        used, reason = False, f"reference offset {lm:.1f} cm (likely unwrapping error)"
            good = np.isfinite(dl)
            if sensor_key == "S1":
                conn, keep = connected_to_reference(good, ref, R["min_region_cells"])
                small = good & ~keep
                dl[small] = np.nan
                masked["small_region"] = int(small.sum())
                conn_flag = keep & ~conn
            land = ~water & np.isfinite(coh)
            cf = float((coh[land] >= coh_min).mean()) if land.any() else 0.0
            ramp = plane_ramp_cm(dl, np.isfinite(dl)) if used else None
            incid.append(np.rad2deg(d["theta"]))
            data.append({"dl": dl.astype("float32"), "coh": coh, "theta": d["theta"], "conn_flag": conn_flag})
            if sensor_key == "NISAR" and used:
                inc_dir = out_dir / "pairs"
                inc_dir.mkdir(exist_ok=True)
                write_tif(cfg, inc_dir / f"pair_{p.ref.strftime('%Y%m%d')}_{p.sec.strftime('%Y%m%d')}.tif",
                          (dl / np.cos(d["theta"])).astype("float32"))
            plog.append({"ref": p.ref.isoformat(), "sec": p.sec.isoformat(), "days": p.days, "id": p.pid,
                         "used": used, "reason": reason, "coherent_fraction": round(cf, 3),
                         "ramp_cm": None if ramp is None else round(ramp, 2),
                         "ramp_flag": bool(ramp is not None and ramp > R["ramp_warn_cm"]),
                         "masked": masked, "dropped_duplicates": p.extra.get("dropped_duplicates", []),
                         "cross_platform": bool(p.extra.get("cross_platform", False))})
            if not used:
                data[-1]["dl"][:] = np.nan

        # ---------------- usable season (spec 7.2)
        dates = sorted({p.ref for p in sp} | {p.sec for p in sp})
        consec = {}
        for k, p in enumerate(sp):
            i, j = dates.index(p.ref), dates.index(p.sec)
            if j == i + 1:
                consec[i] = plog[k]["coherent_fraction"] if plog[k]["used"] else 0.0
        fvals = [v for v in consec.values()]
        fmed = float(np.median(fvals)) if fvals else 0.0
        thr = R["first_date"]["min_coherent_ratio"] * fmed
        first_i, first_reason = None, None
        for i in range(len(dates) - 1):
            if consec.get(i, 0) < thr:
                continue
            t = pd.Timestamp(dates[i])
            win = temps.loc[t - pd.Timedelta(days=R["first_date"]["thaw_window"]): t - pd.Timedelta(days=1), "tmean_c"]
            thaw_ok = (win > 0).sum() >= R["first_date"]["thaw_days"] if win.notna().sum() >= 5 else True
            if thaw_ok:
                first_i = i
                first_reason = f"coherent fraction {consec[i]:.2f} >= {R['first_date']['min_coherent_ratio']} x median {fmed:.2f}; " \
                               f"{int((win > 0).sum())} of last {len(win)} days above 0 C"
                break
        last_i = None
        for j in range(len(dates) - 1, 0, -1):
            if consec.get(j - 1, 0) >= thr:
                last_i = j
                break
        end_md = R["season_end"].get(stack_id, cfg["season_window"]["end"])
        if first_i is None or last_i is None or last_i <= first_i:
            print(f"  no usable season for {season}")
            continue
        use_dates = [d for d in dates[first_i:last_i + 1] if d.strftime("%m-%d") <= end_md]
        keep_k = []
        for k, p in enumerate(sp):
            if p.ref in use_dates and p.sec in use_dates and plog[k]["used"]:
                keep_k.append(k)
            elif plog[k]["used"]:
                plog[k]["used"], plog[k]["reason"] = False, "outside usable season"
        N = len(use_dates)
        pidx = [(use_dates.index(sp[k].ref), use_dates.index(sp[k].sec)) for k in keep_k]
        D = np.stack([data[k]["dl"].ravel() for k in keep_k]) if keep_k else np.zeros((0, H * W), "float32")
        V = np.isfinite(D)

        # ---------------- unwrapping tests (spec 5.4)
        closure_fail = []
        if sensor_key == "S1":
            look = {pq: r for r, pq in enumerate(pidx)}
            for i in range(N - 2):
                a, b, c = look.get((i, i + 1)), look.get((i + 1, i + 2)), look.get((i, i + 2))
                if a is None or b is None or c is None:
                    continue
                clo = D[a] + D[b] - D[c]
                bad = np.abs(clo) > closure_cm
                bad &= np.isfinite(clo)
                closure_fail.append(float(bad.sum() / max(np.isfinite(clo).sum(), 1)))
                V[c] &= ~bad
                plog[keep_k[c]]["masked"]["unwrap_test"] = int(bad.sum())
        else:
            for r, (i, j) in enumerate(pidx):
                if j - i == 1 and (use_dates[j] - use_dates[i]).days > 13:
                    nb = [rr for rr, (ii, jj) in enumerate(pidx) if jj - ii == 1 and (ii == i - 1 or ii == j)]
                    if nb:
                        mean_nb = np.nanmean(np.stack([D[rr] for rr in nb]), axis=0)
                        exp = mean_nb * ((use_dates[j] - use_dates[i]).days / 12.0)
                        bad = np.isfinite(D[r]) & np.isfinite(exp) & (np.abs(D[r] - exp) > closure_cm)
                        V[r] &= ~bad
                        plog[keep_k[r]]["masked"]["unwrap_test"] = int(bad.sum())
        D = np.where(V, D, np.nan)

        # ---------------- inversion (spec 7.1)
        X, rms, split = invert(use_dates, pidx, np.nan_to_num(D), V)
        P = len(pidx)
        vfrac = V.sum(axis=0) / max(P, 1)
        enough = vfrac >= R["min_valid_pair_fraction"]
        X[:, ~enough] = np.nan
        rms[~enough] = np.nan

        # ---------------- vertical (spec 8)
        theta = np.nanmedian(np.stack([data[k]["theta"] for k in keep_k]), axis=0).ravel()
        cos_t = np.cos(theta)
        Xv = X / cos_t[None, :]
        rms_v = rms / cos_t
        Xv = Xv.reshape(N, H, W)

        # ---------------- quality layers (spec 11)
        coh_mean = np.nanmean(np.stack([data[k]["coh"] for k in keep_k]), axis=0)
        coh_mean[water] = np.nan
        valid_frac = np.isfinite(Xv).sum(axis=0) / N
        valid_frac = valid_frac.astype("float32")
        valid_frac[water] = np.nan
        if sensor_key == "S1":
            noise = rms_v.reshape(H, W).astype("float32")
        else:
            noise = stefan_noise(Xv, use_dates, temps)
        noise[np.isfinite(Xv).sum(axis=0) < 5] = np.nan
        flags = np.zeros((H, W), "uint8")
        flags[(slope > R["slope_flag_deg"]) | ((dcoast > 0) & (dcoast < R["coast_flag_m"]))] |= 1
        conn_any = np.any(np.stack([data[k]["conn_flag"] for k in keep_k]), axis=0)
        flags[conn_any & np.isfinite(Xv[-1])] |= 2
        flags[split.reshape(H, W) & np.isfinite(Xv[0])] |= 4
        flags[ref] |= 8
        if sensor_key == "NISAR" and index["corrections"]["ionosphere"] != "applied":
            flags |= 16

        # ---------------- write
        dlog = []
        for n, dt in enumerate(use_dates):
            fn = f"cum_{dt.strftime('%Y%m%d')}.tif"
            write_tif(cfg, out_dir / fn, Xv[n])
            t = pd.Timestamp(dt)
            pr3 = temps.loc[t - pd.Timedelta(days=3): t - pd.Timedelta(days=1)]
            wet = bool(pr3["precip_mm"].fillna(0).sum() > 10) if "precip_mm" in pr3 else False
            tmx = temps.loc[t - pd.Timedelta(days=3): t - pd.Timedelta(days=1), "tmax_c"]
            frz = bool(len(tmx) == 3 and (tmx < 0).all())
            dlog.append({"date": dt.isoformat(), "file": fn, "wet_flag": wet, "freeze_flag": frz})
        write_tif(cfg, out_dir / f"coh_{season}.tif", coh_mean)
        write_tif(cfg, out_dir / f"valid_{season}.tif", valid_frac)
        write_tif(cfg, out_dir / f"noise_{season}.tif", noise)
        write_tif(cfg, out_dir / f"flags_{season}.tif", flags, nodata=0, dtype="uint8")

        # ---------------- reference diagnostic, checks
        last = Xv[-1]
        land_valid = np.isfinite(last) & ~ref
        land_med = float(np.nanmedian(last[land_valid])) if land_valid.any() else None
        index["reference"]["diagnostics"][str(season)] = {
            "airport_minus_coherent_land_median_cm": None if land_med is None else round(-land_med, 2)}
        gaps = [{"from": use_dates[n].isoformat(), "to": use_dates[n + 1].isoformat(),
                 "days": (use_dates[n + 1] - use_dates[n]).days,
                 "bridged": any(i <= n < j for i, j in pidx)}
                for n in range(N - 1) if (use_dates[n + 1] - use_dates[n]).days > 12]
        tdd_before = tdd_between(temps, pd.Timestamp(season, 4, 1), pd.Timestamp(use_dates[0]))
        checks = sanity_checks(Xv, use_dates, ref, water, read_grid_tif(feat / "water_occurrence.tif"),
                               D, V, pidx, lam, H, W, land_med)
        if sign_checks:
            checks.append({"name": "hyp3_agreement", "pass": bool(abs(np.median(sign_checks) - 1) <= 0.01),
                           "value": round(float(np.median(sign_checks)), 4)})
        seg_end = max((n for n in range(N) if np.isfinite(Xv[n]).any()), default=0)
        index["seasons"][str(season)] = {
            "first_usable_date": use_dates[0].isoformat(), "first_date_reason": first_reason,
            "thaw_started_before_first_date": bool(tdd_before > 0), "tdd_before_first_date": round(tdd_before, 1),
            "last_usable_date": use_dates[-1].isoformat(),
            "dates": dlog, "pairs": plog, "gaps": gaps,
            "network": {"connected": bool(not split.any()),
                        "segments": [[use_dates[0].isoformat(), use_dates[seg_end].isoformat()]],
                        "cells_split_share": round(float(split[enough].mean()) if enough.any() else 0.0, 3)},
            "stats": {"valid_cell_fraction": round(float(np.isfinite(last)[~water].mean()), 3),
                      "median_cum_land_cm": None if land_med is None else round(land_med, 2),
                      "noise_median_cm": None if not np.isfinite(noise).any() else round(float(np.nanmedian(noise)), 2),
                      "closure_fail_fraction": None if not closure_fail else round(float(np.mean(closure_fail)), 4),
                      "coh_median_land": round(float(np.nanmedian(coh_mean)), 3)},
            "checks": checks,
            "files": {"coh": f"coh_{season}.tif", "valid": f"valid_{season}.tif",
                      "noise": f"noise_{season}.tif", "flags": f"flags_{season}.tif"},
        }
        s = index["seasons"][str(season)]["stats"]
        print(f"  {use_dates[0]}..{use_dates[-1]}  N={N} P={P}  valid={s['valid_cell_fraction']}  "
              f"land median={s['median_cum_land_cm']} cm  noise={s['noise_median_cm']}  checks="
              f"{[(c['name'], c['pass']) for c in checks]}")

    inc_all = np.concatenate([a[np.isfinite(a)].ravel() for a in incid]) if incid else np.array([np.nan])
    index["incidence_deg"] = {"min": round(float(np.nanmin(inc_all)), 1), "max": round(float(np.nanmax(inc_all)), 1),
                              "mean": round(float(np.nanmean(inc_all)), 1),
                              "source": "HyP3 lv_theta (pi/2 - lv_theta)" if sensor_key == "S1" else "radarGrid/incidenceAngle at 0 m"}
    if sign_checks:
        index["sign_check"] = {"method": "regression on HyP3 los_disp (native grid, coh >= 0.5)",
                               "result": "pass" if abs(np.median(sign_checks) - 1) <= 0.01 else "fail",
                               "detail": f"median slope {np.median(sign_checks):.4f} over {len(sign_checks)} pairs"}
    json.dump(index, open(out_dir / "index.json", "w"), indent=1, default=str)
    return index


def s1_stable_mask(cfg, max_abs_cm=0.3, min_seasons=3, min_coh=0.6):
    """Cells whose Sentinel-1 thaw-season change matches the airport (|median| <= 0.3 cm over >= 3 seasons).

    Used only as NISAR's fallback reference when L-band loses the airport pad (spec 02 4.2 option C,
    chosen from an independent sensor so it is not circular within NISAR).
    """
    d = ROOT / rcfg(cfg)["out_dir"] / "s1_p137"
    ixp = d / "index.json"
    if not ixp.exists():
        return None
    ix = json.load(open(ixp))
    totals, cohs = [], []
    for season, v in ix["seasons"].items():
        ds = [x for x in v["dates"] if x["date"][5:] <= "09-15"]
        if not ds:
            continue
        totals.append(read_grid_tif(d / ds[-1]["file"]))
        cohs.append(read_grid_tif(d / v["files"]["coh"]))
    if not totals:
        return None
    T = np.stack(totals)
    n = np.isfinite(T).sum(axis=0)
    med = np.nanmedian(np.where(n[None] > 0, T, 0), axis=0)
    med[n == 0] = np.nan
    coh = np.nanmean(np.stack(cohs), axis=0)
    m = (n >= min_seasons) & (np.abs(med) <= max_abs_cm) & (coh >= min_coh)
    write_tif(cfg, d / "stable_ref.tif", m.astype("float32"))
    return m


def tdd_between(temps, t0, t1):
    s = temps.loc[t0: t1 - pd.Timedelta(days=1), "tmean_c"]
    return float(s.clip(lower=0).sum())


def stefan_noise(Xv, dates, temps):
    """NISAR noise: RMS about x(t) = a*sqrt(TDD(t)) + c per cell (spec 11.1 b)."""
    t0 = pd.Timestamp(dates[0])
    A = np.array([np.sqrt(tdd_between(temps, t0, pd.Timestamp(d) + pd.Timedelta(days=1))) for d in dates])
    N, H, W = Xv.shape
    Y = Xv.reshape(N, -1)
    out = np.full(H * W, np.nan, "float32")
    ok = np.isfinite(Y).all(axis=0)
    if ok.sum() and N >= 3:
        G = np.c_[A, np.ones(N)]
        sol, *_ = np.linalg.lstsq(G, Y[:, ok], rcond=None)
        res = G @ sol - Y[:, ok]
        out[ok] = np.sqrt((res ** 2).sum(axis=0) / max(N - 2, 1))
    # partial records: use available dates
    part = ~ok & (np.isfinite(Y).sum(axis=0) >= 5)
    for c in np.nonzero(part)[0]:
        m = np.isfinite(Y[:, c])
        G = np.c_[A[m], np.ones(m.sum())]
        sol, *_ = np.linalg.lstsq(G, Y[m, c], rcond=None)
        out[c] = np.sqrt(((G @ sol - Y[m, c]) ** 2).sum() / max(m.sum() - 2, 1))
    return out.reshape(H, W)


def sanity_checks(Xv, dates, ref, water, occ, D, V, pidx, lam, H, W, land_med):
    checks = []
    # tundra sinks (latest date in mid-Sept or the last date)
    checks.append({"name": "tundra_sinks", "pass": bool(land_med is not None and land_med < 0),
                   "value": None if land_med is None else round(land_med, 2)})
    refmax = max((abs(float(np.nanmedian(Xv[n][ref]))) for n in range(len(dates)) if np.isfinite(Xv[n][ref]).any()),
                 default=None)
    checks.append({"name": "reference_near_zero", "pass": bool(refmax is not None and refmax < 0.2),
                   "value": None if refmax is None else round(refmax, 3)})
    lake = (occ >= 50) & np.isfinite(Xv[-1])
    checks.append({"name": "lakes_masked", "pass": bool(lake.sum() == 0), "value": int(lake.sum())})
    q = lam * 100 / 4
    worst = 0.0
    for r in range(D.shape[0]):
        a = D[r].reshape(H, W)
        dx = np.abs(np.diff(a, axis=1))
        dy = np.abs(np.diff(a, axis=0))
        n = np.isfinite(dx).sum() + np.isfinite(dy).sum()
        if n:
            frac = ((dx > q).sum() + (dy > q).sum()) / n
            worst = max(worst, float(frac))
    checks.append({"name": "no_cycle_jumps", "pass": bool(worst < 0.01), "value": round(worst, 4)})
    return checks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stack", default="all")
    a = ap.parse_args()
    cfg = load_config()
    stacks = ["s1_p137", "nisar_t159"] if a.stack == "all" else [a.stack]
    for s in stacks:
        process_stack(cfg, s)


if __name__ == "__main__":
    main()
