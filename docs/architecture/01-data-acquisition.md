# Brief 1: Data sources and acquisition

> Synced on 14 Nov 2026 from the team's shared Claude doc, "Tuk Ground-Screening Tool: Build Plan". Edit the doc first, then re-sync.

Write only the spec file named below. Do not change code. Read `docs/architecture/00-overview.md` first if you have the repo.

This part specifies every input: where it comes from, how to fetch it, which scenes to pick, and what files to hand to the other parts. Return a spec as one markdown file (`docs/architecture/specs/01-data-acquisition.md`); read `data-pipeline/config.yaml`, `search.py`, `hyp3_submit.py` and `download_nisar.py` first if you have the repo.

**Your job:** for each dataset, give the endpoint, parameters, authentication, selection rules, output file and shape, size, fetch time, licence line, and what to do when it fails.

## Decisions already made

- **Area:** default box `[-133.30, 69.20, -132.85, 69.48]`: the town, Reindeer Point and the first \~25 km of the Inuvik–Tuktoyaktuk Highway. Confirm it contains the highway.
- **Sentinel-1 history:** path 137, frame 223, ascending, IW mode, summers 2018–2025, processed by ASF HyP3 (`s1_p137`).
- **NISAR 2026:** L2 GUNW, track 159, frame 53, descending (`nisar_t159`).
- **Order:** train 2018–2023, test 2024–2026, so 2021–2025 jobs go first and 2018–2020 second.
- **Optional:** Sentinel-1 path 108 for summer 2026 (`s1_p108`) as a same-year cross-check on NISAR.

Added for Ground Check:

- **Shorelines since 1947** for the shoreline model. This needs no radar, so it starts today.
- **Terrain and surface feature layers** on the shared grid for the ground prediction.
- **No 2050 ground forecasts,** so climate-model data is a stretch item for one context chart only.

## Known facts

Verified 14 Nov 2026 (ASF search API, no login): Sentinel-1 dates per summer are in the overview table. Paths 72 and 145 are EW mode and unusable. Path 137 returns two frames per pass over the town (223 and 228); frame 223 alone covers the corridor. In 2026 the satellite changes from Sentinel-1A to 1D mid-season. NISAR track 159 frame 53 has eight consecutive pairs (nine dates) from 25 Jun to 11 Oct 2026, with duplicates for some pairs; download host `nisar.asf.earthdatacloud.nasa.gov`; file sizes not reported. HRDEM elevation COGs are on `canelevation-dem.s3.ca-central-1.amazonaws.com`, found through `datacube.services.geo.ca/stac/api`.

From earlier research, not re-checked today:

- HyP3: 8,000 credits per user per month; `INSAR_GAMMA` costs 10 credits at 80 m, 15 at 40 m; products expire after 14 days.
- ECCC Tuktoyaktuk stations: climate ID 2203914 (station 26987, daily 1995–present) and 2203911 (station 53582, 2018–present), via `api.weather.gc.ca`, no account.
- CanDCS-M6 downscaled CMIP6 daily point CSV, no login, from PAVICS THREDDS (`pavics.ouranos.ca`, path `datasets/simulations/bias_adjusted/cmip6/pcic/CanDCS-M6/`): 26 models, 1950–2100.
- ArcticDEM 2 m strips on `s3://pgc-opendata-dems/arcticdem/`, STAC at `stac.pgc.umn.edu/api/v1`: 22 snow-free strips over Tuk, 2010–2024.

## What the spec must answer

**A. Radar scene selection**

