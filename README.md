# Ground Check: choosing safer ground for Tuktoyaktuk

**Team Devotion · NASA Space Apps Challenge 2026 (Edmonton) · "Dancing with the SARs"**

Tuktoyaktuk, NWT, is losing land to coastal erosion and storm flooding, and moving the community is under discussion. Residents have said they can't choose a site without seeing it on a map. Ground Check is an interactive map where anyone can set their own rules for a new site, such as "high ground, within 15 km of town, dry in a 1-in-100-year storm in 2100", and instantly see which land around Tuk meets all of them, and why other land does not. Nothing is ranked or scored. A second view, for researchers, checks every new NASA–ISRO **NISAR** radar pass over Tuk and shows how good the data is.

**Live site:** https://v-agalkathir.github.io/Nasa_Hacks_Devotion/ (once GitHub Pages is enabled; see [Deploy](#deploy))

> Ground Check narrows where to look. It does not pick a site, predict ground ice or replace drilling: every place still needs a drilled core before anything is built. A student prototype, not endorsed by the Hamlet of Tuktoyaktuk.

---

## The three views

One switch at the top of every view: **Simple · Advanced · Research**.

| View | Address | For | What's on it |
|---|---|---|---|
| **Simple** (opens first) | `#simple` | Residents | The map and one list. Height above sea, distance from shore and distance to the highway sit on the map; storm flood, distance to town, lakes, radar coverage and place size are under "More rules". Opening a place shows its size, height, shore, town distance, storm flood and summer movement. A how-to popup explains the tool on first load. |
| **Advanced** | `#advanced` | Planners, the Hamlet, judges | Every rule with a histogram of all land, the full list with sorting, every fact per place with its range among the others, named places (The Point, Town core, Reindeer Point) checked rule by rule, side-by-side comparison of up to three places, and a printable one-page summary. |
| **Research** | `#nisar` | Scientists | NISAR data quality, not ground risk: each 2026 pair kept or dropped and why; maps of movement, coherence and the ionosphere correction; NISAR next to Sentinel-1 on one scale; a pass-by-pass timeline with the instrument gap; the outlook to the first validated thaw season (summer 2027). |

Simple and Advanced share the same rules and open place, so switching keeps your work.

---

## How it works

```
 Public data                     data-pipeline/ (Python)                          frontend/ (React)
 ─────────────                   ─────────────────────────────────────            ──────────────────────────
 NISAR GUNW (ASF DAAC)     ┐     radar_stack.py   pairs → per-summer movement      reads public/data only:
 Sentinel-1 via ASF HyP3   ├──►  run_models.py    thaw model + pre-registered tests  manifest.json
 NRCan HRDEM, JRC water,   │     screening.py     240 m squares, flood thresholds    tool.json   (all squares)
 OSM, Landsat/Sentinel-2,  │     export_tool_v3.py    → tool.json                    nisar/      (pair images)
 ECCC climate, boreholes   ┘     export_nisar_web.py  → nisar/                       Simple · Advanced · Research
                                 validate_web.py  51 checks, size budgets
```

There is no backend server. The pipeline writes small static files (first load under 1 MB) and the site does all filtering in the browser.

**The squares.** Land within 2 km of the roads, from town south along the highway to about km 40, is cut into **3,578 squares of 240 m** (about 206 km²). Each square stores measured values: height, distance to the 2025 shoreline and shoreline change since 2005, distance to the highway and town, share of lakes nearby, radar coverage, summer movement and storm-flood level.

**The rule.** A square passes only if it meets every rule that is switched on. There are no weights:

```
pass(s) = ∏ over rules k of [ (1 − on_k) + on_k · 1{ s meets rule k } ]
```

Minimum rules (height, distance from shore, radar) use `x ≥ θ`; maximum rules (highway, town, lakes) use `x ≤ θ`; the flood rule passes when at least 90% of the square stays above the chosen storm level. Passing squares that touch, within the same 2 km stretch of highway, form a **place**. Places are lettered along the highway from town; the order is geographic, not a ranking.

