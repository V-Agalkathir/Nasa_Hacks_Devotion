"""Model A tests (spec 03 section 2.6), final fit, robustness and this-season expectation (2.7)."""
from __future__ import annotations

import glob
import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import cohen_kappa_score, confusion_matrix

from common import ROOT
from radar_read import read_grid_tif
from models import behaviour as B
from models import tdd as T

RNG = np.random.default_rng(0)


# ---------------------------------------------------------------- block helpers
def block_ids(x, y, size_m, shift=0.0):
    bx = np.floor((x + shift) / size_m).astype(np.int64)
    by = np.floor((y + shift) / size_m).astype(np.int64)
    return bx * 100000 + by


def block_median(values, bid, mask, min_n=5):
    d = pd.DataFrame({"b": bid[mask], "v": values[mask]})
    g = d.groupby("b")["v"]
    med = g.median()
    med[g.count() < min_n] = np.nan
    return med


def spearman_blocks(a, b, bid, mask, min_n=5):
    A = block_median(a, bid, mask, min_n)
    Bm = block_median(b, bid, mask, min_n)
    df = pd.concat([A, Bm], axis=1).dropna()
    if len(df) < 8:
        return np.nan, df
    return float(spearmanr(df.iloc[:, 0], df.iloc[:, 1])[0]), df


def boot_spearman(df, n=1000):
    if len(df) < 8:
        return [None, None]
    v = df.values
    out = []
    for _ in range(n):
        idx = RNG.integers(0, len(v), len(v))
        out.append(spearmanr(v[idx, 0], v[idx, 1])[0])
    return [round(float(np.nanpercentile(out, 2.5)), 3), round(float(np.nanpercentile(out, 97.5)), 3)]


def kappa_with_ci(c1, c2, bid, n=1000):
    labels = [1, 2, 3]
    if c1.size < 50:
        return None, [None, None], None
    k = cohen_kappa_score(c1, c2, labels=labels)
    cm = confusion_matrix(c1, c2, labels=labels)
    ub, inv = np.unique(bid, return_inverse=True)
    per = np.zeros((len(ub), 3, 3))
    np.add.at(per, (inv, c1 - 1, c2 - 1), 1)
    ks = []
    for _ in range(n):
        idx = RNG.integers(0, len(ub), len(ub))
        m = per[idx].sum(0)
        tot = m.sum()
        po = np.trace(m) / tot
        pe = (m.sum(0) * m.sum(1)).sum() / tot ** 2
        ks.append((po - pe) / (1 - pe) if pe < 1 else np.nan)
    return float(k), [round(float(np.nanpercentile(ks, 2.5)), 3), round(float(np.nanpercentile(ks, 97.5)), 3)], cm


def status3(v, pas, part, higher=True):
    if v is None or not np.isfinite(v):
        return "not_available"
    if v >= pas:
        return "pass"
    if v >= part:
        return "partial"
    return "fail"


def worst(sts):
    order = ["fail", "partial", "pass"]
    s = [x for x in sts if x in order]
    if not s:
        return "not_available"
    return min(s, key=order.index)


