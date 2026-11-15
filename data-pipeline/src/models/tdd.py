"""Warmth variable for Model A (spec 03 section 2.1): thaw onset, freeze-back, TDD and A = sqrt(TDD)."""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from common import ROOT


def load_temps():
    df = pd.read_csv(ROOT / "data/interim/climate/daily_temperature.csv", parse_dates=["date"]).set_index("date")
    return df


def _first_run(series, cond, start, run):
    s = series.loc[start:]
    ok = cond(s).astype(int).values
    for k in range(len(ok) - run + 1):
        if ok[k:k + run].all():
            return s.index[k]
    return None


def season_info(df, year, tcfg):
    """Return dict with t_on, t_fb, onset_source, temp_quality, excluded (bool) for a season."""
    on_from = pd.Timestamp(f"{year}-{tcfg['onset_search_from']}")
    t = df["tmean_c"]
    a = _first_run(t, lambda s: s > 0, on_from, tcfg["onset_min_run_days"])
    onset_source = "air_temp"
    t_on = a
    snow = df["snow_on_ground_cm"].loc[f"{year}-04-01":f"{year}-06-30"]
    # snow depth is used only when the spring record is nearly complete: missing days must not count as snow
    if tcfg.get("use_snow", False) and snow.notna().mean() >= 0.8:
        b = _first_run(df["snow_on_ground_cm"].fillna(np.inf), lambda s: s <= 0, on_from, tcfg["snow_off_run_days"])
        if b is not None and (a is None or b > a):
            t_on = b
        onset_source = "max(air_temp, snow_off)"
    fb = _first_run(t, lambda s: s < 0, pd.Timestamp(f"{year}-{tcfg['freeze_search_from']}"), tcfg["freeze_min_run_days"])
    window = df.loc[t_on:fb] if (t_on is not None and fb is not None) else df.iloc[0:0]
    filled_share = float(window["filled"].notna().mean()) if len(window) else 0.0
    gap = window["tmean_c"].isna().astype(int)
    max_gap = int(gap.groupby((gap != gap.shift()).cumsum()).sum().max()) if len(gap) else 0
    return {
        "season": year,
        "t_on": None if t_on is None else t_on.date().isoformat(),
        "t_fb": None if fb is None else fb.date().isoformat(),
        "onset_source": onset_source,
        "filled_share": round(filled_share, 3),
        "temp_quality": "low" if filled_share > tcfg["max_filled_share"] else "ok",
        "excluded": bool(t_on is None or fb is None or max_gap > tcfg["max_gap_days"]),
    }


def A_of(df, info, d):
    """A(t) = sqrt(TDD) through the end of day d (date), TDD from t_on to min(d, t_fb)."""
    t_on = pd.Timestamp(info["t_on"])
    t_fb = pd.Timestamp(info["t_fb"])
    end = min(pd.Timestamp(d), t_fb)
    if end < t_on:
        return 0.0
    tdd = df["tmean_c"].loc[t_on:end].clip(lower=0).sum()
    return float(np.sqrt(tdd))


def A_series(df, info, dates):
    return np.array([A_of(df, info, d) for d in dates])


def mean_training_curve(df, infos):
    """Average-warmth baseline (spec 2.6 baseline c): mean TDD by calendar day over training seasons."""
    curves = {}
    for info in infos:
        y = info["season"]
        days = pd.date_range(f"{y}-05-01", f"{y}-10-31")
        tdd = []
        t_on = pd.Timestamp(info["t_on"])
        t_fb = pd.Timestamp(info["t_fb"])
        cum = 0.0
        for d in days:
            if t_on <= d <= t_fb:
                v = df["tmean_c"].get(d, np.nan)
                cum += max(v, 0) if np.isfinite(v) else 0
            tdd.append(cum)
        curves[y] = pd.Series(tdd, index=[d.strftime("%m-%d") for d in days])
    return pd.concat(curves, axis=1).mean(axis=1)


def season_end_date(info, dates):
    """Season end t_end: last radar date before freeze-back."""
    fb = date.fromisoformat(info["t_fb"])
    ok = [d for d in dates if d < fb]
    return ok[-1] if ok else None
