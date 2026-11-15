# Architecture overview: Ground Check (Tuktoyaktuk ground-screening tool)

> Synced on 14 Nov 2026 from the team's shared Claude doc, "Tuk Ground-Screening Tool: Build Plan". Edit the doc first, then re-sync.

## The idea: Ground Check

Ground Check uses free NASA radar to show which land around Tuktoyaktuk is compromised, predicts what the radar can't see, and tells the relocation team where to drill next, so no one has to move twice.

**Hook.** In 2020, Tuktoyaktuk moved four homes away from its eroding coast. Today the ground under them is sinking.

**Problem.** The town has to choose where to rebuild, and every option sits on permafrost. Some permafrost holds; some collapses when its buried ice melts. The relocation team is drilling cores, but each core describes one point, and no public map shows which land in between is compromised. Moving a home costs about $200,000. Moving it onto bad ground means paying twice.

**Opportunity.** NISAR has measured ground motion over Tuktoyaktuk every 12 days since June 2026, and Sentinel-1 holds summers back to 2018. All of it is free, and none of it reaches the people deciding.

**Solution.** A map that tells planners three things about any land near Tuktoyaktuk:

1. **How the ground behaves (measured):** stable, seasonal only, or degrading, from eight summers of radar.
2. **What unmeasured land is likely to be (predicted):** a model trained on clearly measured land predicts the condition of land the radar couldn't read, from terrain, water and vegetation, with a confidence level.
3. **How long the current town has (predicted):** for each stretch of coast, the years when the shoreline is expected to arrive, from shoreline positions since 1947.

Together these show where to core next: promising land that hasn't been checked, and land where the evidence conflicts. Each area also gets a second-move risk tier (lower, moderate, higher, not enough data) with the drivers behind it, never a single percentage.

### How each claim is tested

| Claim | Test | Reported as |
| --- | --- | --- |
| Ground behaviour is measured consistently | A model trained on Sentinel-1 is checked against what NISAR measured in 2026; area ordering compared between training and test years | Pattern agreement and rank stability |
| Ground prediction works where radar can't see | Hide whole areas, predict them, compare with what the radar measured | Accuracy against a simple baseline; used only if it beats it |
| Shoreline prediction works | Fit on 1947–1985, predict where the coast was in the 1990s to 2020s | Error in metres |

### How the gaps in the data are handled

| Gap | Handling |
| --- | --- |
| Radar is noisy over wet tundra | Shown as "can't measure", never as stable; the ground model fills it, labelled predicted |
| Summer-only measurements | We map how ground behaves under thaw, when the damage happens, and say so |
| Block scale, not houses | Results apply to areas of land, never to individual homes |
| Only one NISAR season | NISAR is the independent test; the record grows every 12 days in summer |
| No public core data | Every core the team drills confirms or corrects the model |

### What we dropped, and why

- **Ground-sinking forecasts to 2050:** six summers can't support them, and they would understate the risk of sudden collapse.
- **A single "% chance of moving again":** untestable and falsely precise. Replaced by tiers with drivers.
- **House-level or "safe zone" claims:** the radar resolves 40–80 m and measures motion relative to a reference area.

**Call to action.** "Tuktoyaktuk's relocation team is already drilling to find stable ground. Put Ground Check in their hands before the 2027 thaw: their cores test our predictions, and our map shows them where to drill next. The data is free and the code is open. What's missing is the introduction."

## Overview

The build has six parts, each with a brief below, and Parts 3, 4 and 6 changed most for Ground Check. Pitch is Sunday 5:00 PM; submission closes Sunday 11:59 PM.

The tool measures ground motion (Sentinel-1 from 2018, NISAR from 2026), classifies how the ground behaves, predicts unmeasured land and shoreline arrival, and refreshes itself when new NISAR passes arrive. It is a screen that says where to drill cores and where to look closer, not an engineering sign-off.

### The six parts

| # | Part | Turns… | …into |
| --- | --- | --- | --- |
| 1 | Data sources and acquisition | Catalogues and APIs | Radar pairs, temperatures, elevation, terrain and surface layers, shorelines since 1947 |
| 2 | Radar processing | Interferogram pairs | Ground-motion time series on one shared grid |
| 3 | Models: behaviour, ground prediction, shoreline timing | Motion, temperature, terrain, shorelines | Behaviour classes, predicted ground condition, shoreline arrival years, test results |
| 4 | Site screening and validation | Measured and predicted layers, elevation, context | Second-move risk tier with drivers, filters, and where to core next |
| 5 | Automatic updates and deployment | A schedule | New data found, processed and published with no server |
| 6 | Interactive product | Static data files | Behaviour map with year slider, area comparison with filters, coring view, coastline view, validation view |

Each brief below is self-contained: hand it to a teammate or a fresh Claude session. What comes back is one detailed markdown spec per part, precise enough to code from (formulas, file shapes, thresholds, order of operations, failure handling). The main build session implements from those specs.

