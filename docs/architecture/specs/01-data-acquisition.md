# Part 1 — Data sources and acquisition (spec + implementation notes)

Owner: Agal · Branch `part1/data` · Status: scripts written; checked against live catalogues 14 Nov 2026.
All scripts live in `data-pipeline/src/` and read `data-pipeline/config.yaml`. Run from `data-pipeline/`.

## Run order

| # | Command | Login | Output | Time |
|---|---|---|---|---|
| 1 | `python src/search.py` | none | `data/interim/scenes.csv`, `granules.csv` | <1 min |
| 2 | `python src/hyp3_submit.py --seasons 2021-2025 --submit` then `--seasons 2018-2020 --submit` | Earthdata | HyP3 jobs (project `devotion-tuk`) | submit <1 min; jobs ~hours |
| 2b | `python src/hyp3_submit.py --status` / `--download` | Earthdata | `data/raw/s1/<job_id>/` | ~10 min per 50 jobs |
| 3 | `python src/fetch_nisar.py` | Earthdata | `data/raw/nisar/<granule>.h5` (AOI crop) | ~1 min/pair |
| 4 | `python src/fetch_climate.py` | none | `data/interim/climate/daily_temperature.csv` | <1 min |
| 5 | `python src/fetch_terrain.py` | none | `data/interim/context/elevation_m.tif`, `data/interim/features/*.tif` | 2–5 min |
| 6 | `python src/fetch_context.py` | none | `data/interim/context/{highway,water,coast,services}.geojson` | <1 min |
| 7 | `python src/fetch_shorelines.py` | none | `data/interim/shoreline/shorelines.geojson` + previews | 5–10 min |

## Summary table

| Dataset | Endpoint | Auth | Output | Size | Licence / credit |
|---|---|---|---|---|---|
| Sentinel-1 IW SLC catalogue | ASF Search API (`asf_search`) | none | `scenes.csv`, `granules.csv` | KB | Copernicus: "Contains modified Copernicus Sentinel data" |
| Sentinel-1 interferograms | ASF HyP3 `INSAR_GAMMA`, 20x4 looks (80 m) | Earthdata (netrc) | `data/raw/s1/<job>/` | ~100–200 MB/job zipped | as above + ASF HyP3 |
| NISAR L2 GUNW (provisional) | `nisar.asf.earthdatacloud.nasa.gov` via `earthaccess` (HTTPS range reads) | Earthdata | `data/raw/nisar/*.h5` (crop) | ~2–10 MB/pair (full file ~2.5 GB) | NASA open data; credit NASA/ASF |
| Daily temperature | `api.weather.gc.ca/collections/climate-daily` | none | `daily_temperature.csv` | ~0.5 MB | ECCC (Open Government Licence – Canada) |
| Elevation | NRCan STAC `datacube.services.geo.ca/stac/api` → HRDEM COGs on `canelevation-dem.s3.ca-central-1.amazonaws.com` | none | `elevation_m.tif` | ~2 MB | OGL-Canada (NRCan) |
| Surface water | JRC GSW v1.4 occurrence tile `140W_70N` | none | `water_occurrence.tif`, `distance_to_*.tif` | ~2 MB | Unrestricted; cite Pekel et al. 2016 |
| Summer NDVI | Planetary Computer STAC, `sentinel-2-l2a` | none | `ndvi_summer.tif` | ~2 MB | Copernicus attribution |
| Roads, water, coast, services | Overpass API (3 mirrors) | none | `context/*.geojson` | KB | ODbL — "© OpenStreetMap contributors" |
| Air-photo mosaics 1947–2004 | NRCan STAC collection `napl-tuktoyaktuk` (14 dates) | none | `data/raw/shoreline/airphotos/*.tif` | ~5 MB each (crop, 5 m) | OGL-Canada (NRCan NAPL) |
| Landsat 1985–2016 / Sentinel-2 2017–2025 | Planetary Computer `landsat-c2-l2`, `sentinel-2-l2a` | none | shorelines | KB | USGS open / Copernicus |

## Area of interest

`[-133.30, 69.20, -132.85, 69.48]` (~31 km N–S × 17 km E–W): town, the Point, Tuk Island, Reindeer Point and the
first ~25 km of the Inuvik–Tuktoyaktuk Highway. `fetch_context.py` reports whether highway segments fall inside.
`aoi.must_cover = [-133.03, 69.443]` (town core): every Sentinel-1 scene must contain it (see Frames below).
Shared grid: EPSG:4326, 0.0005° → 560 × 900 pixels, ~20 m E–W × ~55 m N–S.

## A. Radar scene selection

**Sentinel-1 `s1_p137`** — `platform=S1, processingLevel=SLC, beamMode=IW, relativeOrbit=137, flightDirection=ASCENDING,
intersects AOI`, window 25 May–5 Oct each summer 2018–2025.