# ---------------------------------------------------------------- Test A
def test_a(cfg, temps, train, tests, ref, water, x, y):
    mc = cfg["models"]
    bc = mc["behaviour"]
    thr = mc["thresholds"]["test_a"]
    bid = block_ids(x, y, bc["bootstrap"]["block_m"])
    land = ~water
    frozen = B.fit_model(train, bc, ref, water)
    comp = B.classify(frozen, bc, water, trend=False)
    conf_f = B.confidence(frozen, bc, "C", train)
    cbin_f = B.conf_bin(conf_f, bc)
    tb = B.fit_model(train, bc, ref, water, x_kind="sqrt_days")
    curve = T.mean_training_curve(temps, [s.info for s in train])
    E = frozen["E"]
    sse = {"model": {}, "zero": {}, "time": {}, "avgwarm": {}}
    pix = {k: [0.0, 0] for k in sse}
    rho_pix, rho_blk, kappas = [], [], []
    k_c1, k_c2, k_bid, conf_pairs = [], [], [], []
    per_season = {}
    Aend_train = np.array([s.A.max() for s in train])
    for s in tests:
        V = np.isfinite(s.Y)
        cells = land & (cbin_f >= 1) & np.isin(comp, [1, 2, 3]) & (V.sum(0) >= 5) & np.isfinite(E) & np.isfinite(tb["E"])
        Yc = np.where(V, s.Y, np.nan)[:, cells]
        Vc = V[:, cells]
        preds = {
            "model": -E[cells][None, :] * s.A[:, None],
            "zero": np.zeros_like(Yc),
            "time": -tb["E"][cells][None, :] * np.sqrt(s.days_since_on)[:, None],
            "avgwarm": -E[cells][None, :] * np.sqrt(np.array([curve.get(md, curve.iloc[-1]) for md in s.md]))[:, None],
        }
        obs_c = Yc - np.nanmean(Yc, 0)
        b = bid[cells]
        ub, inv = np.unique(b, return_inverse=True)
        for name, P in preds.items():
            P = np.where(Vc, P, np.nan)
            pc = P - np.nanmean(P, 0)
            r = obs_c - pc
            pix[name][0] += float(np.nansum(r ** 2))
            pix[name][1] += int(np.isfinite(r).sum())
            # block level: block medians of centred observed and predicted series per date
            bo = np.full((len(s.dates), len(ub)), np.nan)
            bp = np.full((len(s.dates), len(ub)), np.nan)
            for t in range(len(s.dates)):
                do = pd.Series(obs_c[t]).groupby(inv).median()
                dp = pd.Series(pc[t]).groupby(inv).median()
                cnt = pd.Series(np.isfinite(obs_c[t])).groupby(inv).sum()
                ok = cnt.values >= 5
                bo[t, do.index[ok]] = do.values[ok]
                bp[t, dp.index[ok]] = dp.values[ok]
            err = (bo - bp) ** 2
            for j, bb in enumerate(ub):
                e = err[:, j]
                e = e[np.isfinite(e)]
                if e.size:
                    acc = sse[name].setdefault(bb, [0.0, 0])
                    acc[0] += float(e.sum())
                    acc[1] += int(e.size)
        # rho: E_train vs E_test (F1 on the test season alone)
        ft = B.fit_season(s, bc)
        Et = ft["E"]
        mk = cells & np.isfinite(Et)
        rp = float(spearmanr(E[mk], Et[mk])[0]) if mk.sum() > 50 else np.nan
        rb, dfb = spearman_blocks(E, Et, bid, mk)
        rho_pix.append(rp)
        rho_blk.append((rb, dfb))
        # kappa: comparison map vs test-season short-record map, confident in both
        mt = B.fit_model([s], bc, ref, water, use_trend=False)
        ct = B.classify(mt, bc, water, trend=False, force_short=True)
        cbt = B.conf_bin(B.confidence(mt, bc, "C", [s]), bc)
        both = land & (cbin_f >= 1) & (cbt >= 1) & np.isin(comp, [1, 2, 3]) & np.isin(ct, [1, 2, 3])
        k_c1.append(comp[both].astype(int)); k_c2.append(ct[both].astype(int)); k_bid.append(bid[both])
        conf_pairs.append((cbin_f[both], comp[both] == ct[both]))
        z = (s.A.max() - Aend_train.mean()) / (Aend_train.std(ddof=1) if len(Aend_train) > 1 else 1)
        per_season[str(s.year)] = {
            "n_pixels": int(cells.sum()), "rho_pixel": None if not np.isfinite(rp) else round(rp, 3),
            "rho_block": None if not np.isfinite(rb) else round(rb, 3),
            "warmth_anomaly_z": round(float(z), 2),
            "coh_median": round(float(np.nanmedian(s.coh[land])), 3),
            "noise_median_cm": round(float(np.nanmedian(s.noise[land])), 3) if np.isfinite(s.noise[land]).any() else None,
            "class_shares_test_map": {str(c): round(float((ct[land] == c).mean()), 3) for c in (0, 1, 2, 3)},
        }

    def pooled_rmse(acc, keys=None):
        keys = list(acc.keys()) if keys is None else keys
        num = sum(acc[k][0] for k in keys if k in acc)
        den = sum(acc[k][1] for k in keys if k in acc)
        return np.sqrt(num / den) if den else np.nan

    blocks = sorted(set().union(*[set(sse[k].keys()) for k in sse]))
    rm = {k: pooled_rmse(sse[k], blocks) for k in sse}
    ref_name = "zero" if rm["zero"] <= rm["time"] else "time"
    skill = 1 - rm["model"] ** 2 / rm[ref_name] ** 2
    warm_skill = 1 - rm["model"] ** 2 / rm["avgwarm"] ** 2
    bs = []
    barr = np.array(blocks)
    for _ in range(bc["bootstrap"]["n"]):
        idx = barr[RNG.integers(0, len(barr), len(barr))]
        r = {k: pooled_rmse(sse[k], idx) for k in sse}
        rr = min(r["zero"], r["time"])
        bs.append(1 - r["model"] ** 2 / rr ** 2)
    skill_ci = [round(float(np.nanpercentile(bs, 2.5)), 3), round(float(np.nanpercentile(bs, 97.5)), 3)]
    # pooled block rho across both test seasons
    dfall = pd.concat([d for _, d in rho_blk if len(d)], axis=0)
    rho_b = float(spearmanr(dfall.iloc[:, 0], dfall.iloc[:, 1])[0]) if len(dfall) >= 8 else np.nan
    rho_ci = boot_spearman(dfall, bc["bootstrap"]["n"])
    c1, c2, kb = np.concatenate(k_c1), np.concatenate(k_c2), np.concatenate(k_bid)
    kap, kap_ci, cm = kappa_with_ci(c1, c2, kb, bc["bootstrap"]["n"])
    # noise ceiling and leave-one-year-out (training only)
    Es = frozen["Es"]
    land_ok = land & np.isfinite(Es).all(0)
    r1s = []
    for i in range(len(train)):
        for j in range(i + 1, len(train)):
            r, _ = spearman_blocks(Es[i], Es[j], bid, land_ok)
            r1s.append(r)
    R1 = float(np.nanmean(r1s))
    n = len(train)
    R_train = n * R1 / (1 + (n - 1) * R1) if R1 > -1 / (n - 1) else np.nan
    rho_ceil = float(np.sqrt(R_train * R1)) if (np.isfinite(R_train) and R_train * R1 > 0) else np.nan
    loyo = []
    for i, s in enumerate(train):
        others = [t for k, t in enumerate(train) if k != i]
        mo = B.fit_model(others, bc, ref, water, use_trend=False)
        r, _ = spearman_blocks(mo["E"], Es[i], bid, land & np.isfinite(Es[i]))
        loyo.append(r)
    # confidence check
    cc = {}
    cb_all = np.concatenate([a for a, _ in conf_pairs])
    same_all = np.concatenate([b for _, b in conf_pairs])
    for code, name in [(2, "high"), (1, "medium"), (0, "low")]:
        m = cb_all == code
        cc[name] = None if m.sum() < 30 else round(float(same_all[m].mean()), 3)
    ordered = all(cc[a] is not None and cc[b] is not None and cc[a] >= cc[b] for a, b in [("high", "medium")])
    cc["ordered"] = bool(ordered)
    rows = {
        "skill": status3(skill, thr["skill_pass"], thr["skill_partial"]),
        "rho_block": status3(rho_b, thr["rho_pass"], thr["rho_partial"]),
        "kappa": status3(kap, thr["kappa_pass"], thr["kappa_partial"]),
    }
    notes = []
    ratio = rho_b / rho_ceil if np.isfinite(rho_ceil) and rho_ceil > 0 else np.nan
    if (np.isfinite(ratio) and ratio >= 0.8) or (np.isfinite(rho_b) and len([v for v in loyo if np.isfinite(v)]) and
                                                 min(v for v in loyo if np.isfinite(v)) <= rho_b):
        notes.append("Shortfall consistent with data quality (noise ceiling / leave-one-year-out range), not the model. Status unchanged.")
    res = {
        "status": worst(rows.values()), "rows": rows,
        "n_pixels": int(sum(v["n_pixels"] for v in per_season.values())), "n_blocks": len(blocks),
        "metrics": {
            "skill_vs_best_baseline": {"value": round(float(skill), 3), "ci95": skill_ci, "baseline": ref_name},
            "rho_block": {"value": None if not np.isfinite(rho_b) else round(rho_b, 3), "ci95": rho_ci},
            "kappa": {"value": None if kap is None else round(kap, 3), "ci95": kap_ci},
            "rho_pixel_by_season": {k: v["rho_pixel"] for k, v in per_season.items()},
        },
        "confusion_matrix_rows_train_cols_test": None if cm is None else cm.tolist(),
        "baselines_block_rmse_cm": {"zero_motion": round(float(rm["zero"]), 3), "sqrt_time": round(float(rm["time"]), 3),
                                    "avg_warmth": round(float(rm["avgwarm"]), 3), "model": round(float(rm["model"]), 3)},
        "baselines_pixel_rmse_cm": {k: round(float(np.sqrt(v[0] / v[1])), 3) for k, v in pix.items() if v[1]},
        "warmth_skill": round(float(warm_skill), 3),
        "per_season": per_season,
        "noise_ceiling": {"R1": round(R1, 3), "R_train": None if not np.isfinite(R_train) else round(R_train, 3),
                          "rho_ceiling": None if not np.isfinite(rho_ceil) else round(rho_ceil, 3),
                          "rho_over_ceiling": None if not np.isfinite(ratio) else round(float(ratio), 3),
                          "pairwise_train_rho": [None if not np.isfinite(r) else round(r, 3) for r in r1s]},
        "loyo_rho": {str(s.year): (None if not np.isfinite(r) else round(r, 3)) for s, r in zip(train, loyo)},
        "conf_check": cc,
        "notes": " ".join(notes),
    }
    return res, frozen, comp, conf_f


