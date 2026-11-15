"""Shared helpers: config, paths, AOI geometry."""
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]


def load_config():
    with open(ROOT / "config.yaml") as f:
        return yaml.safe_load(f)


def path(cfg, key, *sub):
    p = (ROOT / cfg["paths"][key]).resolve().joinpath(*sub)
    p.mkdir(parents=True, exist_ok=True)
    return p


def aoi_wkt(cfg):
    w, s, e, n = cfg["aoi"]["bbox"]
    return f"POLYGON(({w} {s},{e} {s},{e} {n},{w} {n},{w} {s}))"
