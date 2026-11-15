# Brief 6: Interactive product

> Synced on 14 Nov 2026 from the team's shared Claude doc, "Tuk Ground-Screening Tool: Build Plan". Edit the doc first, then re-sync.

Write only the spec file named below. Do not change code. Read `docs/architecture/00-overview.md` first if you have the repo.

This part specifies what people see and do in Ground Check: the views, interactions, data contract, component states and demo path, precisely enough to build without design questions. Return a spec as `docs/architecture/specs/06-interactive-product.md`; read the README data contract, everything in `frontend/src/`, and the design canvas (ask the frontend lead for access) first.

Audience: the Hamlet Council and housing planners, who are not technical, often on phones, on slow northern internet. Judges are the second audience: at most seven slides or a 30-second video, plus the live site.

Current build (branch `fe/map`): React 18 + Vite + MapLibre GL + Recharts with an Esri satellite basemap, reading only static files. It already has a radar overlay, a summer slider, a zone panel with chart, legend, layer toggles, an about box with credits, a demo-data banner and a phone layout.

## What the product must do

1. **Show how the ground behaves:** a map of stable, seasonal only, degrading and can't-measure ground, with predicted ground visibly different from measured ground.
2. **Compare years with a slider,** and two years directly, using the per-summer motion behind the classes.
3. **Compare specific areas side by side,** with the second-move risk tier and its drivers, and filters the user sets.
4. **Show where to core next.**
5. **Show how long the coast leaves each area,** as year ranges.
6. **Show how sure we are** and where every number came from.

## Decisions already made

- **Decision first:** the opening view answers "which ground is compromised, and where should we look next?"
- **Tiers with drivers, never a percentage or a "best site" badge.**
- **Three provenance labels:** measured, predicted, demo. Predicted layers carry a confidence level and a hatched or lighter style. The demo banner stays while any layer is simulated.
- **Wording:** "lower-risk ground", never "safe"; "predicted" for model output; shoreline arrival as a range of years.
- **Limits visible in the main view:** block scale, thaw season only, motion relative to a reference area, a screen and not a sign-off.
- **Colour:** class colours and the motion palette are colour-blind safe; "can't measure" never looks like "stable".
- **Light and fast:** first load under 2 MB, works at 390 px, usable without animation, no NASA logos or mission branding.
- **The 3D intro is optional** and never blocks the working tool.

## Data the views read (contract v2, finalised here)

| File | Holds |
| --- | --- |
| `manifest.json` | Schema version, generated\_at, latest pass, update status, area, years, layers, provenance |
| `rasters/` | Behaviour classes, predicted ground, confidence, motion per year, elevation |
| `areas.geojson` | Named areas and screening cells: indicators, tier, drivers, reason, coring flag, confidence |
| `timeseries.json` | Per area: per-summer totals and per-date curve, measured and expected |
| `validation.json` | Every test and cross-check with its status and error |
| `coastline.geojson` | Dated shorelines since 1947 and transects with arrival-year ranges |

Years: Sentinel-1 2018–2025, NISAR 2026 once processed. The UI must cope with any subset, with the ground prediction missing, and with demo data.

## What the spec must answer

**A. Structure**

1. Views and navigation. Proposed: Ground map (default), Compare areas, Where to core, Coastline, How do we know, About. What is on screen first on phone and desktop.
2. How the design canvas maps onto existing components (`MapView`, `TimeSlider`, `ZonePanel`, `Legend`, `LayerControl`, `AboutModal`), which are new, and what state lives in `App.jsx`.

**B. Ground map**

1. The default layer (behaviour classes) and its legend in plain words.
2. How predicted ground is distinguished from measured ground, and how confidence is shown.
3. Tapping an area: the tier, the two drivers, the reason sentence and the provenance of each.
4. The "moving more than expected this season" flag and the freshness line ("Last radar pass: \<date>, \<sensor>. Updates every 12 days, June to September.").

**C. Year slider and year-versus-year**

1. What one step shows: that summer's motion, normalised so years with different windows compare, labelled in a few words.
2. States: measured, demo, missing. A note at 2025→2026 that the sensor changes.
3. Per-year metadata: sensor, band, date window, share of area with valid data.
4. The compare pattern for a phone on slow internet (swipe, A/B toggle or a change layer) and a one-sentence summary for the selected area.

**D. Compare areas**

1. Picking areas: tap named areas or cells, how many at once, how selection shows.
2. Layout: one column per area; tier and reason on top; rows for ground condition, getting worse, coast timing, height above sea level, wetness, access and confidence. Phone layout.
3. Filters: ground class, minimum height, maximum distance to highway, minimum confidence, coast horizon. Defaults, and how failing areas appear.
4. A per-summer chart for selected areas, measured versus expected.

**E. Where to core**

1. How promising-unconfirmed and conflicting-evidence areas are shown on the map and in a list.
2. Wording that makes clear this suggests where a core is most informative, and does not rank sites or replace the relocation team's judgement.

**F. Coastline**

1. Shorelines by date since 1947, with a date control.
2. Arrival-year ranges per stretch of coast and per named area, the hindcast error beside them, and protected stretches marked.
3. The horizon control shared with the tier (10 to 40 years).

**G. Trust**

1. Provenance pill design and placement.
2. "How do we know?" view: one card per test (Sentinel-1 versus NISAR, held-out areas, shoreline hindcast, Reindeer Point consistency), each done, pending or not available, with its error or accuracy and its baseline.
3. The limits strip, and a short "what we don't predict" note (ground sinking in 2050, single houses, sudden collapse).
4. Empty, loading and error states for every file; the site renders with only `manifest.json` and one raster.

**H. Contract and quality**

1. Field-level schema for every file with an example each, keeping v1 keys readable until the pipeline switches. Raster format and size budget.
2. Performance plan to stay under 2 MB; accessibility (contrast, focus order, the area table as the map's text alternative, colour never the only signal).
3. A ten-minute manual test checklist at phone and desktop widths.

**I. Demo**

A 30-second path showing, in order: the hook in one line, the ground map, one area's tier and drivers, two areas side by side with a filter, where to core, the coastline years, and one test result. Which screens become slides.

## Known traps

- Motion is relative to a reference area. A legend saying only "cm" invites reading values as absolute elevation change.
- Empty or "can't measure" areas must not look like "no motion".
- If the ground prediction failed its test or isn't ready, the layer shows "pending" with the reason. Nothing is faked.
- For inland sites the coast driver is nil; the UI says the tier reflects ground condition.
- C-band (2018–2025) and L-band (2026) differ in coverage and noise.
- The pipeline rewrites `manifest.json` on every export: anything the frontend needs must be in the contract.
- Residents' stories, photos and quotes stay placeholders until there is consent.

## Tiers and required sections

- **Must:** ground map with honest states; year slider; side-by-side comparison of the three named areas with tier and drivers; coastline years; provenance labels; limits strip.
- **Should:** filters; where-to-core view; "How do we know?" view; freshness line; the canvas's visual language.
- **Stretch:** selectable screening cells along the highway; year-versus-year change layer; 3D intro with a static fallback.

The returned spec needs: view map and navigation; component list with props and state; interaction specs with every state; contract v2 schemas with examples; a copy deck in final wording; performance and accessibility plan; manual test checklist; demo path; open design questions for the frontend lead.
