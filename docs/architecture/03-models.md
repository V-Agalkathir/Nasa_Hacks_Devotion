# Brief 3: Models: ground behaviour, ground prediction, shoreline timing

> Synced on 14 Nov 2026 from the team's shared Claude doc, "Tuk Ground-Screening Tool: Build Plan". Edit the doc first, then re-sync.

Write only the spec file named below. Do not change code. Read `docs/architecture/00-overview.md` first if you have the repo.

This part produces Ground Check's three results and proves each one: a measured behaviour class per pixel, a predicted ground condition where radar can't measure, and predicted shoreline arrival years. Return a spec as `docs/architecture/specs/03-models.md`.

Inputs: from Part 2, vertical motion per radar date per pixel for `s1_p137` (summers 2018–2025) and `nisar_t159` (25 Jun – 11 Oct 2026), each season starting at zero. From Part 1, daily station temperature, terrain and surface feature layers on the shared grid, and dated shorelines from 1947 to 2025.

**Your job:** specify each model, its training data, its test, its pass criteria and its output files precisely enough to code. Decide pass, partial and fail for every test before looking at results.

## Decisions already made

- **No forecasts of ground sinking to 2050.** Six summers can't support them and they would understate collapse risk.
- **Every prediction is tested against real outcomes** and reported with its error. A model that doesn't beat its baseline is not shown.
- **Radar that can't measure is never read as stable.**
- **Simple models:** few parameters, standard tools (numpy, scikit-learn).
- **Wording:** "predicted" always appears with a confidence level; future shoreline positions are ranges of years.

## Model A: ground behaviour classes (measured)

Classify each pixel from its own radar record. Starting definitions to refine:

| Class | Meaning | Starting rule |
| --- | --- | --- |
| Stable | Little movement in any summer | Low sensitivity to warmth |
| Seasonal only | Settles each summer in step with warmth, no sign of worsening | Clear sensitivity, no late-season excess, no upward trend |
| Degrading | Keeps sinking late in the season, or sinks more each year | Late-season excess or rising sensitivity |
| Can't measure | Radar signal too noisy | Low coherence or too few valid dates |

The features come from fitting motion against warmth within each season, with A(t) = √TDD(t) and TDD the sum of daily mean temperatures above 0 °C:

```latex
d(p, t_i) - d(p, t_0) = -E(p)\,\left[A(t_i) - A(t_0)\right] + \varepsilon
```

- **Sensitivity E(p):** cm per √(°C·day), fitted through the origin on pooled dates. Working in differences from the first date handles NISAR's late start on 25 June.
- **Worsening:** E fitted per season, then a robust slope across seasons.
- **Late-season excess:** sinking beyond the fitted curve late in summer, a published sign of ice-rich ground (Zwieback and Meyer, The Cryosphere, 2021; confirm the citation).

The spec must answer:

1. TDD definition (start date, missing days) and the exact estimators for the three features, with minimum data per pixel.
2. Class thresholds. Motion is relative to a reference area, so prefer thresholds relative to the whole screened area, or justify absolute ones. Compare fixed rules with clustering and pick one.
3. A confidence level per pixel from coherence, valid dates, fit residual and number of summers.
4. Tests: train the fit on 2018–2023, predict 2024–2025 motion from temperature (Test A), and compare the Sentinel-1 result with NISAR 2026 (Test B). Report whether the ordering of areas and the class map hold across years and sensors, and against a baseline that uses no temperature.
5. **This-season expectation:** given this year's temperatures to date, the expected motion at the latest radar date, and the rule for flagging an area as moving more than expected.
6. Whether previous-winter snow or summer rain improves the held-out result enough to add as a second driver. Default no.

## Model B: ground prediction where radar can't measure (predicted)

A classifier trained on pixels where Model A is confident, predicting the chance that ground is degrading from features available everywhere: elevation, slope, roughness, wetness index, water occurrence, distance to water, summer vegetation index, distance to coast, geology class.

The spec must answer:

1. Label definition (degrading versus not, or all three classes) and how many confident pixels per class are needed.
2. Model choice (random forest or gradient-boosted trees) and settings.
3. **The test:** hold out whole areas, not random pixels, because neighbouring pixels are too alike and inflate the score. Give the block size and number of folds.
4. Baselines to beat: the most common class, and the class of the nearest measured pixel. Metrics: balanced accuracy and a calibration check of the predicted chances.
5. The decision rule: if it doesn't beat both baselines, it is not shown and the tool says so.
6. Confidence per pixel, and a rule that marks predictions far outside the training conditions as "not enough data".
7. Which features mattered, in plain words, for the "How do we know?" view.
8. A consistency check: what the model says about Reindeer Point, where public reports describe sinking. Not proof, because radar labels came from the same area.

## Model C: shoreline arrival years (predicted)

Per transect along the coast, the range of years when the shoreline is expected to reach a given distance inland.

The spec must answer:

1. Transect layout: spacing (proposed 50 m), baseline, and length.
2. Shoreline position per date per transect, with a position error for each source (air-photo mosaics are not co-registered; Landsat pixels are 30 m).
3. Rate estimator: weighted regression over all dates versus a recent-period rate, since retreat has sped up. Pick one and justify.
4. **The hindcast:** fit on 1947–1985, predict positions at later dates (1990s, 2004, 2020s), report error in metres per transect and overall.
5. Arrival-year range for each named area and for key places such as Tuk Island's narrowest point, combining rate uncertainty and position error.
6. How the 2023–2025 shoreline protection works are handled: protected stretches are flagged, and the prediction describes the unprotected trend.
7. What the model can't see: single large storms, and collapse of ice-rich bluffs.

## Outputs

- `data/interim/model/behaviour.tif`, `behaviour_conf.tif`, `E.tif`, `E_slope.tif`, `late_season.tif`, `expected.json`.
- `data/interim/model/ground_pred.tif`, `ground_pred_conf.tif`.
- `data/interim/shoreline/transects.geojson`: rate, hindcast error, arrival-year ranges.
- `data/interim/model/eval.json`: every test above with metrics, baselines, pixel or transect counts, and pass/partial/fail.

## Known traps

- Six summers is a small sample; say what the data can't support.
- If the reference area moves, every pixel's motion shifts equally: ordering survives, absolute values don't.
- 2021 was unusually warm: check it doesn't dominate the fit.
- Sentinel-1 quality is lower in 2022–2025 (one satellite). A weaker test-year result may be data quality: propose a way to tell.
- Model B's labels are noisy and only exist where radar works, which is drier ground. Wet tundra may be outside what it learned from.
- Ground ice is only moderately predictable from the surface. Model B is a screen for where to core, not a verdict.
- Stretch only: a thaw-depth estimate from seasonal settling, checked against the Tuktoyaktuk Island probes (Boike et al. 2021), shown as a range.

## Tiers and required sections

- **Must:** Model C with its hindcast; Model A classes for areas with data, with the NISAR cross-check.
- **Should:** Model B with its held-out-area test; this-season expectation; `eval.json`.
- **Stretch:** second driver test; thaw-depth check; one climate-context chart of projected thaw-season warmth from CanDCS-M6.

The returned spec needs: each model in equations or rules with every symbol defined; training and test design with pass criteria; output schemas with a small JSON example each; limits in plain language the UI can reuse; anything unconfirmed.
