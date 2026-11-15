# Part 4 spec: Site screening (as built)

`data-pipeline/src/screening.py` → `data/interim/screening/areas.geojson`, `coring.json`. Written by Martin's build session on 15 Nov 2026, after Part 3's tests had run. The rules below use measured inputs only, because no predicted layer passed its test.

## A. Areas

| Kind | Definition |
|---|---|
| Named | The Point, Town core and Reindeer Point. Outlines are OpenStreetMap `landuse=residential` ways 1312829393; 1312829390–92; 1061589153 (© OpenStreetMap contributors, ODbL). Marked approximate. Reindeer Point is about 3.6 km SSE of the town core. |
| Screening cells | 240 m squares (3 × 80 m radar pixels, so each has enough independent looks) on a UTM 8N lattice, kept where the cell is within 2 km of any OSM road and at least 50% land. That gives 3,578 cells. |
| Exclusions | Water: JRC occurrence ≥ 50%, sea, and OSM water polygons, with a one-cell buffer. |

## B. Indicators (per area; the sentence a council member reads)

| Indicator | Formula | Reads as |
|---|---|---|
| Ground condition | Shares of Model A classes over land cells; dominant class if radar covers ≥ 50% | "Ground: moves 0.2 cm more than the airport pad each summer (measured) — unconfirmed" |
| Summer movement | Median of −E′·ΔA_med (cm per summer vs airport pad; negative = sinks more) | Same sentence |
| Getting worse | Not shown: five summers can't separate a trend from noise | "Not shown" |
| This season | ≥ 30% of cells with z < −2 and median z < −1.5 on the last two passes (S1 2025) | "Moving more than the rest of the area" |
| Coast | Distance to the 2025 sea (`distance_to_coast`); measured change = median of transects within 300 m (2005–09 vs 2021–25, ±15 m) | "Shoreline within 100 m; moved +3 m since 2005–09" |
| Height | Median and 10th percentile of HRDEM elevation; share below the 2.5 m storm-surge reference **[unconfirmed level: cite before showing]** | "Mostly below the 2.5 m storm-surge reference" |
| Wetness | Water share in a ~250 m window | "26% water within 250 m" |
| Access | Distance to the Inuvik–Tuk Highway and to the town core (metres) | "533 m to the highway, 2.9 km to the town core" |
| Confidence | Radar coverage × median Model A confidence; high ≥ 0.70, medium ≥ 0.45. **Ground confidence is forced to low while Test A fails.** | "low (radar sees 93%)" |

## C. Tier rule

Each driver gets a level: 0 none, 1 some, 2 strong.

| Driver | 2 | 1 | 0 |
|---|---|---|---|
| Coast | Sea within 100 m | Sea 100–300 m away | More than 300 m inland |
| Height | ≥ 50% below 2.5 m | 10th percentile below 4 m | Otherwise |
| Ground | ≥ 25% degrading | ≥ 50% seasonal or degrading | Otherwise. **Only counts if Test A passes or partly passes.** |

Tier = highest level: 2 → higher, 1 → moderate, 0 → lower. If radar covers less than 50% and coast and height are both 0, the tier is "not enough data". The reason string names the drivers and always adds: "Ground condition is not confirmed by radar; a core is needed before building." For inland areas it adds: "The coast is not a factor here, so this tier reflects height and ground only." Tiers follow the latest export; the this-season flag needs two consecutive passes, so one noisy date can't flip it.

Worked results (real data): The Point is higher (shoreline, partly low-lying); Town core is higher (shoreline, 50% below 2.5 m); Reindeer Point is higher (shoreline; 8 m high).

## D. Where to core

- **Promising, unconfirmed:** a cell that is ≥ 4 m high, ≤ 1 km from the highway, more than 300 m from the coast, has less than 40% water nearby, is dominantly stable with radar coverage ≥ 70%, and has no this-season flag. That gives 763 cells (44 km²).
- **Conflicting evidence:** passes the height, access and coast checks, but has a season flag, patchy radar coverage (30–70%), or ≥ 10% degrading. That gives 5 cells.
- Ordered by distance from the town core along the corridor. This is a route, not a ranking. Wording: "Suggests where a core would tell the relocation team the most. It does not rank sites or replace their judgement."
- Recording core results (next step): add `cores.geojson` with location, date, ice content and active-layer depth. A promising cell with an ice-rich core becomes "conflicting", which feeds Model B labels later.

## E. Filters (site)

Minimum height (default 4 m), maximum distance to the highway (1 km), more than 300 m from the coast (on), less than 40% water nearby (on). Cells that fail are faded on the map, not removed. The coast-horizon control is disabled because the shoreline forecast failed.

## F. Cross-checks

See `validation.json` cards: radar checks (pass), Test A (fail), Test B (fail), Model B (not run), shoreline hindcast (fail), and Reindeer Point (not available). Reindeer Point wording: homes sit on gravel pads, and at 80 m radar can't separate pad settling from ground thaw, so this is not a test of the public reports.

## G. `areas.geojson` (named areas, full properties)

```json
{"id": "reindeer_point", "name": "Reindeer Point", "kind": "named", "approximate": true, "tier": "higher",
 "reason": "Higher second-move risk: on the shoreline. Ground condition is not confirmed by radar; a core is needed before building.",
 "drivers": [{"driver": "coast", "text": "...", "level": 2, "provenance": "measured"},
             {"driver": "height", "text": "...", "level": 0, "provenance": "measured"},
             {"driver": "ground", "text": "...", "level": 0, "provenance": "measured", "confidence": "low", "tested": false}],
 "indicators": {"ground": {...}, "getting_worse": {...}, "this_season": {...}, "coast": {...}, "height": {...},
                "wetness": {...}, "access": {...}, "confidence": {...}},
 "filters": {"min_height_m": true, "max_highway_m": true, "coast": false, "dry": true}, "coring": null,
 "provenance": {"ground": "measured", "coast": "measured", "height": "measured", "access": "measured", "tier": "rule on measured inputs"}}
```

Cells are published compactly in `frontend/public/data/cells.json` (column list and codes inside the file).
