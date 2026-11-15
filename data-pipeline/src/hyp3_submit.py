"""Part 1 / step 2: submit Sentinel-1 pairs from granules.csv to ASF HyP3, and download finished jobs.

Safe to re-run: pairs already submitted under the project name are skipped (no duplicate credits).
Products include what Part 2 needs: unwrapped phase, coherence, incidence-angle map, LOS displacement
(for the sign check), DEM and look vectors. 80 m (20x4 looks) = 10 credits/pair.

Login: reads your Earthdata credentials from ~/.netrc (_netrc on Windows), which earthaccess already wrote.

Usage
  python src/hyp3_submit.py --seasons 2021-2025            # DRY RUN: shows what would be submitted + credits
  python src/hyp3_submit.py --seasons 2021-2025 --submit   # actually submit
  python src/hyp3_submit.py --status                       # job counts by status
  python src/hyp3_submit.py --download                     # fetch SUCCEEDED jobs not yet on disk (do it within 14 days!)
"""
import csv, sys, zipfile
import hyp3_sdk as sdk
from common import load_config, path

cfg = load_config()
H = cfg["hyp3"]
name = H["project_name"]
args = sys.argv
stack = args[args.index("--stack") + 1] if "--stack" in args else "s1_p137"

hyp3 = sdk.HyP3()  # uses netrc
existing = hyp3.find_jobs(name=name)

if "--status" in args:
    from collections import Counter
    print(name, dict(Counter(j.status_code for j in existing)), f"credits left: {hyp3.check_credits()}")
    sys.exit()

if "--download" in args:
    raw = path(cfg, "raw", "s1")
    done = [j for j in existing if j.succeeded()]
    todo = [j for j in done if not (raw / j.job_id).exists()]
    print(f"{len(done)} succeeded, {len(todo)} to download -> {raw}")
    for j in todo:
        for zp in sdk.Batch([j]).download_files(raw):
            with zipfile.ZipFile(zp) as z:
                z.extractall(raw / j.job_id)
            zp.unlink()
    expired = [j for j in done if j.expired()]
    if expired:
        print(f"WARNING: {len(expired)} jobs expired before download; re-submit with --submit --resubmit-expired")
    sys.exit()

# ---- plan submission ----
lo, hi = (int(x) for x in args[args.index("--seasons") + 1].split("-")) if "--seasons" in args else (2021, 2025)
rows = [r for r in csv.DictReader(open(path(cfg, "interim") / "granules.csv"))
        if r["source"] == "S1" and r["stack_id"] == stack and lo <= int(r["season"]) <= hi]
already = {tuple(j.job_parameters["granules"]) for j in existing
           if not ("--resubmit-expired" in args and j.expired()) and not j.failed()}
plan = [r for r in rows if tuple(r["id"].split("|")) not in already]
cost = len(plan) * H["credits_per_job"]
credits = hyp3.check_credits()
print(f"{stack} {lo}-{hi}: {len(rows)} pairs planned, {len(rows) - len(plan)} already submitted, "
      f"{len(plan)} new = {cost} credits (you have {credits})")

if "--submit" not in args:
    print("Dry run. Add --submit to send.")
    sys.exit()
if credits is not None and cost > credits:
    sys.exit("Not enough credits; narrow --seasons.")

prep = [sdk.HyP3.prepare_insar_job(*r["id"].split("|"), name=name, looks=H["looks"],
                                   include_inc_map=True, include_look_vectors=True, include_dem=True,
                                   include_displacement_maps=True, include_wrapped_phase=False,
                                   apply_water_mask=False)
        for r in plan]
for i in range(0, len(prep), 50):           # submit in chunks
    hyp3.submit_prepared_jobs(prep[i:i + 50])
print(f"submitted {len(prep)} jobs under '{name}'. Check with --status; download with --download.")
