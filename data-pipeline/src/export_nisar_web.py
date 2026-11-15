"""NISAR researcher view: write frontend/public/data/nisar/ from the Part 2 NISAR stack.

Reads data/interim/motion/nisar_t159 (index.json, pairs/*.tif, cum_*.tif, coh_/valid_ 2026)
and the Test B block of data/interim/models/eval.json. Writes:
  nisar/nisar.json            pairs, dates, QC checks, Test B numbers, acquisition metadata, layer list
  nisar/pair_<ref>_<sec>.png  12/24-day displacement per used pair (diverging, same palette as the site)
  nisar/cum_<date>.png        cumulative displacement to each date
  nisar/coh_2026.png          median coherence over the season
  nisar/valid_2026.png        share of pairs valid per pixel
Nothing here feeds the screening tiers; it is the raw evidence behind Test B.
Usage: python src/export_nisar_web.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
STACK = ROOT / "data/interim/motion/nisar_t159"
EVAL = ROOT / "data/interim/models/eval.json"
OUT = (ROOT / "../frontend/public/data/nisar").resolve()
PAIR_LIM, CUM_LIM = 3.0, 5.0  # cm at full colour


def read(p):
    with rasterio.open(p) as r:
        return r.read(1).astype("float32")


def save(rgba, name):
    # 64-colour palette PNG: about a quarter of the size, fine for slow northern connections
    img = Image.fromarray(rgba.astype("uint8"), "RGBA").quantize(colors=64, method=Image.Quantize.FASTOCTREE)
    img.save(OUT / name, optimize=True)
    return name


def diverging(v, lim):
    """Orange (230,97,1) = sank more than the reference, white = no change, blue (33,102,172) = rose. NaN transparent."""
    t = np.clip(v / lim, -1, 1)
    a = np.abs(t)
    out = np.zeros(v.shape + (4,), np.float32)
    for ch, (o, b) in enumerate(zip((230, 97, 1), (33, 102, 172))):
        out[..., ch] = np.where(t < 0, 255 + (o - 255) * a, 255 + (b - 255) * a)
    out[..., 3] = 210
    out[~np.isfinite(v)] = 0
    return out


def sequential(v, lo, hi, rgb=(31, 111, 125)):
    """Cream (255,252,240) to `rgb` across lo..hi. NaN transparent."""
    t = np.clip((v - lo) / (hi - lo), 0, 1)
    out = np.zeros(v.shape + (4,), np.float32)
    for ch, (c0, c1) in enumerate(zip((255, 252, 240), rgb)):
        out[..., ch] = c0 + (c1 - c0) * t
    out[..., 3] = 215
    out[~np.isfinite(v)] = 0
    return out


def stats(v):
    f = v[np.isfinite(v)]
    if not f.size:
        return {"valid_share": 0.0, "median_cm": None, "p05_cm": None, "p95_cm": None}
    return {"valid_share": round(float(f.size / v.size), 3), "median_cm": round(float(np.median(f)), 2),
            "p05_cm": round(float(np.percentile(f, 5)), 2), "p95_cm": round(float(np.percentile(f, 95)), 2)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ix = json.load(open(STACK / "index.json"))
    s = ix["seasons"]["2026"]
    layers = []

    pairs = []
    for p in s["pairs"]:
        ref, sec = p["ref"], p["sec"]
        tif = STACK / "pairs" / f"pair_{ref.replace('-', '')}_{sec.replace('-', '')}.tif"
        row = {"ref": ref, "sec": sec, "days": p["days"], "used": p["used"], "reason": p.get("reason"),
               "coherent_fraction": p.get("coherent_fraction"), "ramp_cm": p.get("ramp_cm"), "ramp_flag": p.get("ramp_flag"),
               "reference": (p.get("masked") or {}).get("reference"), "land_median_cm": (p.get("masked") or {}).get("land_median_cm"),
               "granule": p.get("id"), "image": None}
        if tif.exists():
            v = read(tif)
            row["image"] = save(diverging(v, PAIR_LIM), f"pair_{ref}_{sec}.png")
            row.update({k: v_ for k, v_ in stats(v).items()})
        pairs.append(row)

    dates = []
    for d in s["dates"]:
        v = read(STACK / d["file"])
        dates.append({"date": d["date"], "wet_flag": d["wet_flag"], "freeze_flag": d["freeze_flag"],
                      "image": save(diverging(v, CUM_LIM), f"cum_{d['date']}.png"), **stats(v)})

    coh = read(STACK / "coh_2026.tif")
    valid = read(STACK / "valid_2026.tif")
    layers.append({"id": "coh", "label": "Median coherence, summer 2026", "image": save(sequential(coh, 0.1, 0.7), "coh_2026.png"),
                   "range": [0.1, 0.7], **{k: v for k, v in stats(coh).items() if k == "valid_share"}, "median": round(float(np.nanmedian(coh)), 3)})
    layers.append({"id": "valid", "label": "Share of pairs valid per pixel", "image": save(sequential(valid, 0, 1, (94, 71, 51)), "valid_2026.png"),
                   "range": [0, 1]})

    ev = json.load(open(EVAL))
    tb = ev["model_a"]["test_b"]
    m = tb["metrics"]["rho_block"]
    test_b = {"status": tb["status"], "rho_block": m.get("value"), "rho_block_ci95": m.get("ci95"), "n_blocks": m.get("n_blocks"),
              "rho_pixel": tb["metrics"].get("rho_pixel"), "cross_sensor_sign_r_vs_s1_2025": tb.get("cross_sensor_sign_r_vs_s1_2025"),
              "kappa_note": tb.get("kappa_note"), "method": tb.get("method"), "prereg_tag": ev.get("prereg_tag")}

    out = {
        "schema": "nisar/1", "generated_at": ix["generated_at"], "code_version": ix.get("code_version"),
        "bounds": ix["grid"]["bbox"],
        "acquisition": {"sensor": ix["sensor"], "band": ix["band"], "wavelength_m": ix["wavelength_m"], "track": ix["track"],
                        "frame": ix["frame"], "flight_dir": ix["flight_dir"], "polarisation": ix["polarisation"],
                        "incidence_deg": ix.get("incidence_deg"), "component": ix["component"], "sign": ix["sign"],
                        "grid": ix["grid"], "corrections": ix["corrections"], "thresholds": ix["thresholds"],
                        "reference": {k: ix["reference"][k] for k in ("method", "n_cells", "meaning")},
                        "reference_diag_cm": ix["reference"].get("diagnostics", {}).get("2026")},
        "season": {k: s.get(k) for k in ("first_usable_date", "first_date_reason", "thaw_started_before_first_date",
                                         "tdd_before_first_date", "last_usable_date", "gaps", "network", "stats", "checks")},
        "pairs": pairs, "dates": dates, "layers": layers, "test_b": test_b,
        "scale": {"pair_cm": PAIR_LIM, "cum_cm": CUM_LIM},
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
    print(f"wrote {OUT} ({len(list(OUT.iterdir()))} files, {size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