# ---------------------------------------------------------------- Test B (NISAR)
def nisar_E(cfg, temps, tcfg):
    """E from NISAR 12-day increments: d_k = -E * dA_k (each pair referenced on its own)."""
    d = ROOT / "data/interim/motion/nisar_t159"
    info = T.season_info(temps, 2026, tcfg)
    fb = date.fromisoformat(info["t_fb"])
    num, den, cnt = None, None, None
    used = []
    for f in sorted(glob.glob(str(d / "pairs" / "pair_*.tif"))):
        r, s = Path(f).stem.split("_")[1:3]
        d1, d2 = date(int(r[:4]), int(r[4:6]), int(r[6:])), date(int(s[:4]), int(s[4:6]), int(s[6:]))
        if d2 >= fb:
            continue
        dA = T.A_of(temps, info, d2) - T.A_of(temps, info, d1)
        a = read_grid_tif(f).ravel()
        ok = np.isfinite(a)
        if num is None:
            num, den, cnt = np.zeros(a.size), np.zeros(a.size), np.zeros(a.size)
        num[ok] += a[ok] * dA
        den[ok] += dA ** 2
        cnt[ok] += 1
        used.append({"pair": f"{d1}..{d2}", "dA": round(dA, 2), "valid_share": round(float(ok.mean()), 3)})
    if num is None:
        return None, used, info
    with np.errstate(invalid="ignore", divide="ignore"):
        E = -num / den
    E[cnt < 2] = np.nan
    return E, used, info


