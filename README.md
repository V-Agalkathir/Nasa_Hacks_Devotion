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

## Task split (6 people)

| # | Lane | Owner | Saturday | Sunday AM |
|---|---|---|---|---|
| 1 | **Lead / pitch / submission** | Agal | Lock scope, keep lanes unblocked, start slides + submission text | Rehearse pitch, record backup video, submit |
| 2 | **NISAR data** | _____ | `search.py` → confirm GUNW coverage over Tuk **(first 30 min!)**, download, `inspect_h5.py`, fill config | `process.py` for 2026, sanity-check sign + values (expect a few cm) |
| 3 | **Sentinel-1 history** | _____ | `hyp3_submit.py` for 2023–2025 **ASAP** (slow queue) | `--download`, process, compare with published 2–6 cm/season |
| 4 | **GIS / zones / coastline** | _____ | Digitize real outlines for the Point, town core, Reindeer Point (QGIS / geojson.io) | Coastline-change layer (stretch); final `export_web.py` |
| 5 | **Frontend: map** | _____ | `MapView`, `TimeSlider`: overlay, zone click, opacity toggle, before/after | Mobile/low-bandwidth polish, deploy (Vercel) + custom domain |
| 6 | **Frontend: panel + story** | _____ | `ZonePanel`, `Legend`, `AboutModal`: risk badge, chart, plain-language summary | Distance-to-services note, final copy, screenshots for slides |

**Fallback rule:** if NISAR GUNW has no usable Tuk coverage by **2 PM Saturday**, lane 2 joins lane 3 and the 2026 season comes from Sentinel-1. NISAR stays in the story as "the next step" plus whatever product we *can* show.

---

## Git workflow

- `main` must always build and demo. Work on branches: `data/nisar`, `data/s1`, `gis/zones`, `fe/map`, `fe/panel`.
- Small PRs and merge often. Pipeline outputs in `frontend/public/data/` are committed (they're small). Raw data never is (`.gitignore`).
- Log every AI use in `docs/ai-usage.md` as you go.

## Rules to remember

Everything is built this weekend · no NASA logos or branding · at least one NASA dataset (NISAR) for Global eligibility · AI disclosed, AI images watermarked · submission closes **Sun 11:59 PM**.

## Ethics

Treat the Hamlet of Tuktoyaktuk and the Inuvialuit Regional Corporation as co-designers and owners of community knowledge. Only use public, credited or consented stories and photos. Present evidence side by side and let the community draw conclusions.
