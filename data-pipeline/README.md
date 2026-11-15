# Data pipeline — Part 1: data acquisition

Part 1 collects **every input** the other parts need and saves it in a fixed place and format.
It does no science; it only finds, downloads (or streams) and tidies data.
Full technical spec: [`docs/architecture/specs/01-data-acquisition.md`](../docs/architecture/specs/01-data-acquisition.md).

## Quick start

```bash
cd data-pipeline
pip install -r requirements.txt
python src/search.py                                   # 1. find radar scenes, plan pairs
python src/hyp3_submit.py --seasons 2021-2025 --submit # 2. Sentinel-1 processing jobs (then 2018-2020)
python src/hyp3_submit.py --status                     #    check progress
python src/hyp3_submit.py --download                   #    download finished jobs (within 14 days!)
python src/fetch_nisar.py                              # 3. NISAR 2026 (cropped to our area)
python src/fetch_climate.py                            # 4. daily temperatures
python src/fetch_terrain.py                            # 5. elevation + terrain/surface "features"
python src/fetch_context.py                            # 6. roads, water, coastline, services (OpenStreetMap)
python src/fetch_shorelines.py                         # 7. shorelines 1947-2025
```
Each script is **safe to re-run** and skips work already done where possible.
Only steps 2 and 3 need a login (free NASA Earthdata account).

**First-time Earthdata setup** (HyP3 refuses logins until done):
fill in *Study Area* at <https://urs.earthdata.nasa.gov/profile>, then approve the HyP3 app when the
script prints an `approve_app` link. Your login is saved in `~/.netrc` (`_netrc` on Windows) — never commit it.

## Files

| File | What it does |
|---|---|
| `config.yaml` | Single source of truth: study area, radar stacks, pair rule, HyP3 settings, NISAR layer paths, weather stations, shared grid |
| `src/common.py` | Shared helpers: load config, folder paths, the **shared grid** (every map layer uses the same pixels) and functions to write/resample rasters onto it |
| `src/search.py` | Asks NASA's ASF catalogue which radar images exist over Tuk each summer, keeps one per date, and plans the image **pairs** to compare |
| `src/hyp3_submit.py` | Sends Sentinel-1 pairs to NASA's free HyP3 cloud service, which turns each pair into a ground-motion map; also checks status and downloads results |
| `src/fetch_nisar.py` | Reads only our area out of each 2.5 GB NISAR file over the internet (about 1.6 MB each) |
| `src/fetch_climate.py` | Downloads daily Tuk temperatures (3 stations merged) and reports thawing degree-days per summer |
| `src/fetch_terrain.py` | Builds the terrain and surface **feature** maps (see below) |
| `src/fetch_context.py` | Downloads the highway, lakes, coastline and services from OpenStreetMap |
| `src/fetch_shorelines.py` | Traces the coastline from air photos (1947–2004) and satellites (1985–2025) |

Not Part 1 (left for Parts 2 and 6): `process.py`, `export_web.py`, `make_mock_data.py`.

## Where the data comes from (all free)

| Data | From | Login | Why we need it |
|---|---|---|---|
| **NISAR** radar, 2026 | NASA ASF (Earthdata Cloud) | Earthdata | Ground motion in 2026; the independent test of our model |
| **Sentinel-1** radar, 2018–2025 | ESA satellite, processed by NASA ASF HyP3 | Earthdata | Eight summers of ground motion: the training history |
| Daily temperature | Environment and Climate Change Canada (`api.weather.gc.ca`) | none | Explains *why* ground sinks (more summer warmth = more thaw) |
| Elevation (HRDEM) | Natural Resources Canada | none | Height above sea level, slope, drainage |
| Surface water | European Commission JRC Global Surface Water | none | Lakes, ponds, distance to water and coast |
| Vegetation (NDVI) | Sentinel-2 via Microsoft Planetary Computer | none | Plant cover hints at wet/ice-rich ground |
| Roads, services | OpenStreetMap | none | Access: distance to highway, school, health centre |
| Air photos 1947–2004 | NRCan National Air Photo Library (`napl-tuktoyaktuk`) | none | Old coastlines for the shoreline model |
| Landsat 1985–2016, Sentinel-2 2017–2025 | Microsoft Planetary Computer | none | Recent coastlines, one per summer |

Credit on the site: Copernicus, NASA/ASF, ECCC, NRCan, JRC, © OpenStreetMap contributors, Esri.

## What are the "features"?

**Features** are maps of things we can measure **everywhere**, even where radar fails (wet tundra).
Model B (Part 3) learns how features relate to ground behaviour where radar *does* work, then predicts
ground condition where it doesn't. All are on the shared grid in `data/interim/features/`:

| Feature | Meaning | Why it might matter |
|---|---|---|
| `elevation.tif` | Height above sea level (m) | Low ground floods and is often wetter |
| `slope.tif` | Steepness (degrees) | Slopes drain; flat ground holds water |
| `roughness.tif` | How bumpy the ground is (m) | Thermokarst (collapsing ice-rich ground) makes hummocky terrain |
| `wetness_index.tif` | Where water collects, from the terrain shape | Wet ground thaws deeper |
| `water_occurrence.tif` | % of time each pixel was water, 1984–2021 | Ponds that come and go signal melting ground ice |
| `distance_to_water.tif` | Metres to the nearest lake or pond | Ground next to water thaws more |
| `distance_to_coast.tif` | Metres to the sea | Coastal erosion and salt affect permafrost |
| `ndvi_summer.tif` | Greenness in July–August | Vegetation insulates the ground; changes reflect wetness |

## What the outputs look like

```
data/
  raw/                       (big, git-ignored)
    s1/<job_id>/             Sentinel-1 interferograms from HyP3 (phase, coherence, incidence angle)
    nisar/<granule>.h5       NISAR pairs cropped to our area, same internal layout as NASA's files
    shoreline/airphotos/     air-photo crops, one per date
  interim/                   (small, git-ignored; inputs to Parts 2-4)
    scenes.csv               chosen radar image per date
    granules.csv             one row per image PAIR (the hand-off to Part 2)
    climate/daily_temperature.csv
    features/*.tif           the feature maps above
    context/                 elevation_m.tif, highway/water/coast/services.geojson
    shoreline/shorelines.geojson  + previews/*.png (check these by eye!)
```

## Key facts and limits (tell the pitch team)

- **Study area:** Tuk, the Point, Tuk Island, Reindeer Point and the first ~25 km of the highway.
- **Radar only measures in summer** (June–Sept). Snow blocks it.
- **Sentinel-1 2022–2025** covers only the area north of ~69.29°N (town, Point, Reindeer Point, northern
  highway). 2018–2021 covers everything. Reason: satellite frame boundaries (see the Part 1 spec).
- **NISAR 2026:** 8 pairs, 25 Jun → 11 Oct. Usable pixels per pair: 16–53% (water and wet tundra lose signal).
- **Temperature:** 2017–2026 complete for May–Sept after filling a Jan–Jul 2018 gap from hourly data.
- **Shorelines:** 49 dates, 1947–2025, auto-traced. **Someone must check `previews/` by eye** before Model C uses them.
- **Geology layer:** not available at a useful scale; Model B runs without it.
