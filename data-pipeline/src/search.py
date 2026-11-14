"""Step 1 — find NISAR GUNW + Sentinel-1 scenes over the AOI for each thaw season.
Writes data/interim/granules.csv. Usage: python src/search.py
"""
import csv
import asf_search as asf
from shapely.geometry import box
from common import load_config, path

cfg = load_config()
wkt = box(*cfg["aoi"]["bbox"]).wkt
rows = []

for s in cfg["seasons"]:
    if s["source"] == "NISAR":
        res = asf.search(intersectsWith=wkt, dataset=cfg["nisar"]["dataset"],
                         processingLevel=cfg["nisar"]["product_type"],
                         start=s["start"], end=s["end"])
    else:
        res = asf.search(intersectsWith=wkt, platform=asf.PLATFORM.SENTINEL1,
                         processingLevel=asf.PRODUCT_TYPE.SLC,
                         start=s["start"], end=s["end"])
    print(f"{s['id']} ({s['source']}): {len(res)} scenes")
    for r in res:
        p = r.properties
        rows.append({"season": s["id"], "source": s["source"], "id": p.get("fileID") or p.get("sceneName"),
                     "start": p.get("startTime"), "path": p.get("pathNumber"),
                     "flight_dir": p.get("flightDirection"), "url": p.get("url")})

out = path(cfg, "interim") / "granules.csv"
with open(out, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=rows[0].keys() if rows else ["season"])
    w.writeheader(); w.writerows(rows)
print("wrote", out)