### How the parts connect

1. Part 1 fetches radar pairs, temperatures, elevation, terrain and surface layers, and historical shorelines.
2. Part 2 turns radar pairs into ground motion per date on one shared grid.
3. Part 3 classifies ground behaviour, predicts unmeasured land, predicts shoreline arrival, and tests all three.
4. Part 4 combines those with elevation and access into a risk tier per area and a coring list.
5. Part 5 runs steps 1 → 2 → (3 applied) → 4 → export on a schedule.
6. Part 6 reads the exported files in `frontend/public/data/` and shows them.

Build order: Part 1 starts first, because radar jobs take hours. The shoreline model needs no radar, so it starts today in parallel. Parts 2, 5 and 6 can start at once (6 runs on mock data). The behaviour classes need the first real stack from Part 2; the ground prediction needs the behaviour classes.

### Fixed interfaces between parts

Specs may add detail but must not rename or reshape these.

- **Shared grid:** every raster uses the grid in `data-pipeline/config.yaml` (`aoi.bbox`, `processing.grid_res_deg`, EPSG:4326).
- **Area of interest:** extend from the town to the highway corridor. Default proposal `[-133.30, 69.20, -132.85, 69.48]`, about 31 km north–south by 17 km east–west. Part 1 confirms it.
- **Sign and units:** vertical ground motion in centimetres, negative = sinking. Line-of-sight values never leave Part 2.

