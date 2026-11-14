# Tuktoyaktuk Ground Stability Dashboard

**Team Devotion · NASA Space Apps 2026 Edmonton · Challenge 06 "Dancing with the SARs"**

An interactive web map that uses **NISAR L-band radar** (plus Sentinel-1 for history) to show how much the ground in Tuktoyaktuk, NWT sinks each summer as permafrost thaws. It compares the eroding **Point**, the **town core**, and the **Reindeer Point** relocation site, helping the Hamlet and the Inuvialuit Regional Corporation see where ground is more or less stable before moving homes.

> Honest limits (keep these in the UI and the pitch): block/neighbourhood scale, not individual houses · centimetre-scale per season · thaw season (June–Sept) only · "lower-risk ground", never "safe zone".

---

## How it works

```
 ASF (NISAR GUNW, Sentinel-1)          data-pipeline/  (Python)                    frontend/  (React + MapLibre)
 ───────────────────────────    ──────────────────────────────────────────    ───────────────────────────────
  search.py ──► granules.csv                                                      reads ONLY public/data/*
  download_nisar.py ──► raw/*.h5   ┐                                              ┌ map + radar overlay
  hyp3_submit.py ──► raw/s1/*.tif  ├► process.py ──► interim/disp_<season>.tif ──► export_web.py ──► public/data/ ┤ time slider (per summer)
                                   ┘                                              ├ zone panel + chart
                                                                                  └ legend, about/limits
```

There is **no backend server**. The pipeline runs on a laptop and writes static files, and the frontend is a static site (Vercel / GitHub Pages). Less to break during the demo.

---

## Repo structure

```
Nasa_Hacks_Devotion/
├── README.md                 ← you are here
├── data-pipeline/            ← DATA TEAM
│   ├── config.yaml           ← AOI box, seasons, wavelengths, HDF5 paths (edit here only)
│   ├── requirements.txt
│   └── src/
│       ├── common.py         config + path helpers
│       ├── search.py         1. find scenes on ASF            → data/interim/granules.csv
│       ├── download_nisar.py 2a. download NISAR GUNW           → data/raw/*.h5
│       ├── hyp3_submit.py    2b. submit/download S1 InSAR jobs → data/raw/s1/
│       ├── inspect_h5.py     print HDF5 tree to fill config paths
│       ├── process.py        3. pairs → one cumulative cm raster per season
│       ├── export_web.py     4. write frontend files (PNG, GeoJSON, JSON)
│       └── make_mock_data.py fake rasters so the frontend can start NOW
├── frontend/                 ← FRONTEND TEAM
│   ├── public/data/          ← THE DATA CONTRACT (see below)
│   └── src/
│       ├── App.jsx           layout + state (selected season, selected zone)
│       ├── lib/data.js       loads manifest; riskLabel() thresholds
│       └── components/
│           ├── MapView.jsx   MapLibre map, satellite basemap, radar overlay, zone outlines
│           ├── TimeSlider.jsx
│           ├── ZonePanel.jsx zone stats, risk badge, all-zones chart
│           ├── Legend.jsx
│           └── AboutModal.jsx limits + credits + data sovereignty note
└── docs/
    ├── submission-checklist.md
    ├── pitch-outline.md      7 slides
    ├── data-sources.md       paste into submission
    └── ai-usage.md           log every AI use (required)
```

---

## Quick start

**Frontend** (works right away with mock data)
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

**Pipeline** (Python 3.10+)
```bash
cd data-pipeline
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python src/make_mock_data.py && python src/export_web.py   # mock data → frontend
# real data:
python src/search.py
python src/hyp3_submit.py          # submit EARLY, jobs take time
export EARTHDATA_USER=... EARTHDATA_PASS=...   # free account: urs.earthdata.nasa.gov
python src/download_nisar.py
python src/inspect_h5.py data/raw/<one GUNW file>.h5   # → fill nisar paths in config.yaml
python src/hyp3_submit.py --download
rm data/interim/disp_*.tif         # remove mock rasters!
python src/process.py && python src/export_web.py
```

---

## Data contract (frontend ⇄ pipeline)

This lets both teams work in parallel. **Don't change these shapes without telling the other team.** All files live in `frontend/public/data/`.

`manifest.json`
```json
{
  "aoi": { "name": "Tuktoyaktuk, NWT", "bbox": [w, s, e, n], "center": [lon, lat], "zoom": 11.5 },
  "units": "cm (line-of-sight, negative = subsidence)",
  "colour_range_cm": [-8, 8],
  "seasons": [
    { "id": "2026", "label": "Summer 2026", "source": "NISAR",
      "image": "rasters/disp_2026.png",
      "coordinates": [[w, n], [e, n], [e, s], [w, s]] }
  ],
  "zones": "zones.geojson", "timeseries": "timeseries.json", "coastline": "coastline.geojson"
}
```

`zones.geojson`: polygons with `properties.id` (`point` | `core` | `reindeer`), `name`, `approximate`, and `stats[season] = { mean_cm, p10_cm, valid_pct }` (stats are added by the pipeline).

`timeseries.json`: `{ "<zone id>": [ { "season": "2023", "mean_cm": -5.4, "p10_cm": -6.4, "valid_pct": 95.9 }, … ] }`

`rasters/disp_<season>.png`: a colourised overlay (PuOr, colour-blind safe, orange = sinking, transparent = no data).

⚠️ The current `zones.geojson` outlines are **rough placeholders**, and the rasters are **mock data**. Both must be replaced before the demo.

---

## Data references