1. Exact search calls per stack, with filters that keep IW mode only and one frame only.
2. The pair rule. Proposed: each date paired with the next and the one after, within a season, never across seasons. Rules for gaps over 24 days and for the 2026 Sentinel-1A → 1D step.
3. Job count and credit cost. Our estimate for path 137, 2018–2025: 87 dates, about 150 pairs, 1,500 credits at 80 m or 2,250 at 40 m. Confirm and choose the resolution.
4. Standard `INSAR_GAMMA` or burst-based HyP3 jobs for a 31 × 17 km area, and why.
5. Job options: looks, water mask, displacement maps, incidence angle, DEM. Part 2 needs unwrapped phase, coherence and incidence angle for every pair.
6. Submission order, how to check for existing jobs under project `devotion-tuk`, and how to avoid duplicates.
7. NISAR: which version to keep for duplicates, how to get file sizes first, and whether the area can be read from the remote HDF5 without downloading the whole file.

**B. Climate**

1. Exact request for daily mean, max and min temperature from the ECCC stations, 2017–present; merging the two stations; filling gaps (ERA5-Land fallback); output `daily_temperature.csv`. Include snow-on-ground and precipitation if the station reports them, for the second-driver test.
2. Stretch: CanDCS-M6 daily `tasmax` and `tasmin` at the Tuk grid cell for SSP2-4.5 and SSP5-8.5, for one chart of projected thaw-season warmth. Safe request rate.

**C. Elevation and context**

1. Which HRDEM product to use for height above sea level, its vertical datum, and how to warp it to the shared grid as `elevation_m.tif`.
2. **Feature layers for the ground prediction,** each as a GeoTIFF on the shared grid in `data/interim/features/`: slope, roughness and a wetness index derived from the elevation model; water occurrence and distance to water (JRC Global Surface Water v1.5); summer vegetation index from cloud-free July–August Sentinel-2; distance to coast; geology class from the best available surficial map. For each: source, access, derivation steps and licence line. Say which layers are too coarse to help at block scale.
3. **Shorelines for the shoreline model,** as `data/interim/shoreline/shorelines.geojson` with `date, source, position_error_m`:
   - NRCan Tuktoyaktuk air-photo mosaics (14 dates, 1947–2004, COG/WMS/STAC, Open Government Licence – Canada). They are not co-registered: give a registration method using fixed features and an error estimate per mosaic.
   - Landsat and Sentinel-2 for 1985–2025, July–September scenes only.
   - The extraction method: manual digitising, a water-index threshold, or CoastSat (which needs a Google Earth Engine project). Pick the one that is realistic this weekend, and define the shoreline consistently across sources (bluff edge versus waterline).
   - Where the 2023–2025 shoreline protection works are, so those stretches can be flagged.
4. Highway, water bodies, coastline and services (school, health centre, store, airport) from OpenStreetMap or another open source: queries and licence consequence.
5. Optional validation data: ArcticDEM strips; Tuk Island active-layer probes (Boike et al., PANGAEA 949181).

**D. Operations**

1. Credentials: environment variable names each library expects, working the same on a laptop and in GitHub Actions.
2. Final `granules.csv` schema and the folder layout for `data/raw/`.
3. Fetch time and disk space for each weekend tier.

## Known traps

- `hyp3_submit.py` pairs consecutive rows on the same path. With two frames per pass and EW scenes in the list, it would submit invalid pairs.
- `search.py` uses fixed season dates. Say whether to filter early snow-covered scenes by date or leave it to Part 2's coherence check.
- HyP3 products expire after 14 days: download as soon as jobs finish.
- The Copernicus Climate Data Store suspends accounts that send parallel requests.
- Do not use GNWT building footprints; their licence is not stated.

## Tiers and required sections

- **Must:** path 137 jobs for 2021–2025 submitted; one NISAR pair downloaded; station temperatures; shorelines for at least six dates spanning 1947–2025.
- **Should:** all eight NISAR pairs; 2018–2020 jobs; HRDEM and the feature layers; highway, water and services.
- **Stretch:** path 108 for 2026; year-apart Sentinel-1 pairs and NISAR winter pairs for Part 2's checks; ArcticDEM strips; CanDCS-M6.

The returned spec needs: a summary table (dataset, endpoint, auth, output, size, licence); the final area with justification; selection and pair rules with pair counts per season; step-by-step fetch procedures; output file shapes; failure handling; and anything unconfirmed.
