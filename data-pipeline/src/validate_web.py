"""Part 5 validation gate: check frontend/public/data before it is published.

Fails (exit 1) on missing files or keys, empty layers, or values outside physical range, so a bad run
never replaces the live site. Usage: python src/validate_web.py [data_dir]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from common import ROOT

D = Path(sys.argv[1]) if len(sys.argv) > 1 else (ROOT / "../frontend/public/data").resolve()
errors, checks = [], 0


def check(cond, msg):
    global checks
    checks += 1
    if not cond:
        errors.append(msg)


def load(name):
    p = D / name
    check(p.exists(), f"missing {name}")
    return json.load(open(p)) if p.exists() else None


m = load("manifest.json") or {}
for k in ("schema", "generated_at", "mock", "area", "freshness", "years", "layers", "models", "files"):
    check(k in m, f"manifest missing '{k}'")
check(m.get("schema") == 2, "manifest schema is not 2")
for f in (m.get("files") or {}).values():
    check((D / f).exists(), f"manifest lists {f} but it is missing")
for lay in m.get("layers", []):
    img = D / lay["image"]
    check(img.exists() and img.stat().st_size > 1000, f"layer {lay['id']} image missing or empty")
for y in m.get("years", []):
    if y["status"] == "measured":
        check((D / y["image"]).exists(), f"year {y['year']} image missing")
        check(0 < y["valid_share"] <= 1, f"year {y['year']} valid share out of range")
cells = load("cells.json") or {"rows": []}
check(len(cells["rows"]) > 100, "fewer than 100 screening cells")
for r in cells["rows"][:5000]:
    lon, lat, tier, coring, h, hw = r[:6]
    if not (-133.4 < lon < -132.7 and 69.1 < lat < 69.6):
        errors.append(f"cell outside area: {lon},{lat}")
        break
    if h is not None and not (-10 < h < 100):
        errors.append(f"cell height out of range: {h}")
        break
areas = load("areas.geojson") or {"features": []}
ids = {f["properties"]["id"] for f in areas["features"]}
check({"the_point", "town_core", "reindeer_point"} <= ids, "named areas missing")
for f in areas["features"]:
    p = f["properties"]
    check(p.get("tier") in ("lower", "moderate", "higher", "not_enough_data"), f"{p.get('id')}: bad tier")
    check(len(p.get("drivers", [])) == 3, f"{p.get('id')}: needs three drivers")
v = load("validation.json") or {"cards": []}
ok_status = {"pass", "partial", "fail", "not_run", "not_available", "pending"}
for c in v["cards"]:
    check(c.get("status") in ok_status, f"card {c.get('id')}: bad status {c.get('status')}")
ts = load("timeseries.json") or {"areas": {}}
for aid, a in ts.get("areas", {}).items():
    for s in a["seasons"]:
        for pnt in s["points"]:
            if pnt["measured"] is not None and abs(pnt["measured"]) > 30:
                errors.append(f"{aid} {pnt['date']}: {pnt['measured']} cm is not physical for one summer")
size = sum(p.stat().st_size for p in D.rglob("*") if p.is_file())
check(size < 4e6, f"data folder is {size/1e6:.1f} MB (budget 4 MB total, 2 MB first load)")
print(f"[validate] {checks - len(errors)} of {checks} checks passed; {size/1e6:.2f} MB")
for e in errors:
    print("  FAIL", e)
sys.exit(1 if errors else 0)