def test_b(cfg, temps, frozen, comp, conf_f, water, x, y, s1_2025):
    mc = cfg["models"]
    bc = mc["behaviour"]
    thr = mc["thresholds"]["test_b"]
    bid = block_ids(x, y, bc["bootstrap"]["block_m"])
    En, used, info = nisar_E(cfg, temps, mc["tdd"])
    if En is None:
        return {"status": "pending", "reason": "no usable NISAR pairs"}
    cb = B.conf_bin(conf_f, bc)
    mk = ~water & np.isfinite(En) & np.isfinite(frozen["E"]) & (cb >= 1)
    rb, df = spearman_blocks(frozen["E"], En, bid, mk)
    rp = float(spearmanr(frozen["E"][mk], En[mk])[0]) if mk.sum() > 50 else np.nan
    ci = boot_spearman(df, bc["bootstrap"]["n"])
    # sensor sign check (spec 02 2.2): NISAR vs Sentinel-1 2025 season sensitivity, Pearson at blocks
    sign = None
    if s1_2025 is not None:
        Es25 = B.fit_season(s1_2025, bc)["E"]
        m2 = ~water & np.isfinite(En) & np.isfinite(Es25)
        A = block_median(En, bid, m2)
        Bb = block_median(Es25, bid, m2)
        dd = pd.concat([A, Bb], axis=1).dropna()
        sign = None if len(dd) < 8 else round(float(np.corrcoef(dd.iloc[:, 0], dd.iloc[:, 1])[0, 1]), 3)
    row_rho = status3(rb, thr["rho_pass"], thr["rho_partial"])
    return {
        "status": row_rho if row_rho != "not_available" else "not_available",
        "rows": {"rho_block": row_rho, "kappa": "not_available"},
        "metrics": {"rho_block": {"value": None if not np.isfinite(rb) else round(rb, 3), "ci95": ci, "n_blocks": len(df)},
                    "rho_pixel": None if not np.isfinite(rp) else round(rp, 3), "kappa": None},
        "method": "NISAR sensitivity from 12-day increments (d = -E dA, each pair referenced on its own), compared by ordering with the 2021-2023 Sentinel-1 fit",
        "pairs_used": used,
        "kappa_note": "NISAR classes need >= 5 dates on one connected chain; the 2026 chain breaks (24 Aug-5 Sep pair failed to unwrap, July and September pairs lost coherence), so the class comparison is not available.",
        "cross_sensor_sign_r_vs_s1_2025": sign,
        "area_order": {"counts_toward_status": False},
    }


