# Part 5 spec: Automatic updates and deployment

Target path in repo: `docs/architecture/specs/05-automation.md`
Status: written 14 Nov 2026 from the build plan only. The repo (`README.md`, `data-pipeline/src/*.py`, `frontend/vite.config.js`) was **not** available, so every statement about existing code is marked **[check repo]**. Section 12 lists everything unconfirmed.

---

## 0. Summary of decisions

| Topic | Decision |
|---|---|
| Scheduler | One GitHub Actions workflow, `.github/workflows/update.yml`: daily cron + manual trigger + deploy-only on pushes to `main` |
| Poll rate | Daily (14:47 UTC). Searching is free and takes under a minute. Passes arrive every 12 days with 36–72 h latency, so daily polling never adds more than about a day of lag |
| Season gate | Calendar window 1 Jun – 15 Oct, then a temperature check per pass, then a coherence check after cropping. Outside the window the run searches, reports, and processes nothing |
| State | Orphan branch `pipeline-state` holds small, durable files. `main` never receives automated commits |
| Raw files | Never committed. Downloaded, cropped, deleted within the same run |
| NISAR | Download, crop, delete (default). Remote HDF5 read is a benchmarked option behind a config switch, not the default |
| Sentinel-1 | Two-phase HyP3 (submit in one run, collect in a later one), switched off by default, with a credit guard |
| Publishing | Build the site from `main` code plus `pipeline-state` data, deploy with GitHub Pages via Actions. No Vercel |
| Manifest | Only `export_web.py` writes `manifest.json`. Other steps write `state/run_status.json`, which the export reads |
| Failure rule | Any failure leaves the last good data published. The site says so |
| Demo | Hand-triggered run whose log shows it found the 2026 NISAR pairs, processed at least one, and published |

---

## 1. The loop (A)

### 1.1 Workflow diagram

```
 cron 14:47 UTC daily ─┐
 manual dispatch ──────┼──> JOB update (has secrets, writes pipeline-state only)
 push to main ─────────┘        │
 (deploy-only mode)             ▼
                         0 restore state ──fail──> rebuild state (§3.2)
                                │
                         1 season gate ──closed──> write status paused_winter ──┐
                                │open                                           │
                         2 search NISAR (+ S1 if enabled)                       │
                                │                                               │
                         3 diff against state, pick usable new pairs           │
                                │none new ──> status up_to_date / delayed ──────┤
                                │new                                            │
                         4 fetch (one pair at a time) ── crop ── delete raw     │
                                │                                               │
                         5 process (Part 2 inversion on stored pairs)           │
                                │                                               │
                         6 apply stored models (Part 3) + screen (Part 4)       │
                                │                                               │
                         7 export (Part 4 export_web.py)                        │
                                │                                               │
                         8 validation gate ──fail──> status failed/held ────────┤
                                │pass                                           │
                         9 commit state + web files to pipeline-state           │
                                ▼                                               ▼
                        JOB deploy (no secrets, `if: always()`) ◄───────────────┘
                         build Vite from main + web/ from pipeline-state
                         upload Pages artifact ── deploy-pages
```

### 1.2 Steps in order

Each step is one CLI entry point, `python -m pipeline <step>` **[check repo: the existing layout is `data-pipeline/src/*.py`; keep those module names and add a thin `run.py` that calls them in this order]**. Every step reads and writes only the paths in the build plan's interface table, plus the state files in §3.

| # | Step | Does | Exit codes |
|---|---|---|---|
| 0 | `restore` | Clone `pipeline-state` into `data/state/`. If absent or unreadable, run `rebuild` (§3.2) | 0 ok, 10 rebuilt, 1 fatal |
| 1 | `gate` | Evaluate the season gate (§1.3) and write `run_status.json` | 0 open, 20 closed |
| 2 | `search` | Query the catalogue (§4.1), write `data/interim/granules.csv` (same columns as the Part 1→2 interface) | 0, 30 search failed |
| 3 | `plan` | Compare with `state.json`; produce `plan.json`: pairs to fetch, pairs excluded and why, HyP3 jobs to submit or collect | 0 |
| 4 | `fetch` | Fetch and crop each planned pair, one at a time (§4.1) | 0, 40 some pairs failed |
| 5 | `process` | Call Part 2's inversion over every stored per-pair product for the current season; write `data/interim/motion/<stack_id>/` | 0, 50 |
| 6 | `apply` | Part 3: apply the stored sensitivity map to flag areas moving more than expected, refresh behaviour classes; Part 4: tiers and coring list | 0, 60 |
| 7 | `export` | `export_web.py` writes `frontend/public/data/` in a staging directory | 0, 70 |
| 8 | `validate` | Validation gate (§6.2) on the staging directory | 0 pass, 80 fail, 81 hold for review |
| 9 | `publish_state` | Commit state and `web/` to `pipeline-state`, push with rebase retry | 0, 90 |

`run_status.json` is updated at the end of every step so a crash always leaves a record of the last completed step.

### 1.3 The season gate (A2)

Three layers, cheapest first. Each layer only decides what that layer is for.

