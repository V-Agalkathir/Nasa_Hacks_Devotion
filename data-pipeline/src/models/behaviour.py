"""Model A: measured ground behaviour classes (spec 03 section 2).

All arrays are flattened over the shared grid (M = H*W cells). Distances and blocks use UTM 8N
coordinates of cell centres, so nothing is computed in degrees.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date
from itertools import permutations

import numpy as np
import pandas as pd

from common import ROOT
from radar_read import read_grid_tif
from models import tdd as T

CLASS = {"cant": 0, "stable": 1, "seasonal": 2, "degrading": 3, "nodata": 255}


# ---------------------------------------------------------------- data
@dataclass
class Season:
    stack: str
    sensor: str
    band: str
    year: int
    dates: list
    Y: np.ndarray          # (n, M) cm, NaN masked
    A: np.ndarray          # (n,)
    coh: np.ndarray        # (M,)
    valid: np.ndarray      # (M,)
    noise: np.ndarray      # (M,)
    info: dict = field(default_factory=dict)
    days_since_on: np.ndarray = None
    md: list = None


def load_stack(cfg, stack_id, temps, tcfg, years=None):
    d = ROOT / "data/interim/motion" / stack_id
    ix = json.load(open(d / "index.json"))
    out = []
    for ys, v in sorted(ix["seasons"].items()):
        y = int(ys)
        if years is not None and y not in years:
            continue
        info = T.season_info(temps, y, tcfg)
        if info["excluded"]:
            print(f"  season {y} excluded (temperature)")
            continue
        all_dates = [date.fromisoformat(x["date"]) for x in v["dates"]]
        t_end = T.season_end_date(info, all_dates)
        keep = [k for k, dd in enumerate(all_dates) if t_end is not None and dd <= t_end]
        dates = [all_dates[k] for k in keep]
        Y = np.stack([read_grid_tif(d / v["dates"][k]["file"]).ravel() for k in keep])
        A = T.A_series(temps, info, dates)
        t_on = date.fromisoformat(info["t_on"])
        dso = np.array([max((dd - t_on).days, 0) for dd in dates], float)
        info["t_end"] = None if t_end is None else t_end.isoformat()
        coh = read_grid_tif(d / v["files"]["coh"]).ravel()
        valid = read_grid_tif(d / v["files"]["valid"]).ravel()
        valid[~np.isfinite(coh)] = np.nan          # outside this season's footprint, not "invalid"
        out.append(Season(stack_id, ix["sensor"], ix["band"], y, dates, Y, A, coh, valid,
                          read_grid_tif(d / v["files"]["noise"]).ravel(), info,
                          days_since_on=dso, md=[dd.strftime("%m-%d") for dd in dates]))
    return out


# ---------------------------------------------------------------- fits
def fit_lin(x, Y, V):
    """Per-cell OLS y = c - E x on valid entries. x (n,), Y (n,M), V (n,M) bool."""
    n = V.sum(0).astype(float)
    with np.errstate(invalid="ignore", divide="ignore"):
        X = np.where(V, x[:, None], 0.0)
        Y0 = np.where(V, Y, 0.0)
        xbar = X.sum(0) / n
        ybar = Y0.sum(0) / n
        dx = np.where(V, x[:, None] - xbar, 0.0)
        dy = np.where(V, Y - ybar, 0.0)
        Sxx = (dx ** 2).sum(0)
        Sxy = (dx * dy).sum(0)
        E = -Sxy / Sxx
        res = np.where(V, dy + E * dx, 0.0)
        rss = (res ** 2).sum(0)
        sigma = np.sqrt(rss / (n - 2))
        SE = sigma / np.sqrt(Sxx)
        xmax = np.where(V, x[:, None], -np.inf).max(0)
        xmin = np.where(V, x[:, None], np.inf).min(0)
    return {"E": E, "SE": SE, "sigma": sigma, "n": n, "xbar": xbar, "ybar": ybar, "Sxx": Sxx,
            "span": xmax - xmin, "rss": rss}


def fit_season(s: Season, bc, x=None):
    """F1 for one season. Returns dict with E_s, SE_s, sigma, n and the late-season excess pieces."""
    x = s.A if x is None else x
    V = np.isfinite(s.Y)
    f = fit_lin(x, s.Y, V)
    ok = (f["n"] >= bc["min_dates_per_season"]) & (f["span"] >= bc["min_A_span"]) & np.isfinite(f["E"])
    f["ok"] = ok
    for k in ("E", "SE", "sigma"):
        f[k] = np.where(ok, f[k], np.nan)
    return f


def late_excess(s: Season, bc, sigma_floor):
    """F3: late-season excess per cell (before reference subtraction). Returns L, SE_L (NaN if undefined)."""
    A = s.A
    amin, amax = A.min(), A.max()
    late = np.array([(md >= bc["late_md"]) and (a >= amin + (1 - bc["late_A_share"]) * (amax - amin))
                     for md, a in zip(s.md, A)])
    M = s.Y.shape[1]
    if not late.any():
        return np.full(M, np.nan), np.full(M, np.nan)
    first_late = int(np.argmax(late))
    early = np.zeros_like(late)
    early[:first_late] = True
    V = np.isfinite(s.Y)
    Ve = V & early[:, None]
    Vl = V & late[:, None]
    fe = fit_lin(A, s.Y, Ve)
    n_l = Vl.sum(0).astype(float)
    with np.errstate(invalid="ignore", divide="ignore"):
        pred = fe["ybar"] - fe["E"] * (A[:, None] - fe["xbar"])
        r = np.where(Vl, s.Y - pred, 0.0)
        L = -(r.sum(0) / n_l)
        xbar_l = np.where(Vl, A[:, None], 0).sum(0) / n_l
        sig = np.fmax(fe["sigma"], sigma_floor)
        SE = sig * np.sqrt(1 / n_l + 1 / fe["n"] + (xbar_l - fe["xbar"]) ** 2 / fe["Sxx"])
    ok = (fe["n"] >= bc["min_early_dates"]) & (n_l >= 1) & np.isfinite(L) & np.isfinite(SE)
    return np.where(ok, L, np.nan), np.where(ok, SE, np.nan)


def pool(Es, SEs, cap):
    """F1': capped inverse-variance pooling across seasons. Es, SEs (k, M)."""
    w = 1.0 / SEs ** 2
    w = np.where(np.isfinite(w) & np.isfinite(Es), w, np.nan)
    with np.errstate(invalid="ignore", divide="ignore"):
        medw = np.nanmedian(w, axis=0)
        w = np.fmin(w, cap * medw)
        sw = np.nansum(w, axis=0)
        E = np.nansum(np.nan_to_num(w) * np.nan_to_num(Es), axis=0) / sw
        k = np.isfinite(w).sum(0)
        chi = np.nansum(np.nan_to_num(w) * (np.nan_to_num(Es) - E) ** 2, axis=0) / np.maximum(k - 1, 1)
        SE = np.sqrt(1 / sw) * np.fmax(1, np.sqrt(chi))
    E[k == 0] = np.nan
    SE[k == 0] = np.nan
    return E, SE, k