# ---------------------------------------------------------------- robustness, sensitivity, rain
def robustness(cfg, seasons, final, final_cls, ref, water, bc):
    land = ~water
    conf = B.conf_bin(B.confidence(final, bc, "C", seasons), bc)
    meas = land & (conf >= 1) & np.isin(final_cls, [1, 2, 3])
    no21 = [s for s in seasons if s.year != 2021]
    m2 = B.fit_model(no21, bc, ref, water)
    c2 = B.classify(m2, bc, water)
    same = float((c2[meas] == final_cls[meas]).mean()) if meas.any() else None
    shifted = dict(final)
    changes = []
    for sgn in (-1, 1):
        shifted["Erel"] = final["Erel"] - sgn * final["sigma_ref"]
        cs = B.classify(shifted, bc, water)
        changes.append(float((cs[meas] != final_cls[meas]).mean()))
    return {"without_2021_same_class_share": None if same is None else round(same, 3),
            "ref_shift_class_change_share": round(max(changes), 4),
            "sigma_ref": round(final["sigma_ref"], 5)}


def cluster_check(final, final_cls, water, bc, seed=0):
    from sklearn.mixture import GaussianMixture
    land = ~water
    m = land & np.isin(final_cls, [1, 2, 3]) & np.isfinite(final["Erel"]) & np.isfinite(final["Lp"])
    if m.sum() < 300:
        return {"cluster_vs_rules_kappa": None}
    X = np.c_[final["Erel"][m], final["Lp"][m]]
    rng = np.random.default_rng(seed)
    sub = rng.choice(len(X), min(20000, len(X)), replace=False)
    g = GaussianMixture(3, random_state=seed).fit(X[sub])
    lab = g.predict(X)
    means = g.means_
    degr = int(np.argmax(means[:, 1]))
    rest = [i for i in range(3) if i != degr]
    stable = min(rest, key=lambda i: means[i, 0])
    seas = [i for i in rest if i != stable][0]
    mp = {stable: 1, seas: 2, degr: 3}
    lc = np.vectorize(mp.get)(lab)
    return {"cluster_vs_rules_kappa": round(float(cohen_kappa_score(final_cls[m], lc)), 3),
            "cluster_means_Erel_Lp": np.round(means, 4).tolist()}


