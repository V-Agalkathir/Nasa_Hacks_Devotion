"""NISAR researcher view: write frontend/public/data/nisar/ from the Part 2 NISAR stack.

Every image is drawn in the same SVG frame as tool.json (run export_tool_v3.py first): a UTM 8N grid with
origin (e0, n0) from tool.json's frame, 25 m pixels, ceil(W*2) x ceil(H*2). Place each PNG at SVG (0, 0)
with size frame.svg_w x frame.svg_h and it lines up with the cells, highway and named areas.

Writes nisar/nisar.json plus, per NISAR pair (all 8):
  coh_<ref>_<sec>.png    coherence, land only, #F6F7F4 -> #274C77 over 0..1 (read from the native GUNW grid)
  iono_<ref>_<sec>.png   ionosphere screen in cm along the line of sight, frame median removed, +-15 cm
  mv_<ref>_<sec>.png     movement over the pair, kept pairs only (interim pairs/*.tif), +-3 cm
and s1_coh_<ref>_<sec>.png (Sentinel-1 coherence for 2025-07-01 -> 2025-07-13), season_coh_2026.png,
season_valid_2026.png. Nothing here feeds the screening tiers; it is the raw evidence behind Test B.
Usage: python src/export_nisar_web.py
"""
from __future__ import annotations

import json
import math
from datetime import date

import h5py
import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

from common import ROOT, grid, load_config
from radar_read import _nisar_group, inventory_nisar, inventory_s1, read_tif, water_mask

STACK = ROOT / "data/interim/motion/nisar_t159"
EVAL = ROOT / "data/interim/models/eval.json"
OUT = (ROOT / "../frontend/public/data/nisar").resolve()
TOOL = (ROOT / "../frontend/public/data/tool.json").resolve()
PX = 25.0                    # metres per image pixel (2 pixels per SVG unit)
PAIR_LIM, IONO_LIM = 3.0, 15.0   # cm at full colour
S1_PAIR = (date(2025, 7, 1), date(2025, 7, 13))


def save(rgba, name):
    # 64-colour palette PNG: about a quarter of the size, fine for slow northern connections
    img = Image.fromarray(rgba.astype("uint8"), "RGBA").quantize(colors=64, method=Image.Quantize.FASTOCTREE)
    img.save(OUT / name, optimize=True)
    return name


def diverging(v, lim):
    """Orange #E66101 = negative, white = zero, blue #2166AC = positive. NaN transparent."""
    t = np.clip(v / lim, -1, 1)
    a = np.abs(t)
    out = np.zeros(v.shape + (4,), np.float32)
    for ch, (o, b) in enumerate(zip((230, 97, 1), (33, 102, 172))):
        out[..., ch] = np.where(t < 0, 255 + (o - 255) * a, 255 + (b - 255) * a)
    out[..., 3] = 215
    out[~np.isfinite(v)] = 0
    return out


def sequential(v, lo, hi, c0=(233, 216, 166), c1=(39, 76, 119)):
    """Sand #E9D8A6 to #274C77 across lo..hi (sand, so low coherence never looks like empty land). NaN transparent."""
    t = np.clip((v - lo) / (hi - lo), 0, 1)
    out = np.zeros(v.shape + (4,), np.float32)
    for ch, (a, b) in enumerate(zip(c0, c1)):
        out[..., ch] = a + (b - a) * t
    out[..., 3] = 215
    out[~np.isfinite(v)] = 0
    return out


def r(v, n=3):
    return None if v is None or not np.isfinite(v) else round(float(v), n)