1. **Calendar window (decides whether to fetch anything).** Default `season.window: ["06-01", "10-15"]` in `config.yaml` **[add key]**. Outside it: search still runs so the log can say "2 NISAR pairs exist after 15 Oct, outside thaw season, not processed", but nothing is fetched. Why 1 Jun: thaw starts about 3 weeks before NISAR's first scene on 25 Jun, and the product claim is "June to September". Why 15 Oct: the last good 2026 pair is 11 Oct; the two pairs to 4 Nov are likely snow-affected.
2. **Temperature check per pair (decides whether to download it).** Using `daily_temperature.csv`, compute the mean of `tmean_c` over the 7 days ending at the pair's secondary acquisition date. If it is below 0 °C the pair is excluded as `cold`. If temperature data for those days are missing, do not block: fetch and let layer 3 decide, and record `temp_missing`.
3. **Coherence check after cropping (decides whether the pair enters the stack).** Use the thresholds from `02-radar-processing.md` (mean coherence over the area and valid-pixel share). A pair below them is excluded as `low_coherence_or_snow`, recorded in state, and never retried unless forced.

Part 2 remains the authority on each season's first usable date. Layers 1 and 2 are permissive pre-filters to save bandwidth, not the science.

**What the workflow reports when closed** (written to `run_status.json`, then `manifest.json`):
`update_status: "paused_winter"`, message "Paused for winter. Updates resume when the thaw season opens (about June). Latest pass processed: `<date>`, `<sensor>`."

**Other statuses** (closed enum, also used by the UI):

| `update_status` | When | UI line |
|---|---|---|
| `up_to_date` | Season open, searched today, nothing new, latest pass within 20 days | "Up to date. Last radar pass: `<date>`, `<sensor>`. Updates every 12 days, June to September." |
| `updated` | A run published at least one new pass | same as above, with "New pass added" for 3 days |
| `delayed` | Season open and no new usable pass for more than 20 days (12-day cadence + 72 h latency + slack) | "No new pass found since `<date>`; one was expected by `<date>`." |
| `paused_winter` | Gate closed | text above |
| `failed_showing_last_good` | Run failed or was held; last good data stay published | "Last update failed, showing data from `<date>`." |
| `held_for_review` | Validation gate flagged a large change (§6.2) | "Update held for review. Showing data from `<date>`." |
| `demo_data` | Any layer is simulated (demo flag set) | demo banner stays on |

### 1.4 Schedule (A3)

```yaml
on:
  schedule:
    - cron: "47 14 * * *"     # daily; minute 47 avoids the top-of-hour queue
  workflow_dispatch: { ... }  # §7
  push:
    branches: [main]
    paths: ["frontend/**", "data-pipeline/src/export_web.py", ".github/workflows/update.yml"]
```

Why daily: the search is free and fast, so a daily poll costs almost nothing and bounds lag. Why not hourly: products appear 36–72 h after acquisition and the cadence is 12 days, so more polling finds nothing. Scheduled runs can be delayed by tens of minutes and are skipped under load, so do not rely on a precise time. Do not schedule near 00:00 UTC. Acquisition dates always come from granule names (§4.1), never from the run time.

A push to `main` runs deploy-only mode (`mode=deploy_only`): no search, no processing, just rebuild the site from the new code and the last good state.

---

## 2. Fixed interfaces this part must not change

Part 5 reads and writes exactly the file paths in the build plan's interface table. It adds only:

- `data/state/**` (new, §3),
- `data/state/run_status.json` (new, read by `export_web.py`),
- extra optional keys in `manifest.json` (§6.3). v1 keys stay.

`granules.csv` columns stay `source, stack_id, season, ref_date, sec_date, path, frame, flight_dir, id, url`. Per-run extras (selected duplicate, size, status) go in `state.json`, not in the CSV.

---

## 3. State (B)

### 3.1 What persists and where

Choice: **orphan branch `pipeline-state`**, plus a GitHub Release asset as the backup of record.

| Option | Verdict |
|---|---|
| `main` | Rejected. Automated commits risk breaking the demo, pollute history, and (with a personal token) could retrigger the workflow |
| Actions cache | Rejected as primary. Evicted after 7 days idle and not guaranteed; fine only for pip/npm caches |
| Release assets | Used for the **backup** (a tarball of `pipeline-state`, made after each manual model refresh and monthly). Not used for per-run state because it is awkward to diff and update |
| **Orphan branch** | **Chosen.** Versioned, diffable, free, readable with a plain `git clone`, and the files are small |

Size check: the shared grid covers about 31 × 17 km at 80 m, so a raster is a few hundred pixels per side and well under 1 MB compressed. Even with a few hundred files the branch stays far below GitHub's limits. **[confirm once real grid size is known from `config.yaml`; if any single file exceeds 50 MB, move it to release assets]**

Layout of `pipeline-state`:

```
state.json                      # §3.3, the only file the planner trusts
run_status.json                 # last run's outcome per step
flags.json                      # demo flag, per-layer provenance overrides (hand-edited)
motion/nisar_t159/pairs/<ref>_<sec>.tif      # cropped per-pair vertical cm on the shared grid + coh band
motion/s1_p137/<season>/...                  # Sentinel-1 history stacks (system of record, cannot be rebuilt cheaply)
model/                          # behaviour params, E.tif, E_slope.tif, late_season.tif, params.json, ground_pred.tif, ...
shoreline/                      # transects.geojson, shorelines.geojson
climate/daily_temperature.csv
web/                            # last exported frontend/public/data/ (what the site was built from)
```

Raw files (`data/raw/**`) are never committed. `.gitignore` already should cover `data/raw/` **[check repo]**.

### 3.2 Rebuilding state from a fresh clone (B2)

Command: `python -m pipeline rebuild --from-catalogue`. In order:

1. Create `data/state/`, `git init` an orphan branch `pipeline-state`.
2. **Temperature:** re-fetch daily temperature from the ECCC stations (Part 1 request) from 2017-01-01 to today. Cheap and fully reproducible.
3. **NISAR 2026:** search all GUNW pairs for track 159 / frame 53, apply the pair rules in §4.1, and re-fetch, crop and store each (about 8 pairs; each is downloaded and deleted, so disk is fine). Costs time (tens of minutes), not credits.
4. **Static layers and models:** not reproducible by the workflow. Copy from the latest release backup (`gh release download state-backup-latest`). If none exists, the site falls back to the committed demo data and `update_status` becomes `demo_data`.
5. **Sentinel-1 history:** cannot be rebuilt without resubmitting jobs (about 1,500–2,250 credits, products expire in 14 days). It comes from the release backup. This is why the backup matters.
6. Write `state.json` marking everything restored as `processed`.

Acceptance test for the rebuild: delete `data/state/`, run `rebuild`, then a normal run. The normal run must report "nothing new" and publish identical `web/` files except `generated_at`.

### 3.3 `state.json` schema (B1)

```json
{
  "schema_version": 1,
  "updated_at": "2026-11-15T14:52:10Z",
  "pipeline_version": "git-sha",
  "nisar_t159": {
    "season": 2026,
    "pairs": {
      "20260625_20260707": {
        "ref_date": "2026-06-25", "sec_date": "2026-07-07", "span_days": 12,
        "status": "processed",
        "granule_id": "<asf id>", "alternatives": ["<asf id>"],
        "selected_by": "latest_processing_date",
        "bytes": 612000000,
        "attempts": 1,
        "coherence_mean": 0.41, "valid_share": 0.63,
        "processed_at": "2026-11-15T14:50:03Z"
      }
    },
    "latest_pass_date": "2026-10-11"
  },
  "s1_p137": { "pending_hyp3": [], "processed_pairs": {}, "credits_snapshot": null },
  "last_search": { "at": "2026-11-15T14:47:30Z", "ok": true, "n_found": 10 },
  "last_success_at": "2026-11-15T14:52:10Z"
}
```

Pair status values: `discovered | fetching | processed | excluded | failed`. `excluded` carries `reason` ∈ `outside_window | cold | low_coherence_or_snow | too_large | unwrapping_failed`. `failed` carries `attempts`, `last_error`; retried up to 3 runs, then left `failed` and reported.

### 3.4 Making a run safe to repeat (B3)

- **Idempotent keys.** A NISAR pair is keyed by `<ref_date>_<sec_date>` (acquisition dates). Re-running a processed pair is a no-op unless `--force-reprocess <key>`.
- **Write last, atomically.** Every step writes to a temp directory and renames. `state.json` is updated only after outputs are validated, then pushed in one commit. A crash mid-run leaves the previous `state.json`, so the next run redoes the work.
- **No overlapping runs.** `concurrency: { group: ground-check, cancel-in-progress: false }`. A queued run waits rather than racing on the state branch.
- **Push retry.** `git pull --rebase` then push, up to 3 times. The only writer is this workflow (plus the manual laptop script, §8), and the concurrency group serialises the workflow.
- **Dry run.** `dry_run=true` does everything except steps 9 and the deploy, and prints what it would have done.

---

## 4. Per source (C)

### 4.1 NISAR (C1)

**Detect new pairs.**

- Search: `asf_search` with `dataset=["NISAR"]`, `processingLevel="GUNW"`, `intersectsWith=<WKT polygon of aoi.bbox>`, `start` = `latest_pass_date` minus 30 days (overlap catches late-published or reprocessed products), `end` = now. The dataset and level names follow the ASF NISAR cookbook (which shows `GCOV`, and says GUNW is the same field with a different four-letter code). **[confirm the exact `productionConfiguration` filter and that `GUNW` works as `processingLevel`]**
- Keep only track 159, frame 53, descending, HH. The exact property names for track/frame are not confirmed, so parse them from the granule name as a fallback and verify HH by the HDF5 path existing after download. **[confirm against one real result]**
- **Dates:** take the reference and secondary acquisition dates from the granule name or the product's own metadata (two `YYYYMMDDTHHMMSS` fields), converted to UTC dates. **Never use the run date.** A pair from 11 Oct that appears on 14 Oct is keyed `..._20261011`.

**Pick one version of duplicates.** Group candidates by `(ref_date, sec_date)`. Choose, in order:
1. production configuration over beta or test, if the field distinguishes them;
2. latest processing date;
3. highest composite release identifier string (the cookbook shows duplicate granules differing in two numeric fields that look like release/processing identifiers);
4. lexicographically greatest granule id.

Record the chosen id and the alternatives in `state.json` (`selected_by` says which rule decided). A newer duplicate that appears later for an already processed pair is logged but does **not** replace it, unless `--force-reprocess`. This prevents silent changes between runs.

**A missed pass.** If a pass is missing, the next pair spans 24 days (as 19 Jul → 12 Aug 2026 did). Accept it: record `span_days: 24`, process it, and rely on Part 2's unwrapping-risk handling. Do not report it as a failure.

**Fetch within disk limits.**