**Storm flood.** For each elevation pixel, a priority-flood search finds the lowest sea level that reaches it through lower ground (a connected "bathtub" model). That is compared with the published 1-in-10, 1-in-100 and 1-in-200 storm-surge levels for 2020, 2050 and 2100 from the Tuktoyaktuk coastal erosion study (Baird 2019).

**Radar movement.** Sentinel-1 interferograms (2021–2025) and NISAR pairs (2026) are masked for coherence and water, referenced to the airport gravel pad, converted to vertical movement (`d = λφ / 4π`, divided by cos θ) and solved into a running total per summer by least squares. Because our checks of it did not agree with other measurements, the tool labels summer movement **unconfirmed**.

**NISAR quality rules.** A pair is dropped if its reference area is unreadable or if, after referencing, the median of all land is more than 2 cm from zero (a sign of an unwrapping error). Pairs with a large tilt correction or median coherence under 0.35 are kept but marked weak.

---

## Results and checks

All pass/fail thresholds were written down before the checks ran (git tag `prereg-eval`). None of the predictive checks passed, so the tool shows only measured facts and official flood scenarios, and keeps predictions out until they pass.

| Check | Result |
|---|---|
| Thaw model predicts 2024–2025 movement better than "no movement" (Test A) | Fail: skill −0.24, rank correlation 0.31 |
| NISAR ranks the ground like Sentinel-1 (Test B) | Fail: ρ 0.009 over 1,624 blocks; no unbroken chain of five dates |
| Radar sinking matches wetter, icier ground in 11 highway boreholes | Not consistent: ρ −0.52 |
| Predict ground behaviour where radar can't see (Model B) | Not run: 110 measured examples, 300 needed |
| 1985–2004 shoreline trend predicts 2005–2025 (Model C) | Fail: 48 m error against 14 m for "no change" |

The daily workflow re-runs these as new data arrives. NISAR's first validated thaw season (summer 2027) is the next real test.

---

## Data sources

**NASA**
- NISAR Level-2 GUNW interferograms, track 159 frame 53, via the ASF DAAC: https://search.asf.alaska.edu/ · docs: https://nisar-docs.asf.alaska.edu/
- ASF HyP3 on-demand InSAR processing (Sentinel-1): https://hyp3-docs.asf.alaska.edu/
- NASA Earthdata catalogue: https://www.earthdata.nasa.gov/
- Landsat imagery (NASA/USGS), for shorelines: https://landsat.gsfc.nasa.gov/

**Space agency partners and other**
- Copernicus Sentinel-1 and Sentinel-2 (ESA)
- NRCan High Resolution Digital Elevation Model (HRDEM, ArcticDEM-based), via the NRCan Data Cube
- JRC Global Surface Water v1.4 (Pekel et al. 2016): https://global-surface-water.appspot.com/
- OpenStreetMap: https://www.openstreetmap.org/copyright
- Environment and Climate Change Canada daily climate data: https://api.weather.gc.ca/
- NWT Permafrost Database highway boreholes: https://doi.org/10.46887/2019-014 · https://doi.org/10.46887/2019-016
- Storm-surge levels, Baird (2019), as published by Future Tuktoyaktuk: https://futuretuktoyaktuk.org/flooding
- Residents' site criteria: Nuna Community Voices report (Feb 2025)
- Methods: Priority-Flood (Barnes et al. 2014), connected flooding (Poulter & Halpin 2008), small-baseline InSAR (Berardino et al. 2002), USGS DSAS shoreline transects, MSE skill score (Murphy 1988)

The full list with links is in the app, under **About the data → Sources**.

---

## Run it

**Website** (the data is committed in `frontend/public/data`, so this works on its own)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Add `-- --host` to `npm run dev` to open it from other devices on the same Wi-Fi.

