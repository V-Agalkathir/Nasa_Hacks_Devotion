"""Part 5: search the NISAR catalogue, compare with what is processed, apply the season gate.

No login needed (ASF catalogue search). Writes data/interim/run_status.json and appends any new
NISAR pairs to data/interim/granules.csv so fetch_nisar.py can fetch them.

Usage: python src/pipeline_check.py [--force-season-open]
Exit code 0 always (a quiet winter is a successful run); the status file says what happened.
"""
from __future__ import annotations

import csv
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone

from common import ROOT, aoi_wkt, load_config, path

GUNW = re.compile(r"NISAR_L2_(PR|UR)_GUNW_.*?_(\d{8})T\d{6}_\d{8}T\d{6}_(\d{8})T\d{6}_\d{8}T\d{6}_.*?_(\d{3})$")


def season_gate(cfg, today, temps_csv):
    """Open when the date is inside the thaw window and the last 5 station days averaged above 0 C."""
    win = cfg["season_window"]
    start = date(today.year, *map(int, win["start"].split("-")))
    end = date(today.year, *map(int, cfg.get("radar", {}).get("season_end", {}).get("nisar_t159", "10-15").split("-")))
    in_window = start <= today <= end
    warm = None
    try:
        import pandas as pd
        df = pd.read_csv(temps_csv, parse_dates=["date"]).set_index("date")
        last = df["tmean_c"].dropna().loc[:str(today)].tail(5)
        warm = bool(len(last) and last.mean() > 0)
    except Exception:
        pass
    return {"window": [win["start"], "10-15"], "in_window": in_window, "station_warm": warm,
            "open": bool(in_window and (warm is not False))}


def main():
    cfg = load_config()
    force = "--force-season-open" in sys.argv
    today = datetime.now(timezone.utc).date()
    st = cfg["stacks"]["nisar_t159"]
    status = {"checked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "sensor": "NISAR", "track": st["track"],
              "frame": st["frame"]}
    gate = season_gate(cfg, today, ROOT / "data/interim/climate/daily_temperature.csv")
    status["season"] = {**gate, "forced_open": force}
    raw = path(cfg, "raw", "nisar")
    have = {p.stem for p in raw.glob("*.h5")}
    try:
        import asf_search as asf
        res = asf.search(dataset="NISAR", processingLevel="GUNW", intersectsWith=aoi_wkt(cfg),
                         relativeOrbit=st["track"], frame=st["frame"],
                         start=f"{today.year}-01-01", end=today.isoformat())
        found = []
        for r in res:
            p = r.properties
            gid = p.get("sceneName") or p.get("fileID", "")
            m = GUNW.search(gid.replace(".h5", ""))
            if not m:
                continue
            found.append({"id": gid.replace(".h5", ""), "type": m.group(1), "ref": m.group(2), "sec": m.group(3),
                          "ver": int(m.group(4)), "url": p.get("url", "")})
        status["search"] = {"ok": True, "n_products": len(found)}
    except Exception as e:
        found = []
        status["search"] = {"ok": False, "error": str(e)[:300]}
    # one version per pair (PR over UR, highest _00N)
    pref = cfg["nisar"]["version_preference"]
    best = {}
    for f in found:
        k = (f["ref"], f["sec"])
        rank = (-pref.index(f["type"]) if f["type"] in pref else -9, f["ver"])
        if k not in best or rank > best[k][0]:
            best[k] = (rank, f)
    pairs = sorted((v[1] for v in best.values()), key=lambda f: f["sec"])
    processed_pairs = {(m.group(2), m.group(3)) for m in (GUNW.search(h) for h in have) if m}
    new = [f for f in pairs if (f["ref"], f["sec"]) not in processed_pairs]
    end_md = "1015"
    start_md = cfg["season_window"]["start"].replace("-", "")
    usable = [f for f in new if f["ref"][:4] == f["sec"][:4] and f["ref"][4:] >= start_md and f["sec"][4:] <= end_md]
    status["pairs"] = {"unique": len(pairs), "processed": len(processed_pairs), "new": [f["id"] for f in new],
                       "new_in_season": [f["id"] for f in usable],
                       "excluded": [{"id": f["id"], "reason": "outside thaw window"} for f in new if f not in usable]}
    latest = max((f["sec"] for f in pairs), default=None)
    status["latest_catalogue_pass"] = None if latest is None else f"{latest[:4]}-{latest[4:6]}-{latest[6:]}"
    if usable and (gate["open"] or force):
        # append to granules.csv so fetch_nisar.py picks them up
        gp = ROOT / "data/interim/granules.csv"
        rows = list(csv.DictReader(open(gp))) if gp.exists() else []
        fields = ["source", "stack_id", "season", "ref_date", "sec_date", "path", "frame", "flight_dir", "id", "url"]
        known = {r["id"] for r in rows}
        for f in usable:
            if f["id"] in known:
                continue
            iso = lambda s: f"{s[:4]}-{s[4:6]}-{s[6:]}"
            rows.append({"source": "NISAR", "stack_id": "nisar_t159", "season": f["ref"][:4], "ref_date": iso(f["ref"]),
                         "sec_date": iso(f["sec"]), "path": st["track"], "frame": st["frame"], "flight_dir": st["flight_dir"],
                         "id": f["id"], "url": f["url"]})
        with open(gp, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=fields)
            w.writeheader()
            w.writerows(rows)
        status["action"] = "fetch"
        status["message"] = f"{len(usable)} new NISAR pair(s) to fetch and process."
    elif usable:
        status["action"] = "none"
        status["message"] = "New pairs exist but the thaw season is closed; nothing processed."
    elif not status["search"]["ok"]:
        status["action"] = "none"
        status["message"] = "Catalogue search failed; showing the last good data."
    else:
        status["action"] = "none"
        status["message"] = ("Paused for winter: no new usable radar passes." if not gate["open"]
                             else "Up to date: no new NISAR passes since the last run.")
    status["update_status"] = ("failed_showing_last_good" if not status["search"]["ok"] else
                               ("updating" if status["action"] == "fetch" else ("paused_for_winter" if not gate["open"] else "up_to_date")))
    out = ROOT / "data/interim/run_status.json"
    json.dump(status, open(out, "w"), indent=1)
    print(f"[gate]   season window {gate['window'][0]}..{gate['window'][1]} today {today}: "
          f"{'open' if gate['open'] else 'closed'}{' (forced open)' if force else ''}")
    print(f"[search] NISAR GUNW track {st['track']} frame {st['frame']}: {status['search']}")
    print(f"[plan]   {len(pairs)} unique pairs, {len(processed_pairs)} processed, {len(new)} new, {len(usable)} new in season")
    print(f"[status] {status['update_status']}: {status['message']}")


if __name__ == "__main__":
    main()