**Frames — correction to the plan.** Do **not** filter on `frame=223`. ASF frame numbers drift between years on path 137:
2018–21 mostly 227 (223 returns nothing), 2022–24 223 + 228, 2025 mixed, 2026 225 (verified 14 Nov 2026).
Frames 223 and 228 overlap at Tuk, and **223's northern edge passes just south of the town**. Rule: one scene per
acquisition date; it must contain the town core; among those, the one covering most of the AOI.
Consequence: 2022–2025 use frame 228, which covers the AOI north of ~69.29°N only (town, Point, Reindeer Point and
the northern half of the corridor). 2018–2021 cover the whole AOI. Covering everything in 2022–25 would need HyP3
burst jobs (stretch).

**Pair rule** (within a season only, never across winter): each date with the next (n+1, kept up to 60 days so the
network stays connected across gaps) and the one after (n+2, only if ≤36 days). 2026 Sentinel-1A→1D handover:
cross-satellite pairs are kept (same orbit geometry); Part 2 checks their coherence.

| Summer | Dates | Pairs | Notes |
|---|---|---|---|
| 2018 | 11 | 18 | 2 Jul dropped (no scene covers the town) |
| 2019 | 9 | 15 | |
| 2020 | 11 | 19 | |
| 2021 | 11 | 19 | |
| 2022 | 11 | 19 | frame 228, AOI ≥69.29°N |
| 2023 | 12 | 21 | frame 228 |
| 2024 | 10 | 17 | frame 228 |
| 2025 | 12 | 21 | mixed frames |
| **Total** | **87** | **149** | **1,490 credits at 80 m** (2021–25: 97 pairs, 970 credits) |

**Resolution:** 80 m (`20x4`, 10 credits). Matches NISAR GUNW's 80 m posting, fits the 8,000/month quota with room for
re-runs; 40 m would cost 2,235 credits with little gain at block scale.

**Job type:** standard `INSAR_GAMMA` (scene pairs). Burst-based jobs would give exact AOI coverage but need burst IDs
and more jobs; not worth it this weekend.

**Job options:** `include_inc_map, include_look_vectors, include_dem, include_displacement_maps` = True (unwrapped
phase and coherence are always included); `apply_water_mask=False` (Part 2 masks water itself; masking before
unwrapping can isolate land patches); `include_wrapped_phase=False`.

**Duplicates:** `hyp3_submit.py` lists existing jobs under project `devotion-tuk` and skips any (reference, secondary)
pair already submitted and not failed. Dry run by default; `--submit` to send; checks credits first.
**Expiry:** products expire 14 days after processing — run `--download` as soon as `--status` shows SUCCEEDED.

**NISAR `nisar_t159`** — `dataset=NISAR, processingLevel=GUNW`, keep granules containing `_159_D_053_`. One version per
(reference, secondary) pair: PR (provisional) over UR (urgent response), then highest `_00N`. Result: **8 pairs,
9 dates, 25 Jun → 11 Oct 2026** (24 Aug→5 Sep uses version 002). Pairs after 11 Oct are excluded (snow).
**Reading without downloading:** confirmed. `fetch_nisar.py` copies only the AOI window of
`grids/frequencyA/unwrappedInterferogram/{HH/unwrappedPhase, HH/coherenceMagnitude, HH/connectedComponents,
HH/ionospherePhaseScreen, mask, x/yCoordinates, projection}` plus `metadata/radarGrid/{incidenceAngle,
losUnitVectorX/Y, heightAboveEllipsoid, x/yCoordinates}` and `identification/`, into a small HDF5 with identical paths.
Unwrapped grid is 5022×5022 at 80 m, EPSG:3413 (confirmed from a real granule). File sizes are not reported by ASF;
reading the crop avoids needing them.

## B. Climate

ECCC stations 2203914 (TUKTOYAKTUK, 1995–) then 2203911 (TUKTOYAKTUK A, 2018–), `climate-daily` items paged 5,000 at a
time. Per day: first station with a value wins; tmean missing → (tmax+tmin)/2 (`filled=calc`); gaps ≤3 days linearly
interpolated (`filled=interp`); longer gaps left empty and counted. Snow on ground and precipitation kept for the
second-driver test. A two-station cross-check (mean and absolute difference) is printed. ERA5-Land fallback: not
implemented (needs a CDS account; sequential requests only) — add only if the gap report shows summer gaps.
CanDCS-M6 (stretch, one context chart): not implemented.

## C. Elevation and context

- **Elevation:** HRDEM DTM, tried `hrdem-mosaic-2m` → `hrdem-arcticdem` → `mrdem-30` until ≥80% AOI cover, gaps filled
  from the next source; bilinear to the shared grid. Vertical datum CGVD2013 (≈ mean sea level) — *unconfirmed for
  the ArcticDEM-derived product; check the item metadata*.