**Pipeline** (Python 3.11). The raw and interim data are not in git: download `tuk-data.zip` from the [`data-v1` release](https://github.com/V-Agalkathir/Nasa_Hacks_Devotion/releases/tag/data-v1) and unzip it inside `data-pipeline/`. The workflow also copies `data-pipeline/static/` into `data/interim/` (see `.github/workflows/update.yml`).

```bash
cd data-pipeline
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd src
python radar_stack.py
python radar_stack.py --stack s1_p137 --s1-deramp
python run_models.py
python screening.py
python borehole_check.py
python export_web_v2.py
python export_tool_v3.py
python export_nisar_web.py
python validate_web.py
```

Fetching fresh data (`search.py`, `hyp3_submit.py`, `fetch_*.py`) is described in `data-pipeline/README.md`; NISAR downloads need a free Earthdata account.

### Deploy

`.github/workflows/update.yml` runs daily. In the thaw season it checks NASA's catalogue for new NISAR passes over Tuk, fetches only the Tuk crop, rebuilds everything, runs the validation gate and publishes to GitHub Pages; outside the season it reports "paused for winter". Any push to `main` rebuilds the site from the committed data. A failed check never publishes, so the last good site stays live.

One-time setup: **Settings → Pages → Source: GitHub Actions**, then run the `update` workflow with mode `deploy_only`.

---

## Repo structure

```
├── frontend/
│   ├── public/data/          data the site reads: manifest.json, tool.json, nisar/
│   └── src/
│       ├── main.jsx          views: #simple (default), #advanced, #nisar
│       ├── App.jsx           Simple and Advanced views, About, printable summary
│       ├── lib/tool.js       rules, places, flood rule, wording
│       ├── components/       NisarView (Research), Views (switch), Welcome (how-to), Sources
│       └── tool.css, nisar.css
├── data-pipeline/
│   ├── config.yaml           area, radar stacks, thresholds
│   ├── static/               small context files the workflow needs
│   └── src/
│       ├── search.py, hyp3_submit.py, fetch_*.py      get the data
│       ├── radar_read.py, radar_stack.py              radar processing (Sentinel-1, NISAR)
│       ├── models/, run_models.py                     thaw model, shoreline trends, tests
│       ├── screening.py, borehole_check.py            squares, flood thresholds, borehole check
│       ├── export_tool_v3.py, export_nisar_web.py     web data
│       ├── pipeline_check.py, validate_web.py         catalogue check, validation gate
│       └── process.py, export_web.py, make_mock_data.py   early starter scripts (not used by the site)
└── .github/workflows/update.yml   daily update, validation and deploy
```

---

## Limits

- No ground-ice information between the 11 highway boreholes; only drilling shows ice content.
- Neighbourhood scale (240 m squares, 80 m radar), never single houses or pads.
- Some rules come from residents (high ground, about 15 km from town, flood safety); the shore, highway, lakes, radar and size rules and most starting values are our own choices, and every one can be changed.
- Not weighed: Inuvialuit lands and harvesting areas; cultural, burial and gathering places; what families want; cost; gravel and water sources; knowledge held by Elders and land users.
- The flood model is a static water level on today's ground, with no waves or future erosion.
- Radar movement is unconfirmed and relative to the airport pad.

## Use of AI

AI tools were used to speed up building, as Space Apps allows; the idea, the decisions and the review were the team's.

| Who | Tool | What it helped with |
|---|---|---|
| Agal | Claude (Anthropic) | Repo scaffold, first README, starter pipeline and frontend code |
| Martin | Claude (Anthropic) | Research on the relocation process and datasets, licence checks; radar processing (Sentinel-1 and NISAR), data exports, validation gate and update workflow |
| Martin | Claude Design | Layout and visual design of the three views |

No AI-generated images, video or audio are used. Maps and charts are drawn by our code from the data.

## Ethics

The Hamlet of Tuktoyaktuk and the Inuvialuit own their community knowledge, and none of it is in this tool. We have not yet consulted the community; the next step is to set the rules with the Hamlet and the trained community monitors. The tool presents evidence side by side and leaves the decision to the people who live there.

Attribution: contains information licensed under the Open Government Licence – Canada; contains modified Copernicus Sentinel data (2021–2025); Landsat imagery courtesy of the U.S. Geological Survey; NISAR data courtesy of NASA/JPL-Caltech and ISRO via the Alaska Satellite Facility; map data © OpenStreetMap contributors. No NASA logos or branding are used.