**Method: measure → explain → prove → project.** SAR measures past sinking. Local temperature explains it through the Stefan relation, `subsidence(pixel, summer) ≈ E(pixel) · √TDD(summer) + trend(pixel) · year`, where TDD is accumulated thawing degree-days. Fit on 2017–2022, test on 2023–2025, then drive the model with climate scenarios to 2050. Outputs are **scenarios, not forecasts**. Abrupt thermokarst collapse is not captured.

### Measure: radar
| Dataset | Access / coverage of Tuk | Licence & credit | Notes |
|---|---|---|---|
| **NISAR L-band** GUNW / GSLC (ASF) | Free via Vertex / `asf_search`. ~11 GUNW + ~10 GSLC over Tuk. Gap 27 Jul–10 Aug 2026 | NASA open data, no restrictions | One season only (2026). **Required NASA source** |
| **Sentinel-1** via ASF HyP3 | Free Earthdata login. 8,000 credits/month, 10–15 per interferogram. ~40 SLCs over Tuk in summer 2025 | Credit: "Contains modified Copernicus Sentinel data" | Products **expire after 14 days**, so download promptly. History 2017–2025 |

### Explain + project: drivers
| Dataset | Access / coverage | Licence & credit | Notes |
|---|---|---|---|
| **ECCC Tuktoyaktuk climate stations** | No account. Bulk CSV or api.weather.gc.ca. Stn 26987 daily 1995–Nov 2026; 53582 from 2018; older back to 1957 | ECCC licence; credit ECCC | **Best TDD source** |
| **ERA5-Land** (Copernicus CDS) | Free account + API token. 9 km hourly, 1950–now | CC-BY 4.0 | Gap-filling only. Send requests **one at a time** (parallel requests get the account suspended) |
| **CanDCS-M6** downscaled CMIP6 | No login. Point CSV from PAVICS THREDDS. ~10 km daily 1950–2100, 26 models, 4 SSPs | OGL-Canada + CMIP6 terms; cite ECCC/PCIC | Use SSP2-4.5 + SSP5-8.5 and show the model spread |
| Ground ice (GSC OF 8713), ESA CCI permafrost v5, Rampton Map 1647A | Open | OGL-Canada; ESA CCI with acknowledgement | Regional context only. The town pixel is NoData |

### Validate
| Dataset | Access / coverage | Licence & credit | Notes |
|---|---|---|---|
| **ArcticDEM** (PGC) | Open S3 / STAC, no account. 22 snow-free 2 m strips over Tuk, 2010–2024 | CC-BY 4.0; NSF acknowledgement | Ellipsoidal heights, need co-registration |
| Ground truth | Tuk Island active-layer probes (Boike et al., PANGAEA 2021); boreholes 16–20 km away (NWT Permafrost DB, GTN-P); CALM ≥55 km; ICESat-2 | CC-BY / per-dataset citation | Sparse, mostly off-town |

### Coastline + ocean
| Dataset | Access / coverage | Licence & credit | Notes |
|---|---|---|---|
| **NRCan Tuktoyaktuk air photos** | 14 mosaics 1947–2004, 10–50 cm, COG/WMS/STAC | OGL-Canada | Mosaics are not co-registered. Use the mosaics (individual scans are paid) |
| Landsat / Sentinel-2 + CoastSat, DSAS v6.2 | Free imagery. CoastSat needs a Google Earth Engine non-commercial project | USGS open; Copernicus attribution; CoastSat GPL-3 | July–Sept scenes only. Allow time for Earth Engine setup |
| JRC Global Surface Water v1.5 | 30 m, 1984–2024 | Unrestricted; cite Pekel et al. 2016 | Pond/wetness history for the watch list |
| Sea ice (NSIDC v4), ERA5 waves, CHS stn 06485 water level | NSIDC no login; CHS IWLS API (3-min data from ~2019) | NSIDC cite; ERA5 CC-BY; **CHS: no raw-data redistribution** | Show CHS as **charts only**, labelled "not for navigation" |

### People + buildings
| Dataset | Access / coverage | Licence & credit | Notes |
|---|---|---|---|
| OpenStreetMap buildings | 436 buildings in Tuk | ODbL (attribution, share-alike) | Ready |
| Microsoft building footprints | Open | ODbL | Ready |
| GNWT ATLAS footprints | ~900 via REST | Licence not stated | **Ask permission before use** |
| Statistics Canada 2021 Census | 937 residents, 88% Inuvialuit | OGL-Canada | Context |
| Basemap imagery | Esri World Imagery | Credit "Imagery © Esri" | |

**Attribution page must credit:** Copernicus, NASA/ASF, PGC (ArcticDEM), ECCC/PCIC, OSM, CHS, Esri.

---

## Git workflow

- `main` must always build and demo. Work on branches: `data/nisar`, `data/s1`, `gis/zones`, `fe/map`, `fe/panel`.
- Small PRs and merge often. Pipeline outputs in `frontend/public/data/` are committed (they're small). Raw data never is (`.gitignore`).
- Log every AI use in `docs/ai-usage.md` as you go.

## Rules to remember

Everything is built this weekend · no NASA logos or branding · at least one NASA dataset (NISAR) for Global eligibility · AI disclosed, AI images watermarked · submission closes **Sun 11:59 PM**.

## Ethics

Treat the Hamlet of Tuktoyaktuk and the Inuvialuit Regional Corporation as co-designers and owners of community knowledge. Only use public, credited or consented stories and photos. Present evidence side by side and let the community draw conclusions.