1. Learn the size first. File sizes are not in the catalogue results (per the plan). Use an authenticated `HEAD` (or a `Range: bytes=0-0` request if `HEAD` is refused) against the download URL and read `Content-Length` (or the total from `Content-Range`). **[confirm this works through the Earthdata redirect]**
2. Limits: skip a pair as `too_large` if it is over 4 GB. Require free disk of at least 2.5 × size before downloading (`shutil.disk_usage`). The runner has about 14 GB free.
3. Process **one pair at a time**: download → crop to `aoi.bbox` with Part 2's reader → write the per-pair product to `state/motion/nisar_t159/pairs/` → delete the raw `.h5` → next pair. Peak disk is one raw file.
4. Cap per run: `max_pairs` (default 4; the first demo run uses 8). The backlog clears over the next runs.
5. Download with `asf_search.download_urls(..., processes=1)`; one process keeps memory and rate-limit risk low.

**Remote HDF5 versus download-crop-delete (C1 comparison).**

| | Download, crop, delete | Read area from remote HDF5 over HTTPS |
|---|---|---|
| Disk | One raw file at a time (hundreds of MB) | Almost none |
| Time | One sequential transfer per pair | Fewer bytes if chunking suits the area; many small range requests |
| Auth | Simple, same session as search | Earthdata redirects must be handled by the HTTP layer; more to go wrong in CI |
| Evidence | ASF's cookbook downloads first, then reads locally | ASF's access page says GDAL `vsicurl` can subset HDF5 without downloading all of it, using `.netrc`; the cookbook also points to benchmarks for roughly 8 MB chunks. Nothing confirms it for GUNW |
| Determinism | High | Medium (network failures mid-read) |

**Decision:** default `nisar.fetch_mode: download`. Run one timed trial of `remote` on a laptop this weekend (stretch) and record time and bytes in this doc. Switch the default only if remote reading is clearly faster and succeeds on all eight pairs. The switch is a config key; `fetch.py` has one function per mode with the same signature.

### 4.2 Sentinel-1 via HyP3 (C2), Stretch tier

Disabled unless the repository variable `ENABLE_HYP3=true`. The NISAR 2026 loop must work without it.