def theil_sen_mk(years, Es):
    """Theil-Sen slope and exact one-sided Mann-Kendall p (rising) per cell, grouped by season pattern."""
    k, M = Es.shape
    slope = np.full(M, np.nan)
    p = np.full(M, np.nan)
    V = np.isfinite(Es)
    pats, inv = np.unique(V.T, axis=0, return_inverse=True)
    inv = inv.ravel()
    for pi, pat in enumerate(pats):
        idx = np.nonzero(pat)[0]
        n = len(idx)
        cells = np.nonzero(inv == pi)[0]
        if n < 4 or cells.size == 0:
            continue
        yrs = np.asarray(years)[idx].astype(float)
        E = Es[idx][:, cells]
        sl = []
        S = np.zeros(cells.size)
        for a in range(n):
            for b in range(a + 1, n):
                sl.append((E[b] - E[a]) / (yrs[b] - yrs[a]))
                S += np.sign(E[b] - E[a])
        slope[cells] = np.median(np.stack(sl), axis=0)
        # exact null distribution of S over permutations of ranks
        null = []
        for perm in permutations(range(n)):
            s_ = 0
            for a in range(n):
                for b in range(a + 1, n):
                    s_ += np.sign(perm[b] - perm[a])
            null.append(s_)
        null = np.sort(np.array(null))
        p[cells] = 1.0 - np.searchsorted(null, S, side="left") / len(null)
    return slope, p