- **Features** (`data/interim/features/`): elevation, slope (°), roughness (3×3 std), wetness index (D8, ln(a/tanβ)),
  water occurrence (JRC), distance to water (occurrence ≥50%), distance to coast (large water bodies touching the AOI
  edge), summer NDVI (median of ≤9 low-cloud July–August Sentinel-2 scenes, 2023–25, SCL-masked, L2A offset handled).
  **Too coarse at block scale:** JRC (30 m) is fine; NDVI fine; a 1 km ground-ice map would be too coarse (not used).
  **Geology class: not delivered** — no machine-readable block-scale surficial map found (Rampton 1:500,000 is too
  coarse and not vectorised). Model B runs without it.
- **Context:** OSM highway (all `highway=*`), water, coastline and services (school, health, stores, airport, etc.).
  ODbL: publish as overlays with attribution. **No GNWT building footprints.**
- **Shorelines** (`fetch_shorelines.py`): definition = **waterline** (only definition visible in every source; Tuk is
  microtidal). Air photos (14 dates 1947–2004) aligned to the 2004 mosaic by phase correlation; position error =
  √(5 m working pixel² + 10 m georeferencing² + (0.2 × shift)²). Landsat 5/8 (1985–2016, error 15 m) and Sentinel-2
  (2017–2025, error 10 m), one clear July–mid-September scene per year, MNDWI + Otsu. **Automatic lines must be
  checked by eye** (previews saved); fixes go in `shorelines_reviewed.geojson`.
- **Shoreline protection works (2023–25):** location *unconfirmed* — needs a public source before Model C flags
  protected stretches.
- **Optional validation:** ArcticDEM strips and Tuk Island probes (PANGAEA 949181) not fetched. NRCan also publishes a
  national InSAR deformation mosaic (STAC `land-deformation-mosaic`) — a possible independent cross-check for Part 4.

## D. Operations

- **Credentials:** Earthdata login in `~/.netrc` (`_netrc` on Windows), written by `earthaccess` on first login; read by
  both `earthaccess` and `hyp3_sdk`. For GitHub Actions use secrets `EARTHDATA_USERNAME` / `EARTHDATA_PASSWORD`
  (earthaccess reads these names); pass them to `HyP3(username=..., password=...)`. Never commit `.netrc`, `.dodsrc`.
- **Earthdata profile:** HyP3 refuses logins until the profile has *Study Area* filled in
  (urs.earthdata.nasa.gov/profile). One-time fix.
- **`granules.csv`:** `source, stack_id, season, ref_date, sec_date, path, frame, flight_dir, id, url` — one row per
  pair. S1: `id = "<ref_scene>|<sec_scene>"`, `frame = "<ref>/<sec>"`, `url` empty. NISAR: `id` = granule, `url` = .h5.
  `scenes.csv` lists the chosen scene per date with its AOI coverage.
- **Folders:** `data/raw/s1/<job_id>/` (unzipped HyP3), `data/raw/nisar/`, `data/raw/shoreline/airphotos/`,
  `data/interim/{climate,context,features,shoreline}/`. All under `data/` are git-ignored.
- **Disk/time by tier:** Must (S1 2021–25 submitted, 1 NISAR pair, temperatures, ≥6 shorelines) ≈ 200 MB, ~20 min of
  runs. Should (+ all NISAR, 2018–20 jobs, terrain, context) ≈ 25 GB once all 149 HyP3 jobs are downloaded.

## Failure handling

| Step | Failure | Detection | Result |
|---|---|---|---|
| search | ASF down / slow | exception | rerun; nothing written |
| hyp3 submit | auth error "Study Area" | AuthenticationError | fix profile, rerun (no jobs sent) |
| hyp3 submit | not enough credits | credit check | stops before submitting; narrow `--seasons` |
| hyp3 download | job expired | `expired()` warning | `--submit --resubmit-expired` |
| fetch_nisar | network drop | per-pair try/except, `.part` file | pair skipped, rerun resumes |
| fetch_climate | API error | 4 retries with backoff | stops; rerun |
| fetch_terrain | DEM source empty | AOI-cover check | falls back to next DEM source |
| fetch_context | Overpass busy | 3 mirrors × 2 tries | stops; rerun later |
| fetch_shorelines | cloudy year / bad threshold | missing year or wrong line in preview | year skipped / fix by hand |

## Unconfirmed

HRDEM-ArcticDEM vertical datum · air-photo georeferencing error (assumed 10 m) · location of 2023–25 shoreline
protection · whether S1A→S1D cross pairs keep coherence (Part 2) · HyP3 processing time today.
