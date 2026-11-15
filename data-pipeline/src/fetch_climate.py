"""Part 1 / step 4: daily temperature for Tuktoyaktuk from Environment and Climate Change Canada.

API: https://api.weather.gc.ca/collections/climate-daily/items (OGC API, no account). Verified 14 Nov 2026.
Stations (config.climate.stations, priority order):
  2203914 TUKTOYAKTUK   (stn 26987, daily 1995-present)
  2203911 TUKTOYAKTUK A (stn 53582, 2018-present)
Merge rule: take the first station that has a value for each field and day; tmean missing but
tmax+tmin present -> (tmax+tmin)/2 (filled=calc). Remaining gaps up to 3 days -> linear
interpolation (filled=interp). Longer gaps stay empty and are reported (ERA5-Land fallback is
optional and NOT run here: it needs a CDS account and requests must be sequential).
Also keeps snow on ground and precipitation for Part 3's second-driver test.

Output: data/interim/climate/daily_temperature.csv
  date, tmean_c, tmax_c, tmin_c, station_id, filled, snow_on_ground_cm, precip_mm
Usage: python src/fetch_climate.py
"""
import time
from datetime import date
import requests, pandas as pd
from common import load_config, path

cfg = load_config()
API = "https://api.weather.gc.ca/collections/climate-daily/items"
FIELDS = {"MEAN_TEMPERATURE": "tmean_c", "MAX_TEMPERATURE": "tmax_c", "MIN_TEMPERATURE": "tmin_c",
          "SNOW_ON_GROUND": "snow_on_ground_cm", "TOTAL_PRECIPITATION": "precip_mm"}


def fetch_station(cid):
    rows, offset = [], 0
    dt = f"{cfg['climate']['start']}/{date.today().isoformat()}"
    while True:
        for attempt in range(4):
            try:
                r = requests.get(API, params={"f": "json", "CLIMATE_IDENTIFIER": cid, "datetime": dt,
                                              "limit": 5000, "offset": offset, "sortby": "LOCAL_DATE"}, timeout=60)
                r.raise_for_status(); break
            except Exception as e:
                if attempt == 3: raise
                print(f"  retry {cid} ({e})"); time.sleep(5 * (attempt + 1))
        feats = r.json().get("features", [])
        rows += [f["properties"] for f in feats]
        if len(feats) < 5000:
            break
        offset += 5000
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["date"] = pd.to_datetime(df["LOCAL_DATE"]).dt.date
    return df[["date"] + list(FIELDS)].rename(columns=FIELDS).set_index("date")


stations = [(s["climate_id"], s["station_id"]) for s in cfg["climate"]["stations"]]
frames = {}
for cid, sid in stations:
    df = fetch_station(cid)
    frames[sid] = df
    print(f"station {cid} ({sid}): {len(df)} days, {df['tmean_c'].notna().sum() if len(df) else 0} with mean temp")

idx = pd.date_range(cfg["climate"]["start"], date.today(), freq="D").date
out = pd.DataFrame(index=idx); out.index.name = "date"
for col in FIELDS.values():
    out[col] = pd.NA
out["station_id"] = pd.NA; out["filled"] = ""
for sid, df in frames.items():                     # priority order
    if df.empty: continue
    df = df.reindex(idx)
    take = out["tmean_c"].isna() & df["tmean_c"].notna()
    out.loc[take, "station_id"] = sid
    for col in FIELDS.values():
        out[col] = out[col].combine_first(df[col])

for col in ["tmean_c", "tmax_c", "tmin_c"]:
    out[col] = pd.to_numeric(out[col], errors="coerce")

# ---- hourly fallback: daily records have a gap Jan-Jul 2018 (both stations). Station 2203913
# (TUKTOYAKTUK A, stn 53581) reports HOURLY 2015-present -> daily mean/max/min where >= 12 hours exist.
HOURLY = "https://api.weather.gc.ca/collections/climate-hourly/items"
hcfg = cfg["climate"].get("hourly_fallback", {"climate_id": "2203913", "station_id": 53581, "min_hours": 12})
miss = out.index[out["tmean_c"].isna() & (pd.to_datetime(out.index) >= pd.Timestamp("2015-06-04"))]
if len(miss):
    rows = []
    for yr in sorted({d.year for d in miss}):
        ds = [d for d in miss if d.year == yr]
        offset = 0
        while True:
            r = requests.get(HOURLY, params={"f": "json", "CLIMATE_IDENTIFIER": hcfg["climate_id"], "limit": 10000,
                                             "offset": offset, "datetime": f"{min(ds)}/{max(ds)}T23:59:59"}, timeout=120)
            r.raise_for_status(); feats = r.json().get("features", [])
            rows += [(f["properties"]["LOCAL_DATE"][:10], f["properties"]["TEMP"]) for f in feats]
            if len(feats) < 10000: break
            offset += 10000
    if rows:
        h = pd.DataFrame(rows, columns=["d", "t"]).dropna()
        h["d"] = pd.to_datetime(h["d"]).dt.date
        g = h.groupby("d")["t"].agg(["mean", "max", "min", "count"])
        g = g[g["count"] >= hcfg["min_hours"]]
        fill = [d for d in miss if d in g.index]
        out.loc[fill, "tmean_c"] = g.loc[fill, "mean"].round(1).values
        out.loc[fill, "tmax_c"] = g.loc[fill, "max"].values
        out.loc[fill, "tmin_c"] = g.loc[fill, "min"].values
        out.loc[fill, "station_id"] = hcfg["station_id"]; out.loc[fill, "filled"] = "hourly"
        print(f"hourly fallback (station {hcfg['climate_id']}): filled {len(fill)} of {len(miss)} missing days")
calc = out["tmean_c"].isna() & out["tmax_c"].notna() & out["tmin_c"].notna()
out.loc[calc, "tmean_c"] = (out["tmax_c"] + out["tmin_c"]) / 2; out.loc[calc, "filled"] = "calc"
before = out["tmean_c"].isna()
out["tmean_c"] = out["tmean_c"].interpolate(limit=3, limit_area="inside")
out.loc[before & out["tmean_c"].notna(), "filled"] = "interp"

# cross-check the two stations where both report (station changes can shift thaw degree-days)
a, b = (frames[s] for s in [st[1] for st in stations][:2])
if not a.empty and not b.empty:
    both = a["tmean_c"].dropna().to_frame("a").join(b["tmean_c"].dropna().to_frame("b"), how="inner")
    both = both.apply(pd.to_numeric, errors="coerce").dropna()
    if len(both):
        print(f"station cross-check: {len(both)} shared days, mean diff {(both.a - both.b).mean():+.2f} C, "
              f"abs diff {(both.a - both.b).abs().mean():.2f} C")

dest = path(cfg, "interim", "climate") / "daily_temperature.csv"
out.reset_index().to_csv(dest, index=False)
gaps = out[out["tmean_c"].isna()]
summer_gaps = [d for d in gaps.index if 5 <= d.month <= 9]
print(f"wrote {dest}: {len(out)} days, {len(gaps)} still missing ({len(summer_gaps)} in May-Sep)")
for yr in range(2018, date.today().year + 1):                       # quick TDD sanity table
    s = out.loc[[d for d in out.index if d.year == yr], "tmean_c"]
    print(f"  {yr}: thawing degree-days = {s.clip(lower=0).sum():.0f}  (missing days {s.isna().sum()})")