**Two phases across two runs** (products are built on ASF's side, minutes to hours later, and expire after 14 days):

- **Phase A, submit (run N).** For each new Sentinel-1 date on path 137 frame 223 in an open season, build pairs by the Part 1 pair rule (each date with the next and the one after, within the season), skip any pair already in `processed_pairs` or `pending_hyp3`, and submit. Job name is deterministic: `tuk-s1p137-<ref>-<sec>`; project `devotion-tuk`. Record the job ids in `state.pending_hyp3`.
- **Phase B, collect (run N+1 and later, every run).** List jobs under the project, match by name, and for each `SUCCEEDED` job not yet collected: download, crop, store the pair, mark `processed`, delete the raw. For `FAILED`: record the error; resubmit once if the error looks transient (infrastructure), otherwise mark `failed`. For `RUNNING`/`PENDING` older than 12 days: warn (the product will expire at 14 days). **Download as soon as a job finishes.**

**Credit budgeting.**

- Cost: 10 credits per job at 80 m, 15 at 40 m; allowance 8,000 per user per month. Use 80 m for the automation (cheaper; the radar is 40–80 m anyway).
- Before submitting, read remaining credits (`hyp3.check_credits_remaining()`). Submit only if `remaining − cost × n ≥ reserve` (default reserve 500). Per-run cap: `max_hyp3_jobs_per_run` default 10.
- Never resubmit: state check **and** a catalogue check by job name before every submit. A run with `ENABLE_HYP3=false` submits nothing.

**Failed jobs** are listed in `run_status.json` and the run summary, never silently retried more than once.

### 4.3 Temperature (C3)

Daily at the start of each run (step 1), regardless of the gate, because the gate needs it:

1. Read the last date in `climate/daily_temperature.csv`.
2. Request station data from `last_date − 7 days` to today (re-fetching the last week picks up revised values), using the Part 1 request and the two merged stations (26987 and 53582). **[request details and field names belong to Part 1; confirm there]**
3. Upsert by `date`; keep `filled` meaning "gap filled".
4. In CI, do **not** call ERA5-Land (it needs a Copernicus account and a suspended-on-parallel-requests API). Short gaps (up to 3 days) are linearly interpolated and marked `filled=true`. Longer gaps stay empty, and any season statistic that needs them is flagged `temperature_gap` rather than guessed.
5. Recompute thawing degree-days from the season start with the Part 3 definition and write `expected.json` inputs. The "moving more than expected" flag in step 6 uses the stored sensitivity map `E.tif` and this season's temperature to date; **no model is retrained**.

### 4.4 Slow layers: elevation, roads, shorelines, features (C4)

Refreshed **by hand**, not by the schedule.

1. On a laptop: `python -m pipeline refresh_static --layer elevation|context|shorelines|features`.
2. Check the outputs against the shared grid.
3. `scripts/push_state.sh` copies changed files into a clone of `pipeline-state`, commits with a message naming the layer and source date, and pushes.
4. After the next model refresh, make a release backup (`state-backup-YYYYMMDD`, and move `state-backup-latest`).

Calendar: after each thaw season ends (mid-October), after any new shoreline imagery, and when new cores are logged. The ground prediction and shoreline model are re-run the same way, a few times a year. The workflow offers `mode=refit_models` for convenience, but it is only ever started by hand.

---

## 5. Credentials (D, E3)

**Names.** The README uses `EARTHDATA_USER` and `EARTHDATA_PASS` **[check repo]**. Keep those names (renaming risks breaking local runs). Do not assume the libraries read them:

- `asf_search`'s session documentation lists username/password, token and cookie-jar authentication and does not mention reading environment variables or `.netrc`.
- `hyp3_sdk`'s authentication documentation lists `.netrc`, username/password, or an Earthdata token, and does not mention environment variables.

So the pipeline reads the two variables itself in one helper, `data-pipeline/src/auth.py`:

```python
def asf_session():   # asf_search.ASFSession().auth_with_creds(USER, PASS)
def hyp3():          # hyp3_sdk.HyP3(username=USER, password=PASS)
```

Every module calls these helpers instead of its own login code. The workflow also writes `~/.netrc` (mode 600) for `urs.earthdata.nasa.gov` from the same secrets, so GDAL and `curl` based reads work the same on a laptop and in Actions.

**Setup for a new Earthdata account** needs two things beyond creating it: accept the data-use terms, and approve the "Alaska Satellite Facility Data Access" application under the account's authorised apps. Without this, downloads redirect to a login page.

**Which steps see the secrets:** only `search` (if it logs in), `fetch` and `hyp3` calls. The secrets are job-level environment variables of the `update` job only; the `deploy` job has none.

**Fork safety.**

- Secrets are stored in a repository **environment** named `ground-check`, restricted to the `main` branch.
- The workflow has no `pull_request` or `pull_request_target` triggers, so a fork's pull request can never run it with secrets.
- Scheduled workflows do not run in forks unless the fork owner enables them, and forks do not receive the parent's secrets.
- The `update` job is guarded: `if: github.repository == '<owner>/<repo>'`.
- Verification test (checklist item 10): fork the repo from a second account, open a pull request that edits the workflow, and confirm the run has no access to `EARTHDATA_USER`.
- Never `echo` secrets; GitHub masks them but not derived strings, so avoid printing the netrc line.

---

## 6. Publishing (D)

### 6.1 Where exported files go (D1)

**Build and deploy without committing to `main`.**

- Step 7 writes to a staging directory, step 9 copies the validated files into `pipeline-state/web/`.
- The `deploy` job checks out `main` (code, including the committed **demo data** in `frontend/public/data/`) and `pipeline-state` (data). If `pipeline-state/web/` is present and its `manifest.json` validates, it overwrites `frontend/public/data/` with it before `npm run build`. If not, the committed demo data are used.
- Result: **`main` always builds and demos** (it contains demo data and never receives automated commits). A bad export can never break `main`.
- **An automated commit cannot retrigger the workflow.** State pushes go to `pipeline-state`, and the `push` trigger only watches `main`. Commits pushed with the default `GITHUB_TOKEN` also never trigger new workflow runs. Do not replace the token with a personal token. As a belt-and-braces measure, state commits include `[skip ci]`.

### 6.2 Validation gate (E2)

`python -m pipeline validate <staging-dir>` runs before step 9. A failure means nothing is published; the last good `web/` stays.

Checks (all must pass):

1. **Files and keys.** `manifest.json`, `areas.geojson`, `timeseries.json`, `validation.json`, `coastline.geojson`, and `rasters/` exist; each JSON parses; required keys per `06-interactive-product.md` are present; `schema_version` is 2; v1 keys still present.
2. **Rasters not empty.** Each raster opens; valid (non-NaN) share ≥ 5% (configurable) for measured layers; dimensions match the shared grid.
3. **Physical range.** Cumulative vertical motion within −40 to +20 cm per season (values beyond ±60 cm are an error, in between a warning); coherence in [0, 1]; confidence in [0, 1]; behaviour classes in {stable, seasonal, degrading, can't measure}; tiers in {lower, moderate, higher, not enough data}; shoreline arrival years between the current year and 2200 as ranges with start ≤ end.
4. **Provenance.** Every layer has one of `measured | predicted | demo`; a predicted layer carries a confidence field; the demo flag is true if any layer is `demo`.
5. **Size budget.** `rasters/` plus JSON stays within the first-load budget from Part 6 (under 2 MB for the first load; fail above, say 5 MB total, to leave Part 6 room to lazy-load).
6. **Change guard (Stretch).** If more than 30% of pixels with valid data in both the old and new behaviour maps changed class, status is `held_for_review` (exit 81): nothing is deployed from this run, and the run opens a GitHub issue. A manual dispatch with `approve_held=true` publishes it. This implements "without flipping on one noisy date" at the publishing layer; the tier-level rule itself belongs to Part 4.

### 6.3 Deployment configuration (D2) and freshness (D3)

**GitHub Pages via Actions** (chosen over Vercel: no extra account, no extra secret, same repository). Vite already uses `base: "./"`, so the site works under `https://<owner>.github.io/<repo>/` **[check repo `frontend/vite.config.js`]**.

```yaml
name: update
on: { schedule: [{cron: "47 14 * * *"}], workflow_dispatch: {...}, push: {...} }
permissions: { contents: read }
concurrency: { group: ground-check, cancel-in-progress: false }

jobs:
  update:
    if: github.repository == '<owner>/<repo>' && github.event_name != 'push'
    runs-on: ubuntu-latest
    timeout-minutes: 90
    environment: ground-check
    permissions: { contents: write }          # only to push pipeline-state
    env:
      EARTHDATA_USER: ${{ secrets.EARTHDATA_USER }}
      EARTHDATA_PASS: ${{ secrets.EARTHDATA_PASS }}
      ENABLE_HYP3: ${{ vars.ENABLE_HYP3 }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with: { ref: pipeline-state, path: data/state }
      - uses: actions/setup-python@v5
        with: { python-version: "3.11", cache: pip }
      - run: pip install -r data-pipeline/requirements.txt
      - name: netrc
        run: |
          umask 077
          printf 'machine urs.earthdata.nasa.gov login %s password %s\n' "$EARTHDATA_USER" "$EARTHDATA_PASS" > ~/.netrc
      - run: python -m pipeline run --mode "${{ inputs.mode || 'full' }}" ...
      # the run command handles steps 0-9, always writes run_status.json,
      # and exits non-zero on failure so GitHub emails the owner
      - name: keepalive
        if: always()
        run: python -m pipeline keepalive   # §9

  deploy:
    needs: update
    if: always() && needs.update.result != 'cancelled'
    runs-on: ubuntu-latest
    permissions: { contents: read, pages: write, id-token: write }
    environment: { name: github-pages, url: ${{ steps.dep.outputs.page_url }} }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with: { ref: pipeline-state, path: data/state }
      - run: python data-pipeline/src/stage_web.py   # copies data/state/web into frontend/public/data if valid
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: frontend/package-lock.json }
      - run: npm ci && npm run build
        working-directory: frontend
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: frontend/dist }
      - id: dep
        uses: actions/deploy-pages@v4
```

Notes: the action major versions are those I know to be current; confirm the latest majors when writing the file. The `deploy` job runs even when `update` failed (`if: always()`), so the site is always redeployed from the last good state. Deploying daily also refreshes `last_checked_at`. The `deploy` job has no Earthdata secrets.

**Freshness shown on the site: `manifest.json` fields (D3).** Only `export_web.py` writes this file; it builds the whole object each time from the data present plus `state/run_status.json` and `state/flags.json`. No other step may edit it (this fixes the "export rewrites manifest and drops fields" trap).

| Field | Type / values | Meaning |
|---|---|---|
| `schema_version` | `2` | v1 keys retained |
| `generated_at` | UTC ISO time | When this export was built |
| `last_checked_at` | UTC ISO time | When the catalogue was last searched |
| `last_success_at` | UTC ISO time | When a run last published successfully |
| `latest_pass` | `{ date, sensor, track, frame, ref_date, product_id, span_days }` | Newest processed radar pass; `date` is the secondary acquisition date in UTC; sensor e.g. "NISAR L-band" |
| `next_expected_pass` | date or null | `latest_pass.date` + 12 days in season, else null |
| `update_cadence_days` | `12` | |
| `update_status` | enum in §1.3 | |
| `update_message` | string | Plain-language line the UI shows, built per §1.3 |
| `last_failure` | `{ at, step, message } \| null` | Last failed step, if any |
| `season` | `{ year, state: "open"\|"closed", window: ["06-01","10-15"], passes_processed, passes_excluded: [{date, reason}] }` | |
| `years` | list | Sentinel-1 2018–2025, NISAR 2026 once processed (v1 key) |
| `layers` | `{ <name>: { provenance: "measured"\|"predicted"\|"demo", status: "ok"\|"pending"\|"missing", reason, source, updated_at, confidence } }` | Part 6 states: "pending" with the reason if the ground prediction failed its test |
| `provenance` | summary | v1 key |
| `demo` | boolean | True while any layer is `demo`; keeps the banner on |
| `pipeline_version` | git sha | |
| `run_url` | URL | The Actions run that built it |

**Staleness backstop.** If GitHub disables the schedule or the workflow dies, nothing writes `failed`. So the UI also computes staleness client-side: in season, if `now − generated_at > 3 days` show "Update check overdue; showing data from `<generated_at>`". Part 6 must implement this and fall back to the same wording.

Part 6 may rename display strings, but field names above are the contract proposal for Part 6 to accept or amend; **[Part 6 finalises]**.

---

## 7. Manual trigger (workflow_dispatch inputs)

| Input | Type | Default | Use |
|---|---|---|---|
| `mode` | choice | `full` | `full`, `search_only`, `deploy_only`, `refit_models` |
| `max_pairs` | number | 4 | Set 8 for the first demo run |
| `force_season_open` | boolean | false | Ignore the calendar window (never the coherence check). For testing |
| `force_reprocess` | string | "" | Comma-separated pair keys |
| `dry_run` | boolean | false | Skip publish and deploy |
| `approve_held` | boolean | false | Publish a run held for review |

---

## 8. Laptop scripts

| Script | Purpose |
|---|---|
| `scripts/run_local.sh [--mode full]` | Same entry point as Actions, state in a local clone of `pipeline-state` |
| `scripts/push_state.sh "<msg>"` | Commit and push changed state files to `pipeline-state` |
| `scripts/backup_state.sh` | Make the `state-backup-YYYYMMDD` release and update `state-backup-latest` |
| `scripts/seed_state.sh` | One-time: create the orphan branch from the current `data/interim/` outputs and the committed demo data |

---

## 9. Failure and safety (E)

### 9.1 Failure table (E1, E4)

Rule for every row: **the last good data stay published, the failure is written to `run_status.json`, and the site's status line says so.**

| Step | Failure | Detection | Result |
|---|---|---|---|
| 0 restore | State branch missing or corrupt | `git clone` fails or `state.json` does not parse | Run `rebuild`; if that fails, status `failed_showing_last_good`, deploy from the committed demo data and set `demo` true |
| 1 gate | Temperature API down | HTTP error after 3 retries (10 s, 30 s, 90 s) | Continue using the last temperatures; gate uses the calendar only; `temp_missing` noted |
| 2 search | Catalogue timeout or error | Exception after 3 retries | Exit 30; status `failed_showing_last_good`; nothing else runs; deploy the last good state |
| 2 search | Search returns zero results unexpectedly (below the count already in state) | `n_found < processed count` | Treat as a failed search, not as "up to date" (guards against a silent empty response) |
| 3 plan | Ambiguous duplicates | Selection rule hits the tie-break | Pick by the lexicographic rule, log a warning |
| 4 fetch | Auth redirect to login page | Response is HTML or the file does not start with the HDF5 signature | Mark the pair `failed` (attempt +1); stop fetching this run (the same cause hits all pairs); status `failed_showing_last_good` |
| 4 fetch | Download interrupted | Size mismatch against `Content-Length` | Delete the partial file, retry once, then `failed` |
| 4 fetch | Disk too low or file over 4 GB | Pre-check | Pair `excluded: too_large` (or fail early), continue with other pairs |
| 4 fetch | Raw HDF5 unreadable or the Part 2 reader raises | Exception | Pair `failed`; others continue |
| 4 crop/process | Coherence too low (snow, wet tundra) | Below Part 2 thresholds | Pair `excluded: low_coherence_or_snow` (not an error; reported in `season.passes_excluded`) |
| 4 hyp3 | Job failed or credits low | Job status; credit check | Record, skip submission; a credits-low message appears in the run summary |
| 4 hyp3 | Job not collected within 12 days | Age of `pending_hyp3` entry | Warn loudly in the summary (product expires at 14 days) |
| 5 process | Inversion fails | Exception, or NaN-only output | Exit 50; keep the previous season stack; status `failed_showing_last_good` |
| 6 apply | Stored model files missing (`E.tif`, thresholds) | File check | Skip the "moving more than expected" flag; keep the previous classes; `layers.<name>.status = "pending"` with reason |
| 7 export | Exporter raises | Exception | Exit 70; nothing published |
| 8 validate | Gate fails | §6.2 | Exit 80; nothing published; status `failed_showing_last_good` |
| 8 validate | Large change | §6.2 item 6 | Exit 81; `held_for_review`; issue opened |
| 9 publish state | Push rejected | `git push` fails after 3 rebase retries | Exit 90; the next run redoes the work (idempotent). The site still deploys the previous state |
| Deploy | Pages deploy fails | `deploy-pages` step | The job fails visibly; the previous deployment stays live (Pages keeps the last successful one) |
| Workflow itself | Schedule disabled by GitHub | No runs in the Actions list | The UI's client-side staleness message (§6.3); keepalive step reduces the chance (§9.3) |
| Whole run | Exceeds 90 minutes | `timeout-minutes` | Run cancelled; `state.json` only changes at step 9 so nothing is half-applied |

Failed jobs mean GitHub emails the person who last changed the workflow. Add the owner to "Actions" notifications **[checklist item]**.

### 9.2 Limits and a guard against resubmitting HyP3 every run (E4)

- Runner: about 14 GB disk and a 6-hour limit; the workflow sets 90 minutes and processes one raw file at a time.
- `max_pairs` (default 4) and `max_hyp3_jobs_per_run` (default 10).
- HyP3: deterministic job names, state check, catalogue check, credit reserve (§4.2). `ENABLE_HYP3` defaults to off.
- ASF downloads: one process; no parallel requests (the Copernicus service suspends accounts that send parallel requests, and sequential is the safe habit for NASA services too).

### 9.3 Scheduled workflows are paused after inactivity

GitHub disables scheduled workflows in a public repository after 60 days without repository activity, and a delayed or skipped scheduled run is possible. Two defences:

1. The `keepalive` step re-enables the workflow through the API (`gh api -X PUT repos/{repo}/actions/workflows/update.yml/enable`) at the end of each run. **[confirm this works for a workflow that GitHub disabled for inactivity; if not, a monthly human commit is the fallback]**
2. Whether commits made by the workflow on the state branch count as "activity" is not something I could confirm. Do not rely on them.

---

## 10. Sunday demo plan and fallback (F)

### 10.1 The smallest honest version (F1)

A hand-triggered run (`workflow_dispatch`, `mode=full`, `max_pairs=8`, `dry_run=false`) whose log shows, in this order:

```
[gate]    season window 06-01..10-15 (forced open for demo: no / yes)
[search]  NISAR GUNW track 159 frame 53: found 10 products, 9 unique pairs
[plan]    8 pairs inside thaw window (2 after 15 Oct excluded: outside_window)
[fetch]   20260625_20260707  size 612 MB  downloaded 38 s  cropped  raw deleted
[process] coherence mean 0.41 valid 63%  stored
...
[export]  wrote 9 files, 1.4 MB
[validate] 18 checks passed
[state]   pushed pipeline-state abc1234
[deploy]  https://<owner>.github.io/<repo>/  manifest: latest_pass 2026-10-11 NISAR
```

It must **process at least one pair** and **publish**. A processed second pair is a bonus.

What must be in place (all of this has to be true before 14:00 Sunday, so a rehearsal run fits before the 17:00 pitch):

1. `update.yml` merged to `main` and visible in the Actions tab.
2. Secrets in the `ground-check` environment; ASF application approved on the Earthdata account.
3. `pipeline-state` branch exists and was seeded (`seed_state.sh`).
4. Pages source set to "GitHub Actions"; the repo is public.
5. `python -m pipeline run` works locally with `--mode search_only` and `--mode full --max-pairs 1`.
6. Part 2's per-pair reader exists and produces one correct pair on a laptop. **If it does not, use the fallback (§10.2).**
7. One successful rehearsal run is finished, with its URL saved, and a screenshot of the log and of the manifest status line saved for the slides.

Suggested order of work from tonight (time-boxed, not a prediction of how long it takes; drop items from the bottom):

| Order | Item | Tier |
|---|---|---|
| 1 | `update.yml` with `search_only` and `deploy_only` working, Pages deploying | Must |
| 2 | `auth.py` helper and a `search` step that prints the pair table | Must |
| 3 | `fetch` + `process` for one pair, state file, `publish_state` | Should |
| 4 | Freshness fields in the manifest and the UI line | Should |
| 5 | All eight pairs, validation gate, failure status on the site | Stretch |
| 6 | HyP3 two-phase, `held_for_review`, remote-read benchmark | Stretch |

### 10.2 Fallback if NISAR processing cannot run in Actions (F2)

If the download, the HDF5 reader, or the 14 GB disk is a problem, the workflow does only `search`, `plan`, report, and `deploy`; processing runs on a laptop with `scripts/run_local.sh`, which then pushes to `pipeline-state` via `push_state.sh`. The next Actions run (or a manual `deploy_only`) publishes it.

Describe it truthfully. Suggested wording for the pitch and the About box:

> "A scheduled workflow checks NASA's catalogue every day, detects new NISAR passes, and republishes the site. In this demo build the radar processing step ran on our laptop and was published through the same pipeline. Moving that step into the workflow is the next step."

Do **not** say: "fully automatic", "updates itself end to end", or "runs with no human involvement" for the fallback build. The honest claim for either build remains: **updates every 12 days during the thaw season, June to September**; in winter it runs, finds nothing usable, and says so.

---

## 11. Setup checklist for the repo owner (needs repo admin)

1. Make the repository **public** (the plan already says the code is open; GitHub Pages on private repos depends on the plan **[confirm]**).
2. Create an Earthdata Login account; accept the terms and approve the "Alaska Satellite Facility Data Access" application under authorised apps.
3. Create the environment `ground-check` (Settings → Environments); restrict deployment to `main`; add secrets `EARTHDATA_USER` and `EARTHDATA_PASS`.
4. Repository variable `ENABLE_HYP3` = `false` (change to `true` only after the NISAR loop works).
5. Settings → Actions → General: allow actions; set "Workflow permissions" to read-only by default (the workflow asks for more where needed).
6. Settings → Pages: Source = **GitHub Actions**.
7. Create the `pipeline-state` branch (`scripts/seed_state.sh`). Do **not** add branch protection that blocks the workflow's push.
8. Settings → Branches: protect `main` if desired; the workflow never pushes there.
9. Notifications: turn on email for failed Actions runs for the owner.
10. Fork-safety test: from a second account, fork, open a PR that edits the workflow and prints the secret name; confirm it is empty and the update job does not run.
11. Run `workflow_dispatch` with `dry_run=true`, then once for real; open the Pages URL.
12. Optional: add a calendar reminder for the monthly release backup and the post-season model refresh.

---

## 12. Not confirmed

- **Existing code.** I did not read `README.md`, `data-pipeline/src/*.py` or `frontend/vite.config.js`. The plan says the README uses `EARTHDATA_USER` / `EARTHDATA_PASS` and that `export_web.py` rewrites `manifest.json` from scratch; I have taken those as given. Check what `asf_search` and `hyp3_sdk` calls in `search.py`, `hyp3_submit.py` and `download_nisar.py` actually pass.
- **Library authentication.** Documentation I checked lists username/password, token and (for `hyp3_sdk`) `.netrc` as the supported methods, with no environment variables. I did not test any of them against NISAR downloads.
- **NISAR GUNW metadata.** I could not confirm the granule-id format, the property names for track and frame, whether `bytes` is populated, or which field distinguishes duplicate versions. The ASF cookbook's examples are for GCOV; I adapted the GUNW steps.
- **Remote HDF5 reading.** ASF says GDAL `vsicurl` can subset HDF5 and points to benchmarks; ASF's own examples download first. Not tested on GUNW. File sizes are assumed to be hundreds of MB.
- **Earthdata redirect handling** for `HEAD`/range requests.
- **60-day rule.** Whether workflow-generated commits count as activity, and whether the `enable` API call revives a workflow GitHub disabled.
- **GitHub Pages on private repositories** and the **latest major versions** of the Actions used.
- **ECCC request and field names** (owned by Part 1) and **the exact function names** of Parts 2, 3 and 4 that the steps call.
- **HyP3 SDK calls** (`find_jobs` by name, `check_credits_remaining`, job fields). I believe they exist; I did not verify them.
- **Grid size** (from `config.yaml`); the state-size estimate depends on it.
- **First-load size** limit comes from Part 6; the validation gate uses its number once Part 6 fixes it.

## References used

- HyP3 authentication: https://hyp3-docs.asf.alaska.edu/using/authentication/
- `asf_search` session: https://docs.asf.alaska.edu/asf_search/ASFSession/
- NISAR data access cookbook: https://asfopensarlab.github.io/NISAR_Cookbook/notebooks/nisar-data-access
- NISAR data access overview: https://nisar-docs.asf.alaska.edu/access-overview
