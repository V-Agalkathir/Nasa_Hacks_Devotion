"""Part 7 tool data: write frontend/public/data/tool.json (schema tool/1) for the one-screen tool.

Everything is in one SVG space: x = (E - e0) / 50, y = (n0 - N) / 50, UTM 8N metres (1 unit = 50 m).
Cells come from the Part 4 screening (data/interim/screening/areas.geojson); `grid` maps a cell's
(col, row) to its centre. Run after screening.py and export_web_v2.py.
Usage: python src/export_tool_v3.py
"""
from __future__ import annotations

import json
import re

import numpy as np
from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, Point, shape
from shapely.ops import linemerge, transform, unary_union

from common import ROOT

OUT = (ROOT / "../frontend/public/data").resolve()
SD = ROOT / "data/interim/screening"
CTX = ROOT / "data/interim/context"
MD = ROOT / "data/interim/models"
FW = Transformer.from_crs("EPSG:4326", "EPSG:32608", always_xy=True).transform
U = 50.0          # metres per SVG unit
MARGIN = 600.0    # metres around the cells

FLOOD = {
    "source": "Baird (2019), Tuktoyaktuk Coastal Erosion Study, for GNWT Municipal and Community Affairs; "
              "storm-surge levels as published on Future Tuktoyaktuk",
    "url": "https://futuretuktoyaktuk.org/flooding",
    "method": "Land connected to the sea and lower than the storm-surge level floods (bathtub model)",
    "levels": {"2020": {"10": 2.62, "100": 3.19, "200": 3.35},
               "2050": {"10": 2.98, "100": 3.48, "200": 3.63},
               "2100": {"10": 3.47, "100": 4.02, "200": 4.18}},
    "datum_note": "Elevation and surge levels may use slightly different zero points; treat flood lines as estimates",
}


def r1(v):
    return None if v is None else round(float(v), 1)


