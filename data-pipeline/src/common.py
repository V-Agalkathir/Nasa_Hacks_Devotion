"""Shared helpers: load config, resolve paths relative to data-pipeline/."""
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]


def load_config():
    with open(ROOT / "config.yaml") as f:
        return yaml.safe_load(f)


def path(cfg, key):
    p = (ROOT / cfg["paths"][key]).resolve()
    p.mkdir(parents=True, exist_ok=True) if key in ("raw", "interim", "web_out") else None
    return p
