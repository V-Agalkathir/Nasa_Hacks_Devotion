# Overnight build report: Ground Check (14–15 Nov 2026)

Branch `model/ground-check` (pushed). Nothing is on `main`. Pull request: see the end of this file.

## The short version

Everything in the plan now runs end to end on the team's real data: radar stacks, three models with pre-registered tests, site screening, the website, and the automatic update workflow. A clean rebuild takes about one minute.

**The honest headline is that the predictive models failed their pre-registered tests.** Every test failed for a stated, checkable reason, and the tool shows each failure instead of hiding it.

| Part | Built | Pre-registered result | What it means |
|---|---|---|---|
| 2 Radar processing | S1 path 137, 2021–2025 (97 pairs), and NISAR 2026 (8 pairs) | Sign check **passes** (slope 0.9994 against HyP3's own maps); reference reads zero; lakes masked; no unwrapping jumps | The radar data are real and correctly processed. Coherence is high (median 0.77–0.89). |
| 3 Model A: ground behaviour | Per-pixel sensitivity to warmth (√TDD), late-season excess, trend, classes, confidence | **Test A: fail.** Skill −0.24 against zero motion; block ρ 0.31 [0.25–0.36]; κ 0.14 | Relative to the airport pad, ground moves within about ±1 cm per summer, and which areas move more doesn't repeat reliably between years. |
| 3 Test B: NISAR | 12-day increments, ionosphere-corrected | **fail.** Block ρ 0.01 | NISAR's first Tuk summer: one pair failed to unwrap and others lost coherence. There's no connected series. |
| 3 Model B: ground prediction | Label gate | **not_run.** 110 degrading labels in 11 blocks (needs 300 in 15) | There's nothing to learn from, so no predicted layer is shown. |
| 3 Model C: shoreline | 207 transects, waterlines 1985–2025, hindcast 1985–2004 → 2005–2025 | **fail.** Error 48 m against 14 m for "no change" | The 30 m waterline record is too noisy to project a trend. Arrival years are hidden; measured change is shown instead. |
| 4 Site screening | 3 named areas (from OpenStreetMap) and 3,578 240 m squares along the highway; tiers, drivers, reasons, coring list | Rule-based on measured inputs | All three named areas come out **higher** (each sits on the shoreline). **763 squares (44 km²)** are "promising, unconfirmed" coring targets. |
| 5 Automation | `.github/workflows/update.yml`: catalogue check, season gate, fetch, rebuild, validation gate (47 checks), Pages deploy | Simulated end to end from a clean copy: works, 63 s | Not yet run in GitHub Actions; it has to be merged to `main` first (see "What you need to do"). |
| 6 Website | Built to the design session's spec (`specs/06-interactive-product.md`): one page with a hero, a map with five layers (Screen, Height, Coast, Radar, Core next) and Move/Box/Paint/Erase tools, a Ground check panel (Try chips, five needs, report), Side by side, and test cards | Checked at desktop and phone widths in the browser pane | Shows real data only (`mock: false`). Reindeer Point, The Point and Town core come out Higher; Highway km 26 comes out Lower. |

## Added Sunday morning: radar against real boreholes

11 public highway boreholes from the NWT Permafrost Database fall in our area (ITH 2013 and 2017 drilling; none in town). With the rule fixed and committed before running (Spearman ρ between top-5 m moisture and radar summer sinking: ≥ 0.4 consistent, ≤ 0 not consistent), the result is **not consistent: ρ = −0.52**. The four ice-rich boreholes (visible ice, 46–337% moisture) show *less* radar sinking than the ice-poor ones. Several boreholes sit within 50 m of each other, so this is effectively about 6 places and weak evidence, but it points against the radar, not for it. Code: `data-pipeline/src/borehole_check.py`; data in `data-pipeline/static/boreholes/`.

## Why the models failed (checked, not guessed)

1. **No processing bug.** HyP3's own `vert_disp` maps, summed independently of our chain, give the same picture: land moves within about 1 cm of the airport pad over a summer (2021 median +1.1 cm, 2025 +1.0 cm), and single 12-day pairs swing by ±1 cm across the whole area.
2. **Atmosphere swamps the signal.** Each summer has a different area-wide gradient (see `figures/radar_is_real.png`: in 2025 the south is about 2 cm "higher" than the town). Removing a plane from each pair raised agreement between training years from R1 0.31 to 0.57, and Test A's block ρ from 0.31 to 0.52. That change was made after the official test failed, so it's reported as post-hoc. Skill and κ still fail, and the official status stays fail.
3. **Data limits.** Only three training summers (2021–23): 2018–2020 were never processed. The S1 files for 2022 to mid-2025 cover only the town half of the area. 2022 disagrees with 2021 (ρ −0.10). The noise ceiling is ρ 0.42. The observed 0.31 sits inside the leave-one-year-out range (0.07–0.71), so the spec's note "data quality, not model" applies. That explains the result; it doesn't change the status.
4. **Shoreline.** The air-photo lines from 1947–1985 failed visual review: the automatic method traced mosaic edges and a small inner harbour, so they were excluded before any hindcast was run. The satellite waterline moves with wind and tide on flat shores (±15 m). Over 1985–2004 its median trend is about 0 m/yr, so it can't project the 10–20 m changes seen by 2025.

## What this means for the pitch (my recommendation)

Our earlier claim was "radar maps which ground is degrading". That claim is now tested and **false for Tuk at 80 m with the data we have**. Saying so is the strongest position we can take. Judges reward rigour, and every other team will claim their model works.

> **Hook:** Tuk is choosing where to rebuild on permafrost, with cores that describe single points.
> **What we found:** We processed five years of radar and NASA's first NISAR summer, and pre-registered our tests. Radar can't yet tell stable from degrading ground here: summer movement stays within about 1 cm of the airport pad, and the patterns didn't repeat between years.
> **What still works:** The screen narrows the coring search from the whole corridor to 44 km² of high, dry, inland ground near the highway. It shows why each area is higher or lower risk (coast, height, ground), and it updates itself every 12 days when NISAR passes come in.
> **Why it matters:** It stops a council from trusting a pretty radar map that would have been wrong. The automatic NISAR loop is in place for when L-band coverage matures.

Slides: the problem, `figures/radar_is_real.png` (the radar is real), the ground map with tiers, compare areas, where to core, and `figures/tests.png` (how do we know). The 30-second path: open the site, Ground map (tiers), tap Reindeer Point and read its drivers, Compare (all three on the shoreline), Where to core (763 squares), How do we know (failed tests shown).

## Changes from the specs (all recorded in `eval.json → deviations` and shown on the site)

- Training years 2021–23 instead of 2018–23; `min_seasons` 3 instead of 4.
- Thaw onset from air temperature only (station snow depth reports 3–4 cm at 14 °C).
- Computation on the shared EPSG:4326 grid, with all distances in metres via UTM 8N coordinates.
- Confidence `c_fit` uses τ as its floor, because σ_ref ≈ 0 when motion is referenced to the airport.
- Radar inversion keeps each cell's largest date component, not only the component containing the season's first date. Without this the corridor is lost in 2025.
- NISAR: cells outside the main connected component are masked (no closure test exists); pairs are deramped; the reference falls back to Sentinel-1-stable cells where L-band lost the airport; a pair is dropped if its land median is more than 2 cm off after referencing.
- Test B uses 12-day increments; κ is not available.
- This-season flag demonstrated on S1 2025.
- Model C uses the satellite record 1985–2025 and hindcasts 2004 → 2025.
- Part 5 is stateless (rebuild from the release on every run) instead of using a `pipeline-state` branch.
- Fixed a Part 1 bug: `fetch_context.py` saved roads, water and coast as centre points (`out geom center`). It now keeps full geometry and adds the airport runway and apron.
- Reindeer Point is the OpenStreetMap residential area about 3.6 km SSE of the town core. The old placeholder was about 5 km off.

## What you need to do

1. **Review the pull request** for `model/ground-check` → `main`, then merge it if you're happy with it. It contains your earlier frontend work too.
2. **To turn on the automatic site** (repo owner, Settings): Pages → Source = "GitHub Actions"; add secrets `EARTHDATA_USER` / `EARTHDATA_PASS` (a free Earthdata login with the ASF app approved). Then open Actions → update → Run workflow (mode `full`). Without the secrets it still searches, rebuilds and deploys; it just can't download new NISAR pairs.
3. **Tell the team the results** before they build slides around "radar detects degrading ground".
4. **Confirm before showing:** the 2.5 m storm-surge reference level for Tuk (it's a placeholder that needs a citation); the Zwieback & Meyer (2021) DOI; and that the OSM residential polygon is the Reindeer Point the community means.

## Run it yourself

```bash
cd data-pipeline/src
python radar_stack.py && python radar_stack.py --stack s1_p137 --s1-deramp
python run_models.py && python screening.py && python export_web_v2.py && python validate_web.py
cd ../../frontend && npm run dev     # http://localhost:5173
```

Needs `tuk-data.zip` (release `data-v1`) unzipped in `data-pipeline/`, plus the files in `data-pipeline/static/` copied into `data/interim/` (the workflow does this).

## Where things are

| What | Path |
|---|---|
| Radar processing | `data-pipeline/src/radar_read.py`, `radar_stack.py` |
| Models | `data-pipeline/src/models/` (`tdd.py`, `behaviour.py`, `evaluate_a.py`, `shoreline.py`, `ground_pred.py`), `run_models.py` |
| All test results | `data-pipeline/data/interim/models/eval.json` (copied to `frontend/public/data/validation.json`) |
| Screening | `data-pipeline/src/screening.py` → `data/interim/screening/areas.geojson`, `coring.json` |
| Web export and gate | `export_web_v2.py`, `validate_web.py` |
| Automation | `.github/workflows/update.yml`, `data-pipeline/src/pipeline_check.py` |
| Website | `frontend/src/` |
| Figures for slides | `docs/architecture/specs/figures/` |

## Not done or not verified

- The workflow hasn't run in GitHub Actions yet (it needs merging and Pages enabled). It was simulated locally from a clean copy.
- Model B's training code (random forest, block cross-validation, calibration) isn't written, because the label gate stops it. The gate and the reason are written.
- Sentinel-1 2018–2020 and path 108 were never processed (they need Earthdata/HyP3).
- The map draws slowly in the app's preview pane (about 12 s, from slow map-worker start-up there). It was about 3 s in a normal browser earlier tonight. Check it in Chrome.