def main():
    cfg = load_config()
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.png"):      # old lon/lat images and cum_* are replaced by frame images
        old.unlink()
    ix = json.load(open(STACK / "index.json"))
    s = ix["seasons"]["2026"]
    lam = ix["wavelength_m"]

    # the shared SVG frame from tool.json
    tf = json.load(open(TOOL))
    e0, n0 = tf["frame"]["e0"], tf["frame"]["n0"]
    FW_, FH_ = math.ceil(tf["W"] * 2), math.ceil(tf["H"] * 2)
    FT = from_origin(e0, n0, PX, PX)
    frame = {"crs": "EPSG:32608", "e0": e0, "n0": n0, "px_m": PX, "width": FW_, "height": FH_,
             "unit_m": tf["unit_m"], "svg_w": FW_ / 2, "svg_h": FH_ / 2,
             "note": "Draw each image at SVG (0,0) with size svg_w x svg_h; same space as tool.json"}

    def to_frame(arr, tr, crs, resampling=Resampling.bilinear):
        dst = np.full((FH_, FW_), np.nan, np.float32)
        reproject(np.asarray(arr, np.float32), dst, src_transform=tr, src_crs=crs, src_nodata=np.nan,
                  dst_transform=FT, dst_crs="EPSG:32608", dst_nodata=np.nan, resampling=resampling)
        return dst

    gtr, _, _ = grid(cfg)
    wm = to_frame(water_mask(cfg).astype("float32"), gtr, "EPSG:4326", Resampling.nearest)
    land = wm == 0                        # outside the screening box counts as not land
    n_land = int(land.sum())

    def land_only(v):
        out = v.copy()
        out[~land] = np.nan
        return out

    raw = {(q.ref.isoformat(), q.sec.isoformat()): q for q in inventory_nisar(cfg)}
    pairs = []
    for p in s["pairs"]:
        ref, sec = p["ref"], p["sec"]
        row = {"ref": ref, "sec": sec, "days": p["days"], "used": p["used"], "reason": p.get("reason"),
               "coherent_fraction": p.get("coherent_fraction"), "ramp_cm": p.get("ramp_cm"), "ramp_flag": p.get("ramp_flag"),
               "reference": (p.get("masked") or {}).get("reference"), "land_median_cm": (p.get("masked") or {}).get("land_median_cm"),
               "granule": p.get("id"), "coh_img": None, "iono_img": None, "mv_img": None, "image": None,
               "coh_median": None, "iono_p95_cm": None, "iono_offset_cm": None, "valid_share": None,
               "median_cm": None, "p05_cm": None, "p95_cm": None}
        q = raw.get((ref, sec))
        if q is not None:
            with h5py.File(q.path, "r") as h:
                g, cg = _nisar_group(h, cfg)
                x, y = h[cg + "/xCoordinates"][()], h[cg + "/yCoordinates"][()]
                crs = f"EPSG:{int(np.asarray(h[cg + '/projection'][()]).item())}"
                coh = h[g + "/HH/coherenceMagnitude"][()].astype("float32")
                iono = h[g + "/HH/ionospherePhaseScreen"][()].astype("float32")
                cc = h[g + "/HH/connectedComponents"][()].astype("float32") if "HH/connectedComponents" in h[g] else None
            dx, dy = x[1] - x[0], y[0] - y[1]
            ntr = from_origin(x[0] - dx / 2, y[0] + dy / 2, dx, dy)
            coh[coh <= 0] = np.nan
            cf = land_only(to_frame(coh, ntr, crs))
            io = to_frame(iono * lam / (4 * np.pi) * 100, ntr, crs)   # radians -> cm along the line of sight
            off = float(np.nanmedian(io)) if np.isfinite(io).any() else np.nan
            io = io - off                     # a constant phase cancels in every referenced map
            fc = cf[np.isfinite(cf)]
            fi = np.abs(io[np.isfinite(io)])
            row.update({"coh_img": save(sequential(cf, 0, 1), f"coh_{ref}_{sec}.png"),
                        "iono_img": save(diverging(io, IONO_LIM), f"iono_{ref}_{sec}.png"),
                        "coh_median": r(np.median(fc)) if fc.size else None,
                        "iono_p95_cm": r(np.percentile(fi, 95), 2) if fi.size else None,
                        "iono_offset_cm": r(off, 1),
                        "valid_share": r((fc >= ix["thresholds"]["coherence_min"]).sum() / n_land) if n_land else None})
            if cc is not None:   # share of land inside a connected (unwrapped) component
                ccf = to_frame(np.where(cc > 0, 1.0, 0.0).astype("float32"), ntr, crs, Resampling.nearest)
                row["conn_share"] = r(float(((ccf > 0.5) & land).sum()) / n_land) if n_land else None
        tif = STACK / "pairs" / f"pair_{ref.replace('-', '')}_{sec.replace('-', '')}.tif"
        if p["used"] and tif.exists():
            with rasterio.open(tif) as src:
                mv = to_frame(src.read(1).astype("float32"), src.transform, src.crs)
            fm = mv[land & np.isfinite(mv)]
            row["mv_img"] = row["image"] = save(diverging(mv, PAIR_LIM), f"mv_{ref}_{sec}.png")
            if fm.size:
                row.update({"median_cm": r(np.median(fm), 2), "p05_cm": r(np.percentile(fm, 5), 2),
                            "p95_cm": r(np.percentile(fm, 95), 2), "mv_valid_share": r(fm.size / n_land),
                            "mv_in_noise": r(float((np.abs(fm) <= 1.0).mean()))})
        pairs.append(row)

    # Sentinel-1 coherence for the comparison pair (C-band, 12 days, summer 2025)
    s1 = None
    for q in inventory_s1(cfg):
        if (q.ref, q.sec) == S1_PAIR:
            c, ctr, ccrs = read_tif(q.path.replace("_unw_phase.tif", "_corr.tif"), nodata_zero=True)
            cf = land_only(to_frame(c, ctr, ccrs))
            fc = cf[np.isfinite(cf)]
            tag = f"{S1_PAIR[0].isoformat()}_{S1_PAIR[1].isoformat()}"
            s1 = {"img": save(sequential(cf, 0, 1), f"s1_coh_{tag}.png"), "coh_median": r(np.median(fc)) if fc.size else None,
                  "pair": f"{S1_PAIR[0].isoformat()}→{S1_PAIR[1].isoformat()}", "granule": q.pid,
                  "valid_share": r((fc >= ix["thresholds"]["coherence_min"]).sum() / n_land) if n_land else None}
            break

    # Sentinel-1 2025 summer pairs: median coherence over the same land, for the coherence strip
    s1_pairs = []
    for q in sorted(inventory_s1(cfg), key=lambda q: q.ref):
        if q.ref.year != 2025 or (q.sec - q.ref).days != 12 or not (date(2025, 6, 1) <= q.ref and q.sec <= date(2025, 10, 10)):
            continue
        c, ctr, ccrs = read_tif(q.path.replace("_unw_phase.tif", "_corr.tif"), nodata_zero=True)
        fc = land_only(to_frame(c, ctr, ccrs))
        fc = fc[np.isfinite(fc)]
        if fc.size:
            s1_pairs.append({"ref": q.ref.isoformat(), "sec": q.sec.isoformat(), "coh_median": r(np.median(fc))})
    if s1:
        s1["pairs_2025"] = s1_pairs

    # season layers, in the frame too
    layers = []
    with rasterio.open(STACK / "coh_2026.tif") as src:
        coh26 = land_only(to_frame(src.read(1).astype("float32"), src.transform, src.crs))
    with rasterio.open(STACK / "valid_2026.tif") as src:
        val26 = land_only(to_frame(src.read(1).astype("float32"), src.transform, src.crs))
    layers.append({"id": "coh", "label": "Median coherence, summer 2026", "image": save(sequential(coh26, 0, 1), "season_coh_2026.png"),
                   "range": [0, 1], "median": r(np.nanmedian(coh26))})
    layers.append({"id": "valid", "label": "Share of pairs valid per pixel", "image": save(sequential(val26, 0, 1, c1=(94, 71, 51)), "season_valid_2026.png"),
                   "range": [0, 1]})

    ev = json.load(open(EVAL))
    tb = ev["model_a"]["test_b"]
    m = tb["metrics"]["rho_block"]
    test_b = {"status": tb["status"], "rho_block": m.get("value"), "rho_block_ci95": m.get("ci95"), "n_blocks": m.get("n_blocks"),
              "rho_pixel": tb["metrics"].get("rho_pixel"), "cross_sensor_sign_r_vs_s1_2025": tb.get("cross_sensor_sign_r_vs_s1_2025"),
              "kappa_note": tb.get("kappa_note"), "method": tb.get("method"), "prereg_tag": ev.get("prereg_tag")}

    out = {
        "schema": "nisar/2", "generated_at": ix["generated_at"], "code_version": ix.get("code_version"),
        "bounds": ix["grid"]["bbox"], "frame": frame,
        "acquisition": {"sensor": ix["sensor"], "band": ix["band"], "wavelength_m": ix["wavelength_m"], "track": ix["track"],
                        "frame": ix["frame"], "flight_dir": ix["flight_dir"], "polarisation": ix["polarisation"],
                        "incidence_deg": ix.get("incidence_deg"), "component": ix["component"], "sign": ix["sign"],
                        "grid": ix["grid"], "corrections": ix["corrections"], "thresholds": ix["thresholds"],
                        "reference": {k: ix["reference"][k] for k in ("method", "n_cells", "meaning")},
                        "reference_diag_cm": ix["reference"].get("diagnostics", {}).get("2026")},
        "season": {k: s.get(k) for k in ("first_usable_date", "first_date_reason", "thaw_started_before_first_date",
                                         "tdd_before_first_date", "last_usable_date", "gaps", "network", "stats", "checks")},
        # acquisition dates and their QC flags only: the cumulative maps are gone
        "dates": [{"date": d["date"], "wet_flag": d["wet_flag"], "freeze_flag": d["freeze_flag"]} for d in s["dates"]],
        "pairs": pairs, "s1": s1, "layers": layers, "test_b": test_b,
        "scale": {"pair_cm": PAIR_LIM, "iono_cm": IONO_LIM, "coh": [0, 1]},
        "definitions": {
            "coh_median": "Median coherence over land in the frame",
            "valid_share": f"Share of land in the frame with coherence at least {ix['thresholds']['coherence_min']}",
            "mv_valid_share": "Share of land in the frame with a movement value after the stack's masks",
            "mv_in_noise": "Share of mapped movement within ±1 cm (inside the noise)",
            "conn_share": "Share of land inside a connected component after unwrapping",
            "iono_p95_cm": "95th percentile of |ionosphere| along the line of sight in the frame, after removing the frame median",
            "iono_offset_cm": "The frame median removed from the ionosphere map (a constant cancels in referenced maps)",
            "iono_conversion": f"radians x {lam} / (4 pi) x 100 = cm along the line of sight",
        },
        # mission facts for the timeline and the outlook card (NISAR data availability page, checked 15 Nov 2026)
        "instrument_gap": {"from": "2026-07-27", "to": "2026-08-10",
                           "note": "Permanent NISAR instrument data gap: no acquisitions exist for these dates"},
        "outlook": [
            {"date": "2026-06-17", "text": "Provisional NISAR products start. This summer's pairs are provisional."},
            {"date": "2026-10-21", "text": "Fully validated products start, after this summer's thaw ended."},
            {"date": "2027", "text": "Provisional 2026 data reprocessed with the validated processor."},
            {"date": "Summer 2027", "text": "First fully validated thaw season over Tuk."},
            {"date": "2028 onward", "text": "Year-to-year pairs: L-band keeps coherence over longer spans than C-band in published Arctic studies."},
        ],
        "outlook_source": "https://nisar-docs.asf.alaska.edu/availability-overview/",
    }
    json.dump(out, open(OUT / "nisar.json", "w"), indent=1, default=lambda o: None)
    size = sum(f.stat().st_size for f in OUT.iterdir())
    print(f"wrote {OUT} ({len(list(OUT.iterdir()))} files, {size / 1024:.0f} KB), frame {FW_}x{FH_} px, land px {n_land}")
    for pr in pairs:
        print(f"  {pr['ref']}→{pr['sec']} used={pr['used']} coh_med={pr['coh_median']} valid={pr['valid_share']} "
              f"iono_p95={pr['iono_p95_cm']} off={pr['iono_offset_cm']} mv={pr['mv_img'] is not None} med={pr['median_cm']}")
    print("  s1", {k: v for k, v in (s1 or {}).items() if k != "granule"})


if __name__ == "__main__":
    main()