def main():
    A = json.load(open(SD / "areas.geojson"))["features"]
    named_geo = {f["properties"]["id"]: transform(FW, shape(f["geometry"]))
                 for f in json.load(open(SD / "named_areas.geojson"))["features"]}
    cells = [f for f in A if f["properties"]["kind"] == "cell"]
    named = {f["properties"]["id"]: f for f in A if f["properties"]["kind"] == "named"}
    town_c = named_geo["town_core"].centroid

    # cell centroids (UTM) and lattice indices
    cxy = np.array([transform(FW, shape(f["geometry"])).centroid.coords[0] for f in cells])
    cr = np.array([[int(v) for v in re.match(r"C(\d+)_(\d+)", f["properties"]["id"]).groups()] for f in cells])
    e0 = float(np.floor((cxy[:, 0].min() - MARGIN) / 10) * 10)
    n0 = float(np.ceil((cxy[:, 1].max() + MARGIN) / 10) * 10)
    W = round((cxy[:, 0].max() + MARGIN - e0) / U, 1)
    H = round((n0 - (cxy[:, 1].min() - MARGIN)) / U, 1)
    sx = (cxy[:, 0] - e0) / U
    sy = (n0 - cxy[:, 1]) / U
    a, d = 240.0 / U, -240.0 / U
    e = float(np.mean(sx - a * cr[:, 0]))
    f_ = float(np.mean(sy - d * cr[:, 1]))
    res = max(np.abs(sx - (a * cr[:, 0] + e)).max(), np.abs(sy - (d * cr[:, 1] + f_)).max())
    print(f"grid fit residual max {res:.4f} units ({res * U:.2f} m)")

    def X(E):
        return (E - e0) / U

    def Y(N):
        return (n0 - N) / U

    def path(geom, close=False):
        out = []
        geoms = getattr(geom, "geoms", [geom])
        for g in geoms:
            if g.is_empty:
                continue
            rings = [g.exterior, *g.interiors] if g.geom_type == "Polygon" else [g]
            for ring in rings:
                pts = list(ring.coords)
                if len(pts) < 2:
                    continue
                out.append("M" + " ".join(f"{X(x):.1f},{Y(y):.1f}" for x, y in pts[:1]) +
                           "L" + " ".join(f"{X(x):.1f},{Y(y):.1f}" for x, y in pts[1:]) + ("Z" if g.geom_type == "Polygon" else ""))
        return "".join(out)

    # ice-rich boreholes
    bh = json.load(open(MD / "borehole_check.json"))["sites"] if (MD / "borehole_check.json").exists() else []
    bh_xy = [(*FW(s["lon"], s["lat"]), int(bool(s["visible_ice_logged_top5m"] or (s["moisture_top5m_median_pct"] or 0) > 40))) for s in bh]
    icy = np.array([(x, y) for x, y, ir in bh_xy if ir]) if any(ir for *_, ir in bh_xy) else np.zeros((0, 2))

    C = {k: [] for k in ["id", "col", "row", "h", "p10", "hw", "sea", "town", "wet", "cov", "chg", "mv", "dom", "fl10", "fl50", "ice"]}
    for f, (x, y), (col, row) in zip(cells, cxy, cr):
        i = f["properties"]["indicators"]
        ps = i["ground"].get("per_summer_cm", {})
        fl = i.get("flood", {})
        C["id"].append(f["properties"]["id"])
        C["col"].append(int(col)); C["row"].append(int(row))
        C["h"].append(r1(i["height"]["median_m"])); C["p10"].append(r1(i["height"]["p10_m"]))
        C["hw"].append(int(round(i["access"]["to_highway_m"]))); C["sea"].append(int(round(i["coast"]["distance_to_sea_m"])))
        C["town"].append(int(round(Point(x, y).distance(town_c))))
        C["wet"].append(int(round(i["wetness"]["water_share_250m"] * 100)))
        C["cov"].append(int(round(i["confidence"]["radar_coverage"] * 100)))
        chg = i["coast"].get("measured_change_m")
        C["chg"].append(None if chg is None else r1(chg))
        C["mv"].append([None if ps.get(str(yy)) is None else round(ps[str(yy)], 2) for yy in range(2021, 2026)])
        C["dom"].append(i["ground"]["dominant"])
        C["fl10"].append(None if fl.get("p10_m") is None else round(fl["p10_m"], 2))
        C["fl50"].append(None if fl.get("median_m") is None else round(fl["median_m"], 2))
        C["ice"].append(int(len(icy) > 0 and float(np.min(np.hypot(icy[:, 0] - x, icy[:, 1] - y))) <= 500))

    # highway: merge, longest, orient from the town end, simplify
    hw = json.load(open(CTX / "highway.geojson"))["features"]
    main_hw = [f for f in hw if f["geometry"]["type"] == "LineString" and
               ("Inuvik" in f["properties"].get("name", "") or f["properties"].get("ref") in ("10", "NT 10"))]
    merged = linemerge(MultiLineString([transform(FW, shape(f["geometry"])) for f in main_hw]))
    lines = list(getattr(merged, "geoms", [merged]))
    hl = max(lines, key=lambda g: g.length)
    if Point(hl.coords[-1]).distance(town_c) < Point(hl.coords[0]).distance(town_c):
        hl = LineString(list(hl.coords)[::-1])
    kms = [[round(X(hl.interpolate(k * 1000.0).x), 1), round(Y(hl.interpolate(k * 1000.0).y), 1), k]
           for k in range(int(hl.length // 1000) + 1)]
    hwy_d = path(hl.simplify(10))
    other = [transform(FW, shape(f["geometry"])).simplify(5) for f in hw
             if f["geometry"]["type"] == "LineString" and f not in main_hw]
    frame_box = shape({"type": "Polygon", "coordinates": [[(e0, n0), (e0 + W * U, n0), (e0 + W * U, n0 - H * U), (e0, n0 - H * U), (e0, n0)]]})
    roads_d = path(unary_union([g for g in other if g.intersects(frame_box)]))
    aero = [transform(FW, shape(f["geometry"])) for f in json.load(open(CTX / "aeroway.geojson"))["features"]
            if f["geometry"]["type"] == "Polygon" and f["properties"].get("aeroway") in ("aerodrome", "apron")]
    airport_d = path(unary_union(aero)) if aero else ""

    named_out = {}
    for nid, g in named_geo.items():
        i = named[nid]["properties"]["indicators"]
        c = g.centroid
        named_out[nid] = {"name": named[nid]["properties"]["name"], "d": path(g), "c": [round(X(c.x), 1), round(Y(c.y), 1)],
                          "h": r1(i["height"]["median_m"]), "sea": int(round(i["coast"]["distance_to_sea_m"])),
                          "hw": int(round(i["access"]["to_highway_m"])),
                          "town": int(round(c.distance(town_c))),
                          "wet": round(i["wetness"]["water_share_250m"], 3), "cov": round(i["confidence"]["radar_coverage"], 3),
                          "fl10": i.get("flood", {}).get("p10_m"), "fl50": i.get("flood", {}).get("median_m")}

    out = {"schema": "tool/1", "unit_m": U, "W": W, "H": H, "grid": [a, 0.0, 0.0, d, round(e, 4), round(f_, 4)],
           "cells": C, "hwy": hwy_d, "roads": roads_d, "airport": airport_d, "kms": kms, "named": named_out,
           "flood": FLOOD, "boreholes": [[round(X(x), 1), round(Y(y), 1), ir] for x, y, ir in bh_xy],
           "frame": {"crs": "EPSG:32608", "e0": e0, "n0": n0, "unit_m": U}}
    json.dump(out, open(OUT / "tool.json", "w"), separators=(",", ":"))
    # the manifest owns the file list: add tool.json
    mp = OUT / "manifest.json"
    m = json.load(open(mp))
    m.setdefault("files", {})["tool"] = "tool.json"
    json.dump(m, open(mp, "w"), indent=1)
    print(f"wrote tool.json: {len(cells)} cells, W {W} H {H}, grid {out['grid']}, highway {hl.length / 1000:.1f} km, "
          f"{len(kms)} km marks, {(OUT / 'tool.json').stat().st_size / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
