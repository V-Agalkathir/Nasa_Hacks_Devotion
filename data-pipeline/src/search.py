"""Part 1 / step 1: find radar scenes and plan pairs for every stack in config.yaml.

Outputs
  data/interim/scenes.csv    every kept acquisition (one per date per stack), for transparency
  data/interim/granules.csv  the fixed 1->2 interface: one row per PAIR
      source, stack_id, season, ref_date, sec_date, path, frame, flight_dir, id, url
      Sentinel-1: id = "<ref_scene>|<sec_scene>", url empty (HyP3 produces the product)
      NISAR:      id = GUNW granule name, url = .h5 download URL

Selection rules (see docs/architecture/specs/01-data-acquisition.md)
  * Sentinel-1: platform S1, SLC, beam IW only, relative orbit from config, intersects AOI,
    season window from config. ONE scene per acquisition date: the one covering most of the AOI.
    NOTE: do NOT filter on frame number. ASF frame numbers drift between years for path 137
    (227 in 2018-21, 223/228 in 2022-24, mixed in 2025, 225 in 2026). Verified 14 Nov 2026.
  * Pairs: within one season only; each date with its next (n+1, kept up to max_days_first)
    and the one after (n+2, kept up to max_days_second).
  * NISAR: L2 GUNW, track/frame/direction from config; one version per (ref, sec) pair,
    preferring PR over UR and the highest _00N version.
No login needed.  Usage: python src/search.py [--stack s1_p137]
"""
import csv, re, sys
from datetime import date
import asf_search as asf
from shapely.geometry import box, shape
from common import load_config, path, aoi_wkt

cfg = load_config()
aoi = box(*cfg["aoi"]["bbox"])
win = cfg["season_window"]
only = sys.argv[sys.argv.index("--stack") + 1] if "--stack" in sys.argv else None
d = lambda s: date.fromisoformat(s[:10])

scenes_rows, pair_rows = [], []


def s1_stack(stack_id, st):
    pr = cfg["pairs"]
    for yr in st["seasons"]:
        res = asf.search(platform=asf.PLATFORM.SENTINEL1, processingLevel=asf.PRODUCT_TYPE.SLC,
                         beamMode=asf.BEAMMODE.IW, relativeOrbit=st["relative_orbit"],
                         flightDirection=st["flight_dir"], intersectsWith=aoi_wkt(cfg),
                         start=f"{yr}-{win['start']}", end=f"{yr}-{win['end']}T23:59:59Z")
        best = {}  # date -> (coverage, product)
        for r in res:
            p = r.properties
            cov = shape(r.geometry).intersection(aoi).area / aoi.area
            k = p["startTime"][:10]
            if k not in best or cov > best[k][0]:
                best[k] = (cov, r)
        dates = sorted(best)
        for k in dates:
            cov, r = best[k]; p = r.properties
            scenes_rows.append({"stack_id": stack_id, "season": yr, "date": k, "scene": p["sceneName"],
                                "platform": p.get("platform"), "path": p.get("pathNumber"),
                                "frame": p.get("frameNumber"), "aoi_coverage": round(cov, 3)})
        n_pairs = 0
        for i, a in enumerate(dates):
            for step in pr["neighbours"]:
                if i + step >= len(dates):
                    continue
                b = dates[i + step]
                gap = (d(b) - d(a)).days
                limit = pr["max_days_first"] if step == 1 else pr["max_days_second"]
                if gap > limit:
                    continue
                ra, rb = best[a][1].properties, best[b][1].properties
                pair_rows.append({"source": "S1", "stack_id": stack_id, "season": yr, "ref_date": a, "sec_date": b,
                                  "path": ra.get("pathNumber"), "frame": f"{ra.get('frameNumber')}/{rb.get('frameNumber')}",
                                  "flight_dir": ra.get("flightDirection"),
                                  "id": f"{ra['sceneName']}|{rb['sceneName']}", "url": ""})
                n_pairs += 1
        low = [k for k in dates if best[k][0] < 0.99]
        print(f"{stack_id} {yr}: {len(dates)} dates, {n_pairs} pairs" + (f"  (partial AOI cover: {low})" if low else ""))


def nisar_stack(stack_id, st):
    tag = f"_{st['track']:03d}_{st['flight_dir'][0]}_{st['frame']:03d}_"
    pref = cfg["nisar"]["version_preference"]
    for yr in st["seasons"]:
        res = asf.search(dataset="NISAR", processingLevel="GUNW", intersectsWith=aoi_wkt(cfg),
                         start=f"{yr}-{win['start']}", end=f"{yr}-{win['end']}T23:59:59Z")
        best = {}
        for r in res:
            fid = r.properties["fileID"]
            if tag not in fid:
                continue
            m = re.search(r"_L2_(\w\w)_GUNW_.*?_(\d{8})T\d{6}_\d{8}T\d{6}_(\d{8})T\d{6}_.*_(\d{3})$", fid)
            if not m:
                continue
            typ, ref, sec, ver = m.groups()
            rank = (-pref.index(typ) if typ in pref else -99, int(ver))
            k = (ref, sec)
            if k not in best or rank > best[k][0]:
                best[k] = (rank, r)
        for (ref, sec) in sorted(best):
            p = best[(ref, sec)][1].properties
            iso = lambda x: f"{x[:4]}-{x[4:6]}-{x[6:]}"
            pair_rows.append({"source": "NISAR", "stack_id": stack_id, "season": yr, "ref_date": iso(ref),
                              "sec_date": iso(sec), "path": st["track"], "frame": st["frame"],
                              "flight_dir": st["flight_dir"], "id": p["fileID"], "url": p["url"]})
        print(f"{stack_id} {yr}: {len(best)} pairs (one version each)")


for sid, st in cfg["stacks"].items():
    if only and sid != only:
        continue
    (nisar_stack if st["sensor"] == "NISAR" else s1_stack)(sid, st)

out = path(cfg, "interim")
for name, rows in [("scenes.csv", scenes_rows), ("granules.csv", pair_rows)]:
    if rows:
        with open(out / name, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
        print("wrote", out / name, f"({len(rows)} rows)")
s1 = [r for r in pair_rows if r["source"] == "S1" and r["stack_id"] == "s1_p137"]
print(f"s1_p137 total: {len(s1)} pairs = {len(s1) * cfg['hyp3']['credits_per_job']} HyP3 credits at {cfg['hyp3']['looks']}")
