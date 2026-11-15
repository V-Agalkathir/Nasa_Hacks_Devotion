# Brief 5: Automatic updates and deployment

> Synced on 14 Nov 2026 from the team's shared Claude doc, "Tuk Ground-Screening Tool: Build Plan". Edit the doc first, then re-sync.

Write only the spec file named below. Do not change code. Read `docs/architecture/00-overview.md` first if you have the repo.

This part designs the loop that keeps the tool current: when NISAR publishes a new pass over Tuktoyaktuk, the tool finds it, processes it and republishes, with nobody at a keyboard. Return a spec as `docs/architecture/specs/05-automation.md`; read `README.md`, `data-pipeline/src/*.py` and `frontend/vite.config.js` first if you have the repo.

**Your job:** specify the scheduled workflow, the state it keeps, how each source is polled, how failures are contained, and how the site is deployed, precisely enough to write the workflow file and glue scripts.

## Decisions already made

- **Scheduler:** GitHub Actions on a cron schedule, plus a manual trigger. No server, no paid services.
- **Credentials** in GitHub secrets. A free NASA Earthdata login is needed for NISAR downloads and HyP3.
- **Honest claim:** "updates every 12 days during the thaw season, June to September". In winter the workflow runs, finds nothing usable, and says so.
- **No retraining per run.** A run applies the stored sensitivity map to flag areas moving more than expected, then refreshes behaviour classes, tiers and the coring list. The ground prediction and the shoreline model are re-run by hand, a few times a year.
- **The site always loads.** A failed run leaves the last good data in place.

## Facts to design around

- NISAR track 159 frame 53 covers the area, with a new pass every 12 days. Level-2 products appear about 36–72 hours after acquisition; each new GUNW adds one 12-day step. File sizes unknown: assume hundreds of MB.
- Sentinel-1 updates go through HyP3: submit a job, download later. 8,000 credits a month; products expire after 14 days.
- Catalogue search needs no login. Station temperatures from `api.weather.gc.ca` need no login and update daily.
- A GitHub-hosted runner has about 14 GB free disk and a 6-hour job limit. Scheduled workflows can be delayed and are disabled after 60 days without repo activity.
- Vite uses `base: "./"`, so the built site works from any path.

## What the spec must answer

**A. The loop**

1. Steps in order: search, compare with processed list, decide if anything new and usable, fetch, process, screen, export, publish.
2. The season gate: when the season is open (date, station temperature, or new-pair coherence) and what the workflow reports when closed.
3. Schedule: how often to poll, and why.

**B. State**

1. What persists between runs (processed granules, pending HyP3 jobs, current season stack, model rasters) and where: repo, orphan branch, release assets, or Actions cache. Raw files are never committed.
2. Rebuilding state from a fresh clone.
3. Making a run safe to repeat.

**C. Per source**

1. NISAR: detect a new pair, pick one version of duplicates, fetch within disk limits. Compare reading only the area from remote HDF5 over HTTPS against download-crop-delete.
2. Sentinel-1 via HyP3: submit in one run, collect in a later one; credit budgeting; failed jobs.
3. Temperature: append new days, recompute TDD.
4. Slow layers (elevation, roads, shorelines): refreshed by hand. Say how.

**D. Publishing**

1. Where exported files go: commit to `main`, a data branch, or build-and-deploy without committing. Team rule: `main` must always build and demo.
2. Deployment: GitHub Pages via Actions or Vercel, with exact configuration. The repo owner must enable Pages and add secrets.
3. Freshness shown on the site: `generated_at`, latest pass date and sensor, and status ("up to date", "paused for winter", "last update failed, showing data from \<date>"). Define the `manifest.json` fields.

**E. Failure and safety**

1. For each step: what can fail, how it is reported, what stays published.
2. A validation gate before publishing (missing keys, empty rasters, values out of physical range).
3. Secrets: names, which steps see them, and confirmation that fork-triggered runs cannot read them.
4. Limits and a guard against resubmitting HyP3 jobs every run.

**F. The demo**

1. The smallest honest Sunday version: a hand-triggered run whose log shows it found the 2026 NISAR pairs, processed at least one, and published. List what must be in place.
2. Fallback if NISAR processing can't run in Actions: the workflow searches, reports and deploys while processing runs on a laptop, described truthfully.

## Known traps

- README uses `EARTHDATA_USER`/`EARTHDATA_PASS`: check what `asf_search` and `hyp3_sdk` actually read and standardise.
- `export_web.py` rewrites `manifest.json` from scratch, dropping fields other steps add (such as the demo-data flag) unless the export owns them.
- Use acquisition dates from granule names, not run dates (UTC cron near midnight).
- A missed pass can make the next pair span 24 days, as in July–August 2026. Accept it.
- An automated commit must not retrigger the workflow.

## Tiers and required sections

- **Must:** manual-trigger workflow that searches, reports new scenes, builds and deploys.
- **Should:** NISAR fetch and processing in the workflow; state file; freshness fields in the UI.
- **Stretch:** HyP3 two-phase updates; validation gate; failure status on the site.

The returned spec needs: workflow diagram and steps; state design with rebuild procedure; per-source logic; publishing and deployment config; a failure table (step, failure, detection, result); `manifest.json` freshness fields; a setup checklist for the repo owner; the Sunday demo plan and fallback; anything unconfirmed.
