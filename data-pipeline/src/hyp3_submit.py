"""Step 2b — submit Sentinel-1 InSAR jobs to ASF HyP3 (history for 2017–2025).
Pairs consecutive scenes on the same orbit path within each season.
Jobs take a while: SUBMIT EARLY, then run with --download later.
Usage: python src/hyp3_submit.py            # submit
       python src/hyp3_submit.py --download # fetch finished jobs
"""
import csv, sys
from collections import defaultdict
import hyp3_sdk as sdk
from common import load_config, path

cfg = load_config()
hyp3 = sdk.HyP3()  # prompts for Earthdata creds / uses ~/.netrc
name = cfg["sentinel1"]["hyp3_project_name"]

if "--download" in sys.argv:
    jobs = hyp3.find_jobs(name=name)
    jobs = hyp3.watch(jobs)
    jobs.download_files(str(path(cfg, "raw") / "s1"))
    sys.exit()

groups = defaultdict(list)
for r in csv.DictReader(open(path(cfg, "interim") / "granules.csv")):
    if r["source"] == "S1":
        groups[(r["season"], r["path"], r["flight_dir"])].append(r)

n = 0
for key, scenes in groups.items():
    scenes.sort(key=lambda r: r["start"])
    for a, b in zip(scenes, scenes[1:]):
        hyp3.submit_insar_job(a["id"], b["id"], name=name, include_displacement_maps=True,
                              apply_water_mask=True)
        n += 1
print(f"submitted {n} InSAR jobs under project '{name}'")
