"""Model B: ground prediction where radar can't measure (spec 03 section 3).

This build implements the label gate (3.1) and the Reindeer Point check's measured half (3.8).
With the 2021-2025 Sentinel-1 record, Model A finds too few confident 'degrading' cells to train
on, so Model B is `not_run` and no ground_pred.tif is written (spec 3.5: never a fake layer).
"""
from __future__ import annotations

import json

import numpy as np

from common import ROOT, grid
from radar_read import cell_utm, rasterize_geojson, read_grid_tif


def run(cfg):
    gp = cfg["models"]["ground_pred"]
    d = ROOT / "data/interim/models"
    cls = read_grid_tif(d / "behaviour.tif").ravel()
    conf = read_grid_tif(d / "behaviour_conf.tif").ravel()
    x, y = (a.ravel() for a in cell_utm(cfg))
    _, H, W = grid(cfg)
    cols = np.tile(np.arange(W), H)
    thin = cols % gp["thin_cols"] == 0
    lab = np.isin(cls, [1, 2, 3]) & (conf >= 45) & (conf <= 100) & thin
    blk = np.floor(x / (gp["block_km"] * 1000)) * 1e5 + np.floor(y / (gp["block_km"] * 1000))
    n_deg = int((lab & (cls == 3)).sum())
    n_not = int((lab & np.isin(cls, [1, 2])).sum())
    b_deg = int(len(np.unique(blk[lab & (cls == 3)])))
    b_not = int(len(np.unique(blk[lab & np.isin(cls, [1, 2])])))
    ok = (n_deg >= gp["min_labels_per_class"] and n_not >= gp["min_labels_per_class"]
          and b_deg >= gp["min_blocks_per_class"] and b_not >= gp["min_blocks_per_class"])
    res = {
        "status": "not_run" if not ok else "pending",
        "reason": None if ok else (f"minimum data unmet: {n_deg} confident degrading labels in {b_deg} blocks "
                                   f"(needs {gp['min_labels_per_class']} in {gp['min_blocks_per_class']}); "
                                   "Model A finds almost no degrading ground it can measure"),
        "metrics": None, "baselines": None, "weighted": {"ba_model": None, "ba_nn": None},
        "domain_auc": None, "applicability_coverage": None,
        "n_labels": {"degrading": n_deg, "not_degrading": n_not},
        "n_blocks": {"degrading": b_deg, "not_degrading": b_not},
        "ui": "Ground prediction was not run: there were too few measured examples of degrading ground to learn from.",
    }
    # Reindeer Point: measured half (m_A) only; the predicted half needs Model B
    rp = None
    p = ROOT / "data/interim/screening/named_areas.geojson"
    if p.exists():
        feats = [f for f in json.load(open(p))["features"] if f["properties"]["id"] == "reindeer_point"]
        if feats:
            m = rasterize_geojson(cfg, feats, all_touched=True).ravel()
            meas = m & np.isin(cls, [1, 2, 3]) & (conf >= 45) & (conf <= 100)
            share = float((cls[meas] == 3).mean()) if meas.any() else None
            rp = {"status": "not_available", "reason": "Model B not run",
                  "m_A_share_degrading": None if share is None else round(share, 3),
                  "m_A_n_cells": int(meas.sum()),
                  "note": "Radar labels come from the same area, so this is a consistency check, not proof. "
                          "Homes sit on gravel pads; at 80 m radar cannot separate pad settling from ground thaw."}
    return res, rp