| From → to | File(s) | Shape |
| --- | --- | --- |
| 1 → 2 | `data/interim/granules.csv` | `source, stack_id, season, ref_date, sec_date, path, frame, flight_dir, id, url` |
| 1 → 2 | `data/raw/s1/<job>/`, `data/raw/nisar/*.h5` | HyP3 product folders; NISAR GUNW HDF5 |
| 1 → 3 | `data/interim/climate/daily_temperature.csv` | `date, tmean_c, tmax_c, tmin_c, station_id, filled` |
| 1 → 3 | `data/interim/features/*.tif` | Terrain and surface layers on the shared grid: elevation, slope, roughness, wetness index, water occurrence, distance to water, summer NDVI, distance to coast, geology class |
| 1 → 3 | `data/interim/shoreline/shorelines.geojson` | One line per date, 1947–2025, with `date, source, position_error_m` |
| 1 → 4 | `data/interim/context/` | `elevation_m.tif`, `highway.geojson`, water, coast, services |
| 2 → 3, 4 | `data/interim/motion/<stack_id>/cum_<YYYYMMDD>.tif` | Vertical cm since the season's first usable date; NaN = masked |
| 2 → 3, 4 | `data/interim/motion/<stack_id>/coh_<season>.tif`, `index.json` | Mean coherence; sensor, reference, dates and pairs per season |
| 3 → 4, 6 | `data/interim/model/behaviour.tif`, `behaviour_conf.tif` | Class per pixel (stable, seasonal only, degrading, can't measure) and confidence |
| 3 → 4, 6 | `data/interim/model/ground_pred.tif`, `ground_pred_conf.tif` | Predicted chance of degrading ground where radar can't measure, and confidence |
| 3 → 4, 6 | `data/interim/shoreline/transects.geojson` | Per transect: retreat rate, hindcast error, arrival-year range per distance |
| 3 → 4, 5 | `data/interim/model/E.tif`, `expected.json` | Sensitivity to warmth; expected motion so far this season |
| 3 → 6 | `data/interim/model/eval.json` | Every test: metrics, baselines, pass/partial/fail |
| 4 → 6 | `data/interim/screening/areas.geojson` | Areas and grid cells: indicators, risk tier, drivers, coring flag |

`stack_id` values: `s1_p137` (primary history), `s1_p108` (optional), `nisar_t159` (2026).

Web data contract v2 in `frontend/public/data/` (Part 6 finalises field names): `manifest.json` (schema version, generated\_at, latest pass, update status, years, layers, provenance), `rasters/` (motion per year, behaviour, predicted ground, confidence, elevation), `areas.geojson`, `timeseries.json`, `validation.json`, `coastline.geojson` (shorelines and transects with arrival years). v2 adds files and keys and keeps the v1 keys until the frontend has moved, so `main` always demos.

### Data availability (ASF catalogue, checked 14 Nov 2026)

Sentinel-1 interferometric-mode (IW) scenes covering the town, 25 May to 5 Oct. The EW-mode passes on paths 72 and 145 cannot be used.

| Summer | Path 137 (frame 223) dates | Path 108 dates | Usable? |
| --- | --- | --- | --- |
| 2017 | 4, with an 84-day gap | 6, with 36-day gaps | No: too sparse |
| 2018 | 11 (one 36-day gap at the end) | 7, with 36- and 48-day gaps | Path 137 only |
| 2019 | 9 (two 24-day steps) | 11 | Yes |
| 2020 | 11 | 12 | Yes |
| 2021 | 11 | 11 | Yes |
| 2022 | 11 | 11 | Yes |
| 2023 | 12 | 10 | Yes |
| 2024 | 10 | 10 | Yes |
| 2025 | 12 | 10 | Yes |
| 2026 | 7, with a 48-day gap and a Sentinel-1A → 1D handover | 11 | Path 108 preferred |

- Both paths are ascending. Path 137 frame 223 covers the town and the corridor in one frame.
- The town sits where frames 223 and 228 overlap, so every pass appears twice in a search. Pick frame 223.

NISAR (L2 GUNW, provisional), track 159, frame 53, descending, HH polarisation, covers the town and the corridor in one frame:

- Eight consecutive pairs, nine dates, 25 Jun → 11 Oct 2026, including one 24-day pair (19 Jul → 12 Aug) that bridges the outage.
- Two more pairs run to 4 November and are likely snow-affected. Winter pairs from Nov 2025 – Jan 2026 cannot measure thaw.
- Some pairs exist in two versions. Use one per pair.
- NISAR starts on 25 June, about three weeks after thaw begins, so it never sees the first part of the season.

Elevation: Canada's HRDEM is open on S3 through the STAC catalogue at `datacube.services.geo.ca/stac/api` (collections `hrdem-arcticdem`, `hrdem-mosaic-2m`, `mrdem-30`), Open Government Licence – Canada. Verified to return tiles over the area.

### Train and evaluate: the refined split

The team's idea was to train on 2017–2023 and evaluate on 2024–2026. The catalogue supports that with one change: start in 2018.

| Role | Years | Data | Why |
| --- | --- | --- | --- |
| Train | 2018–2023 | Sentinel-1 path 137 | 2017 is too sparse. Six summers remain, including the record-warm 2021. |
| Test A (same sensor) | 2024, 2025 | Sentinel-1 path 137 | Clean test: same satellite geometry, unseen years. |
| Test B (new sensor) | 2026 | NISAR track 159; Sentinel-1 path 108 if time allows | Headline test: a model trained only on Sentinel-1 predicts what NISAR measured. |

This split applies to the motion-versus-warmth fit. That fit is no longer used to forecast 2050. It now does three jobs:

1. **Makes summers comparable.** Dividing motion by the season's warmth (√ of thawing degree-days) lets a late-starting NISAR season be compared with a full Sentinel-1 season.
2. **Feeds the behaviour classes.** How much the ground moves per unit of warmth, whether that is rising across years, and whether it keeps sinking late in the season together decide stable, seasonal only or degrading.
3. **Flags surprises this season.** Given this summer's temperatures so far, areas moving more than expected are an early warning.

The ground prediction uses a different test (whole areas held out), and the shoreline prediction uses a hindcast (fit 1947–1985, predict later dates). Details are in Part 3.

### Shared rules

- **Language:** "lower-risk ground", never "safe". "Scenarios", never "predictions". Block scale, not houses. Centimetres per season. Thaw season only.
- **Provenance:** every number shown is labelled measured, modelled or demo.
- **Community:** public, cited sources only. No claim of consultation or endorsement. The tool complements the relocation team's coring.
- **Licences:** credit Copernicus, NASA/ASF, ECCC/PCIC, NRCan, PGC, © OpenStreetMap contributors and Esri. CHS water levels: charts only, "not for navigation". GNWT building footprints: not without permission.
- **Secrets:** Earthdata credentials in environment variables or GitHub secrets, never in the repo.
- **No server:** the pipeline writes static files and the site is static.

### Weekend priorities

| Tier | What | Part |
| --- | --- | --- |
| Must | Sentinel-1 jobs submitted today: 2021–2025 first, then 2018–2020 | 1 |
| Must | Shoreline prediction with its hindcast error (needs no radar; start now) | 1, 3 |
| Must | One real NISAR pair mapped over the town, with a coherence map | 1, 2 |
| Must | Measured ground behaviour for the town, Reindeer Point and a highway strip, from NISAR 2026 and whichever Sentinel-1 summers return | 2, 3 |
| Must | Behaviour map with year slider, area comparison and provenance labels, on whatever data exists | 6 |
| Should | Ground prediction with its held-out-area test; if labels are late, show "pending", never a fake | 3 |
| Should | Risk tiers with drivers, filters, and the where-to-core view | 4, 6 |
| Should | Scheduled workflow that has run once and shows its log | 5 |
| Stretch | 2018–2020 history, year-apart pairs, NISAR winter pairs, thaw-depth check against Tuk Island probes, climate context chart | 1–3 |

The pitch holds even if the ground prediction slips, because its core claims rest on measurement and on a tested shoreline prediction. If the radar is too noisy at block scale, lead with the coastline view and say what was found.
