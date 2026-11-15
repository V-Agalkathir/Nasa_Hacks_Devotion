# Brief 4: Site screening and validation

> Synced on 14 Nov 2026 from the team's shared Claude doc, "Tuk Ground-Screening Tool: Build Plan". Edit the doc first, then re-sync.

Write only the spec file named below. Do not change code. Read `docs/architecture/00-overview.md` first if you have the repo.

This part turns Part 3's measured and predicted layers into guidance per area: a second-move risk tier with its drivers, filters, and a list of where a core would tell the team the most. Return a spec as `docs/architecture/specs/04-site-screening.md`; read `frontend/public/data/zones.geojson` and `data-pipeline/src/export_web.py` first if you have the repo.

Context: the town has moved homes to Reindeer Point, about 7 km inland, where residents now report sinking ground. A relocation team is taking permafrost cores at candidate sites along the highway to Inuvik. Cores describe single points; this tool gives the area-wide view and says where the next core is most useful.

**Your job:** specify the areas, the indicators, the tier rule, the coring logic, the filters and the cross-checks, precisely enough to code. Every output must be explainable in one sentence to the Hamlet Council.

## Decisions already made

- **The question each area answers:** how likely is it that a home built here would have to move again, and why?
- **Tiers, not percentages:** lower, moderate, higher, not enough data. Each tier comes with its drivers, for example "Ground: likely degrading (predicted, moderate confidence). Coast: not expected before 2060."
- **Two drivers kept separate:** ground condition and shoreline arrival are shown side by side, never merged into one hidden number.
- **Measured beats predicted.** Where radar measured the ground, use Model A. Use Model B only where radar couldn't measure, and label it predicted.
- **Never "safe".** Use "lower-risk ground".
- **Candidate sites are not public.** Do not invent them. Screen everything near the highway and let the user pick.
- **Output:** `data/interim/screening/areas.geojson` plus any rasters the map needs.

## Inputs available

| Input | From | Notes |
| --- | --- | --- |
| Behaviour class and confidence | Part 3, Model A | Measured: stable, seasonal only, degrading, can't measure |
| Predicted chance of degrading ground, with confidence | Part 3, Model B | Only where radar can't measure; absent if the model failed its test |
| Shoreline transects with arrival-year ranges | Part 3, Model C | Per stretch of coast |
| This-season expectation | Part 3 | Flags areas moving more than expected |
| Motion per summer, coherence | Part 2 | For the per-area chart |
| Elevation, highway, water, coastline, services | Part 1 | Open sources |

## What the spec must answer

**A. Areas**

1. Named areas: the Point, town core, Reindeer Point. Current outlines are placeholders: how to draw better ones from open data and mark them approximate.
2. Screening cells: a grid over land within a set distance of the highway. Cell size justified against 40–80 m radar pixels, and the distance from the road.
3. Exclusions: water, sea, steep pixels.

**B. Indicators per area** (formula, units, area statistic, and the sentence a council member reads)

1. **Ground condition:** share of the area in each behaviour class, measured or predicted, and the dominant class.
2. **Getting worse:** whether sensitivity is rising across years, shown only when distinguishable from noise.
3. **Moving more than expected this season.**
4. **Coast:** the year range when the shoreline is expected to reach the area, or "not expected before \<year>".
5. **Height above sea level** and a low-lying flag, with a cited storm-surge reference level for Tuk.
6. **Wetness:** share of water or ponding in and around the area.
7. **Access:** distance to the highway and to the town core. Residents have said Reindeer Point is too far for elders to walk; distance is a real criterion.
8. **Confidence:** high, medium or low, from valid-pixel share, coherence, summers observed and, for predictions, Model B's own confidence. Give thresholds.

**C. The tier rule**

1. A transparent table from ground condition, coast timing and confidence to a tier. Low confidence forces "not enough data".
2. A horizon for the coast driver (proposed 25 years, adjustable in the UI) and how the tier responds to it. State plainly that the ground driver describes condition now and has no clock.
3. A reason string per area naming the drivers, with each marked measured or predicted.
4. How tiers change when a new pass arrives, without flipping on one noisy date.
5. Worked examples for the three named areas using placeholder numbers.

**D. Where to core next**

1. **Promising, unconfirmed:** ground that reads stable with at least medium confidence, passes the elevation and access filters, and has no known core.
2. **Conflicting evidence:** the two satellites disagree, the prediction and nearby measurements disagree, or confidence is low near otherwise promising ground.
3. How to order the list without it reading as a ranking of sites, and how a core result would be recorded later to confirm or correct the model.

**E. Filters**

The conditions a user can set (ground class, minimum height above sea level, maximum distance to the highway, minimum confidence, coast horizon), their defaults, and what the map shows for areas that fail.

**F. Cross-checks for the "How do we know?" view** (each done, pending or not available, never a fake pass)

- Model A: Sentinel-1 versus NISAR in 2026, and ordering of areas between training and test years.
- Model B: held-out-area accuracy against its baselines.
- Model C: hindcast error in metres.
- Consistency with public reports that relocated homes at Reindeer Point are sinking (Canadian Geographic, October 2026). A consistency check, not proof.
- Stretch: ArcticDEM elevation differencing; Tuk Island active-layer probes (Boike et al. 2021).

For each: what is compared, what counts as agreement, and how it is worded.

**G. Outputs**

Full property list for `areas.geojson`: indicators, tier, drivers, reason, coring flag, confidence, and provenance (measured, predicted, demo) per field. Map rasters and colour scales; class colours must be colour-blind safe and "can't measure" must look different from "stable".

## Known traps

- For inland candidate sites the coast driver is effectively nil, so the tier is the ground driver. Say so in the UI rather than implying two risks were weighed.
- Reindeer Point homes sit on gravel pads. At 40–80 m, radar cannot tell pad settling from natural ground thaw. Word results accordingly.
- Stable ground can still be a poor site: low-lying, wet, or far from services. The filters and side-by-side layout exist to show that.
- Predicted ground must never be styled like measured ground.
- Do not rank people's homes. Results apply to ground areas at block scale.

## Tiers and required sections

- **Must:** named areas with behaviour shares, coast timing, elevation and confidence; a first tier rule with reason strings.
- **Should:** screening cells along the highway; filters; where-to-core list; checks list with statuses.
- **Stretch:** ArcticDEM and probe checks; user-drawn areas.

The returned spec needs: area definitions; an indicator table; the confidence rule; the tier rule as a table with worked examples; the coring logic; filter definitions; cross-check wording; the `areas.geojson` schema with one full example; anything unconfirmed.