def bh(pvals, q):
    """Benjamini-Hochberg: boolean mask of discoveries over finite p-values."""
    out = np.zeros(pvals.shape, bool)
    ok = np.isfinite(pvals)
    pv = pvals[ok]
    if pv.size == 0:
        return out
    order = np.argsort(pv)
    m = pv.size
    thr = q * (np.arange(1, m + 1) / m)
    passed = pv[order] <= thr
    if passed.any():
        kmax = np.nonzero(passed)[0].max()
        sel = np.zeros(m, bool)
        sel[order[:kmax + 1]] = True
        tmp = np.zeros(ok.sum(), bool)
        tmp[:] = sel
        out[np.nonzero(ok)[0]] = tmp
    return out


# ---------------------------------------------------------------- model fit across seasons
def fit_model(seasons, bc, ref_cells, water, use_trend=True, x_kind="A"):
    """Fit Model A on a list of seasons. Returns dict of per-cell products and season pieces."""
    M = seasons[0].Y.shape[1]
    Es, SEs, sig2, dof, Ls, SELs, years = [], [], [], [], [], [], []
    for s in seasons:
        x = s.A if x_kind == "A" else np.sqrt(s.days_since_on)
        f = fit_season(s, bc, x)
        Es.append(f["E"]); SEs.append(f["SE"]); years.append(s.year)
        rss = np.where(f["ok"], f["rss"], np.nan)
        sig2.append(rss); dof.append(np.where(f["ok"], f["n"] - 2, np.nan))
    Es, SEs = np.stack(Es), np.stack(SEs)
    with np.errstate(invalid="ignore", divide="ignore"):
        sigma_p = np.sqrt(np.nansum(np.stack(sig2), 0) / np.nansum(np.stack(dof), 0))
    if x_kind != "A":
        E, SE, k = pool(Es, SEs, bc["season_weight_cap"])
        return {"E": E, "SE": SE, "k": k, "Es": Es}
    # Part 2 noise: use the larger of the two
    p2 = np.nanmedian(np.stack([s.noise for s in seasons]), 0)
    sigma_p = np.fmax(sigma_p, np.nan_to_num(p2))
    for s in seasons:
        L, SEL = late_excess(s, bc, np.nan_to_num(sigma_p))
        Ls.append(L); SELs.append(SEL)
    Ls, SELs = np.stack(Ls), np.stack(SELs)
    E, SE, k = pool(Es, SEs, bc["season_weight_cap"])
    # reference patches
    R = ref_cells & np.isfinite(E)
    E_ref = float(np.nanmedian(E[R])) if R.sum() >= 5 else 0.0
    sigma_ref = float(1.4826 * np.nanmedian(np.abs(E[R] - E_ref))) if R.sum() >= 5 else 0.0
    Lref = np.array([np.nanmedian(L[ref_cells]) if np.isfinite(L[ref_cells]).sum() >= 5 else 0.0 for L in Ls])
    Lp = Ls - Lref[:, None]
    dA = np.array([s.A.max() - s.A.min() for s in seasons])
    dA_med = float(np.median(dA))
    E_floor = bc["E_floor_cm_per_season"] / dA_med
    tau = max(2 * sigma_ref, E_floor)
    Erel = E - E_ref
    out = {"E": E, "SE": SE, "k": k, "Es": Es, "SEs": SEs, "years": years, "Ls": Ls, "SELs": SELs, "Lp_s": Lp,
           "Lp": np.nanmedian(np.where(np.isfinite(Lp), Lp, np.nan), axis=0) if np.isfinite(Lp).any() else np.full(M, np.nan),
           "sigma_p": sigma_p, "E_ref": E_ref, "sigma_ref": sigma_ref, "tau": tau, "E_floor": E_floor,
           "dA_med": dA_med, "Erel": Erel}
    # coherence and valid share over seasons where the cell is inside the footprint
    C = np.stack([s.coh for s in seasons])
    Vv = np.stack([s.valid for s in seasons])
    out["coh_mean"] = np.nanmean(C, 0)
    out["valid_share"] = np.nanmean(Vv, 0)
    out["n_seasons"] = k
    # trend
    if use_trend:
        slope, p = theil_sen_mk(years, Es)
        screened = (k >= bc["min_seasons"]) & ~water
        disc = bh(np.where(screened, p, np.nan), bc["slope_fdr_q"])
        medE = np.nanmedian(E[screened & (Erel > tau)]) if (screened & (Erel > tau)).any() else E_floor
        medE = max(medE, E_floor)
        big = slope * (k - 1) >= bc["slope_min_change_share"] * medE
        out.update({"E_slope": slope, "mk_p": p, "rising": disc & big & screened,
                    "rising_rule": {"median_E_used": float(medE), "n_discoveries": int(disc.sum())}})
    else:
        out.update({"E_slope": np.full(M, np.nan), "mk_p": np.full(M, np.nan), "rising": np.zeros(M, bool)})
    return out