def rain_check(temps, seasons, final, ref, bc):
    vals, rains = [], []
    for i, s in enumerate(seasons):
        Lp = final["Lp_s"][i]
        if not np.isfinite(Lp).any():
            continue
        t_end = s.info.get("t_end")
        r = temps.loc[f"{s.year}-{bc['late_md']}":t_end, "precip_mm"]
        if r.notna().sum() < 10:
            continue
        vals.append(float(np.nanmedian(Lp)))
        rains.append(float(r.fillna(0).sum()))
    if len(vals) < 3:
        return {"rho_late_excess_vs_rain": None, "n_seasons": len(vals)}
    return {"rho_late_excess_vs_rain": round(float(spearmanr(vals, rains)[0]), 3), "n_seasons": len(vals)}


# ---------------------------------------------------------------- expectation (2.7)
def expectation(cfg, temps, frozen, season, water, named_mask, x, y, sensor_noise=None):
    mc = cfg["models"]
    ec = mc["expectation"]
    s = season
    n = len(s.dates)
    out = {"schema": "expected/2", "stack_id": s.stack, "season": s.year,
           "season_closed": bool(s.info.get("t_end") is not None and s.dates[-1].isoformat() >= s.info["t_end"]),
           "relative_to": "rest of mapped area this season",
           "pixel_flag_rule": "z < -2",
           "area_flag_rule": ">=30% pixels flagged and median z < -1.5, two consecutive passes", "notes": []}
    if n < ec["min_passes"]:
        out.update({"mode": "not_available", "reason": f"only {n} passes"})
        return out, None, None
    Y = s.Y
    yref = np.nanmean(Y[:2], 0)
    Aref = float(np.mean(s.A[:2]))
    E = frozen["E"]
    SE = frozen["SE"]
    sig = frozen["sigma_p"] if sensor_noise is None else sensor_noise
    zs = []
    gains = []
    bid = block_ids(x, y, ec["gain_block_m"])
    for t in range(2, n):
        dA = s.A[t] - Aref
        exp1 = -E * dA
        obs = Y[t] - yref
        calib = ~water & ~named_mask & np.isfinite(obs) & np.isfinite(exp1)
        bo = block_median(obs, bid, calib)
        be = block_median(exp1, bid, calib)
        dfb = pd.concat([bo, be], axis=1).dropna()
        g = np.nan
        if len(dfb) >= 10 and np.std(dfb.iloc[:, 1]) > 0:
            from sklearn.linear_model import HuberRegressor
            hr = HuberRegressor(fit_intercept=True).fit(dfb.iloc[:, [1]].values, dfb.iloc[:, 0].values)
            g = float(hr.coef_[0])
        gains.append(g)
        gg = g if (np.isfinite(g) and ec["gain_bounds"][0] <= g <= ec["gain_bounds"][1]) else 1.0
        resid = obs - gg * exp1
        sd = np.sqrt(1.5 * sig ** 2 + (gg * dA * SE) ** 2)
        zs.append(resid / sd)
    g_last = gains[-1]
    mode = "magnitude" if (np.isfinite(g_last) and ec["gain_bounds"][0] <= g_last <= ec["gain_bounds"][1]) else "ordering_only"
    out.update({"latest_pass": s.dates[-1].isoformat(), "reference_passes": [d.isoformat() for d in s.dates[:2]],
                "tdd_at_latest": round(float(s.A[-1] ** 2), 1), "A_latest": round(float(s.A[-1]), 2), "A_ref": round(Aref, 2),
                "sensor_gain": {"g": None if not np.isfinite(g_last) else round(g_last, 3), "method": "huber_block_median",
                                "calibration": "outside named areas + 500 m", "status": "applied" if mode == "magnitude" else "ordering_only",
                                "by_pass": [None if not np.isfinite(v) else round(v, 3) for v in gains]},
                "noise": {"sigma_cm": round(float(np.nanmedian(sig[~water])), 3), "source": "model A residual / Part 2 (larger)"},
                "mode": mode})
    if np.isfinite(g_last) and g_last > 1.5:
        out["notes"].append("whole area sinking more than past seasons suggest")
    return out, zs[-1], (zs[-2] if len(zs) >= 2 else None)