def late_flags(m, bc):
    Lp, SEL = m["Lp_s"], m["SELs"]
    exceed_m = (Lp > bc["late_k_multi"] * SEL) & np.isfinite(Lp)
    exceed_s = (Lp > bc["late_k_single"] * SEL) & np.isfinite(Lp)
    nd = np.isfinite(Lp).sum(0)
    ne = exceed_m.sum(0)
    multi = (ne >= np.ceil(nd / 2)) & (ne >= 2)
    short_one = (nd == 1) & exceed_s.any(0)
    short_all = (nd >= 2) & (ne == nd)
    return multi, short_one | short_all


def classify(m, bc, water, band="C", trend=True, force_short=False):
    """Fixed rules (2.4a multi-season, 2.4b short record). Returns uint8 classes."""
    M = m["E"].shape[0]
    cls = np.full(M, CLASS["nodata"], np.uint8)
    land = ~water
    k = m["n_seasons"]
    multi_ok = (k >= bc["min_seasons"]) & (not force_short)
    late_m, late_s = late_flags(m, bc)
    cant = (~(m["coh_mean"] >= bc["coh_min"][band])) | (~(m["valid_share"] >= bc["valid_share_min"])) | (k == 0)
    stable = m["Erel"] <= m["tau"]
    degr_multi = late_m | ((m["rising"] if trend else False) & (m["Erel"] > m["tau"]))
    degr_short = late_s
    degr = np.where(multi_ok, degr_multi, degr_short)
    c = np.full(M, CLASS["seasonal"], np.uint8)
    c[stable] = CLASS["stable"]
    c[degr] = CLASS["degrading"]
    c[cant] = CLASS["cant"]
    cls[land] = c[land]
    return cls


def confidence(m, bc, band, seasons):
    c_coh = np.clip(m["coh_mean"] / bc["coh_good"][band], 0, 1)
    c_valid = np.clip(m["valid_share"], 0, 1)
    denom = np.fmax(np.abs(m["E"]) * m["dA_med"], m["tau"] * m["dA_med"])   # deviation: tau floor (sigma_ref ~ 0)
    c_fit = np.clip(1 - m["sigma_p"] / denom, 0, 1)
    c_n = np.clip(0.5 + 0.1 * (m["n_seasons"] - 1), 0.5, 1)
    with np.errstate(invalid="ignore"):
        conf = (np.nan_to_num(c_coh) * np.nan_to_num(c_valid) * np.nan_to_num(c_fit) * c_n) ** 0.25
    if any(s.info.get("temp_quality") == "low" for s in seasons):
        conf *= bc["temp_low_conf_factor"]
    conf = np.where(m["n_seasons"] <= 1, np.fmin(conf, bc["single_season_conf_cap"]), conf)
    conf[m["n_seasons"] == 0] = 0
    return conf


def conf_bin(conf, bc):
    b = np.zeros(conf.shape, np.uint8)            # 0 low
    b[conf >= bc["conf_bins"]["medium"]] = 1
    b[conf >= bc["conf_bins"]["high"]] = 2
    return b
