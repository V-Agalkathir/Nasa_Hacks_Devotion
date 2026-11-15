# Part 3 Spec: Models (ground behaviour, ground prediction, shoreline timing)

Target path: `docs/architecture/specs/03-models.md`
Status: draft **r2** for Team Devotion, 15 Nov 2026. Items marked **[unconfirmed]** need a check before coding. Items marked **[stretch]** are out of scope for the weekend; everything else is in scope.

## Changes in r2

- **Contradictions fixed:** separate class rules for short records (§2.4b), so test-year and NISAR maps are no longer all "can't measure" and NISAR can show Degrading. Confidence formula units and the one-season case (§2.5). Huber constant and the meaningless `x2_min` rule removed (§2.2). One definition of "recent" shoreline rates (§4.3). Arrival wording and rounding (§4.5). Model B statuses now cover every case (§3.5). Every threshold is in `config.yaml` (§6).
- **Projected CRS:** all computation in UTM 8N (EPSG:32608); EPSG:4326 only for published copies (§1, §5).
- **Model A:** season ends at freeze-back; onset at snow-off; free offset per season; capped season weights instead of Huber; late excess measured relative to reference patches, with a proper standard error; false-discovery control on pixel trends; √time and average-warmth baselines; corrected noise ceiling plus leave-one-year-out; block-bootstrap intervals; confidence bins checked against class stability.
- **This-season expectation (§2.7):** gain fitted outside the named areas; noise per sensor; variance includes uncertainty in E; two-pass reference.
- **Model B:** stratified group folds, sigmoid calibration, target-domain weighting, applicability coverage reported, confidence from domain distance, ALE for direction, Reindeer Point check reports both parts.
- **Model C:** baseline offset adapts to the record, one shoreline definition in all fits, shore-type flags, fully defined prediction interval with process noise, per-epoch coverage, lead-time inflation, explicit Monte-Carlo mixture.
- **Pre-registration:** model settings (not only thresholds) are tuned on training data only and frozen at `prereg-eval` (§0).

---

## 0. Scope, order of work, and run order

**Build order (weekend tiers):**

1. **Model C (shoreline)**: needs no radar. Start now. Must. (Build and tune now; do not run the hindcast evaluation before the `prereg-eval` tag.)
2. **Model A (behaviour)**: needs Part 2's first real stack. Must (NISAR cross-check + areas with data).
3. **Model B (ground prediction)**: needs Model A labels. Should. If labels are late, `eval.json` says `pending`.
4. **This-season expectation + `eval.json` assembly**: Should.

**Code layout** (`data-pipeline/src/models/`), read top-down from `main()`:

```
run_models.py        main(): load config -> tdd -> model_a -> model_b -> model_c -> evaluate -> write outputs
  tdd.py             thaw_onset(), freeze_back(), season_tdd(), A_of_t()
  behaviour.py       fit_season(), pool_E(), fit_trend(), fit_late_excess(), classify_multi(),
                     classify_short(), confidence(), expected_now()
  ground_pred.py     build_labels(), make_folds(), domain_weights(), spatial_cv(), fit_final(), applicability()
  shoreline.py       build_baseline(), build_transects(), positions(), fit_rates(), select_estimator(),
                     hindcast(), arrival_years()
  evaluate.py        every test -> eval.json (status from frozen thresholds), block-bootstrap intervals
```

`main()` order: (0) read config, reproject any EPSG:4326 inputs to the compute grid, (1) read grids and stacks, (2) Model C (independent), (3) Model A train-frozen, Tests A/B, then final refit, (4) Model B on final A labels, (5) expectation, (6) write rasters/JSON, (7) `eval.json`.

**Pre-registration rule.**
1. Tune every model setting in `config.yaml` (coherence thresholds, `E_floor`, late window, `min_A_span`, block size, shoreline windows) on **training data only**: Sentinel-1 2018–2023 for Models A and B, shorelines up to 1985 for Model C. Do not look at 2024–2026 radar results or post-1985 hindcast errors while tuning.
2. All pass/partial/fail thresholds live in `config.yaml` under `models.thresholds`.
3. Commit both and tag the commit `prereg-eval` **before** the first evaluation run.
4. Do not edit them after seeing results. If anything changes, record it (date, what, why) in `eval.json.deviations`.
5. Notes such as "data quality, not model" explain a status. They never change it.

Every test status starts as `pending` in code. The JSON values in §5 are illustrative only.

**Frozen vs final fits.**
- *Frozen fit*: uses 2018–2023 only. Used for Tests A and B. Never touched by test years.
- *Final fit*: refit on 2018–2025 (and NISAR 2026 for classification only where noted). Used for the published map and for Model B labels.
Report both maps' agreement as part of Test A.

---

## 1. Inputs (contract with Parts 1 and 2)

| Input | Path | Notes |
|---|---|---|
| Vertical motion per date | `data/interim/motion/<stack_id>/cum_<YYYYMMDD>.tif` | cm, negative = sinking, NaN masked. The zero point does not matter (each season gets its own offset, §2.2) |
| Per-season metadata | `.../index.json` | sensor, dates, reference, pairs, gaps, revisit interval |
| Coherence | `.../coh_<season>.tif` | mean per season |
| Part 2 quality (requested) | valid-date count and noise estimate per pixel per season | **[unconfirmed]** Part 2 section E.3 says it will supply them; if not, compute `n_valid` from NaN counts and noise as in §2.3 |
| Daily temperature | `data/interim/climate/daily_temperature.csv` | `date,tmean_c,tmax_c,tmin_c,station_id,filled` |
| Snow depth and rainfall | same CSV (`snow_depth_cm`, `precip_mm`) or a sibling file | **[unconfirmed: Part 1]**. Fallback for snow-off: first snow-free MODIS/Sentinel-2 date (AOI median) |
| Feature layers | `data/interim/features/*.tif` | elevation, slope, roughness, wetness index, water occurrence, distance to water, summer NDVI, distance to coast, geology class |
| Shorelines | `data/interim/shoreline/shorelines.geojson` | `date, source, definition, position_error_m` |
| Named areas | Part 4 polygons **[unconfirmed: path]** | used for gain calibration (§2.7), area checks, arrival distances |
| Shore type | Part 1 polygons or hand-digitised **[unconfirmed]** | `open / spit / island / sheltered` (§4.1) |

Stacks: `s1_p137` (2018–2025), `nisar_t159` (2026), optional `s1_p108` (2026 cross-check).

**Grid and CRS.** All rasters share the grid in `config.yaml`, in **UTM zone 8N (EPSG:32608)**. Every distance (blocks, buffers, KD-trees, transect spacing, offsets) is computed in metres on this grid. Inputs in EPSG:4326 (e.g. `shorelines.geojson`) are reprojected on load. At 69°N a degree of longitude is about a third of a degree of latitude, so nothing is computed in degrees. If Part 2 already writes on an EPSG:4326 grid, reproject on load (bilinear for motion and coherence) **[unconfirmed: agree the shared grid with Parts 1 and 2]**.

---

## 2. Model A: ground behaviour classes (measured)

### 2.1 Warmth variable

For season year *y*:

- **Thaw onset** `t_on(y)`: the **later** of
  - (a) the first day on or after 1 April that starts 3 consecutive days with `tmean_c > 0`, and
  - (b) snow-off: the first day that starts 5 consecutive days with snow depth 0 cm (fallback: satellite snow-off date).
  If no snow source exists for a season, use (a) and set `onset_source: "air_temp"` in the season metadata. Why: warm air over snow does not thaw ground, and because A = √TDD is nonlinear, a too-early onset bends the curve; taking differences does not remove that.
- **Freeze-back** `t_fb(y)`: the first day on or after 15 August that starts 3 consecutive days with `tmean_c < 0`.
- **Season end** `t_end(y)`: the last radar date before `t_fb`. Radar dates after `t_end` are excluded from every Model A fit: frost heave lifts the ground while TDD has stopped growing.
- **TDD(t)** = Σ over days from `t_on` to `min(t, t_fb)` of `max(tmean_c, 0)`, in °C·day.
- **A(t)** = √TDD(t), units √(°C·day).
- Radar date `t_i` uses TDD through the *acquisition date* (taken from the granule name, not the processing date). Use end of day.

**Missing temperature days.**
1. Use `filled=True` rows (ERA5-Land fallback from Part 1) after bias correction: subtract the mean (filled − station) difference for that calendar month, computed on days where both exist. Count the filled days.
2. If a season has more than 10% of days in `[t_on, t_end]` filled, flag the season `temp_quality: "low"` and lower Model A confidence (§2.5).
3. If any run of more than 7 consecutive days is missing even after filling, exclude that season for all pixels.

Why √TDD: it is the Stefan-type scaling of thaw depth with warmth; subsidence from melting ground ice follows thaw depth. A single station is enough: a fixed ratio between local and station warmth is absorbed into each pixel's `E`.

### 2.2 Per-pixel feature estimators

For pixel *p*, season *s*, valid in-season dates *i = 1..n_s* (dates ≤ `t_end`):

- `y_i = cum_i` (cm, more negative = sank more). The zero point does not matter because each season has its own offset.
- `x_i = A(t_i) − A(t_first)`, where `t_first` is the pixel's first valid date in the season.

**(F1) Sensitivity per season**, with one free offset per season:

```
y_i     = c_s − E_s · x_i
E_s(p)  = − Σ (x_i − x̄)(y_i − ȳ) / Σ (x_i − x̄)²      [cm per √(°C·day); positive = sinks with warmth]
SE(E_s) = σ_s / sqrt( Σ (x_i − x̄)² )                  σ_s = residual SD of this fit
```

The offset `c_s` absorbs the error on whichever date was the zero, so one noisy first date cannot tilt the whole season.
Requirements: `n_s ≥ 5` valid dates **and** A span `x_max − x_min ≥ min_A_span` (config; start 8 √(°C·day), roughly late June to mid-July), else `E_s = NaN`.

**(F1′) Pooled sensitivity** `E(p)`, with capped season weights:

```
w_s   = 1 / SE(E_s)²,  each capped at season_weight_cap × median(w)      (cap 2.0)
E(p)  = Σ w_s E_s / Σ w_s
SE(E) = sqrt(1 / Σ w_s) × max(1, sqrt(χ²_red))                          χ²_red across seasons
```

Why: a warm season has large `x` (high leverage), so in one pooled regression it dominates. Huber loss would not stop that, because it downweights large residuals, not large `x`. Fitting each season and capping its weight does. Requires ≥ `min_seasons` (4) seasons with defined `E_s`; otherwise the pixel is classified with the short-record rules (§2.4b).

**(F2) Worsening** `E_slope(p)`: Theil–Sen slope of `E_s` versus year over seasons with defined `E_s`.
- Units: cm/√(°C·day) per year.
- Significance: exact Mann–Kendall permutation p-value on the same series (n ≤ 8, so enumerate), one-sided.
- Call it **"rising"** only if (i) the p-value passes Benjamini–Hochberg false-discovery control at `q = 0.10` over all screened pixels, **and** (ii) `E_slope × (n_years−1) ≥ 0.25 × median(E)` over the screened area (it must matter, not just be consistent). Without (i), thousands of pixel tests at α = 0.10 give thousands of false "rising" pixels.
- With 6 seasons the smallest possible p is 1/720, so few pixels may pass. That is an honest result. The published statement is at area level (Part 4 aggregates, using the area-median `E_s` series, which is much less noisy). Keep the pixel raster for the map.
- Sensor break: 2026 NISAR is excluded from `E_slope` (different sensor and window). Sentinel-1 2022–2024 single-satellite years stay in, flagged in the noise term. Record the revisit interval per season from `index.json` (2025 may include Sentinel-1C **[unconfirmed]**).

**(F3) Late-season excess** `L′(p)`:
- **Late window:** in-season dates (≤ `t_end`) with month-day ≥ `late_md` (config; start **08-10**, a calendar date so leap years don't shift it) **and** A(t) within the last 25% of the season's A range.
- **Early fit:** (F1) using only dates before the window (≥ `min_early_dates` = 4; else skip season) gives `c_e, E_e, σ_e, n_e, x̄_e, Sxx_e = Σ(x_i − x̄_e)²`.
- Residual on late dates: `r_i = y_i − (c_e − E_e · x_i)`. Negative `r_i` = sinking beyond the curve.
- `L_s = −mean(r_late)` (cm, positive = excess sinking).
- Its standard error (noise on the late dates plus the error of extrapolating the early fit):
  ```
  SE(L_s) = σ_e · sqrt( 1/n_late + 1/n_e + (x̄_late − x̄_e)² / Sxx_e )
  ```
- **Relative to the reference:** `L′_s = L_s − median over R of L_s` (reference patches, §2.4). If √TDD bends the same way everywhere (soil moisture, snow timing), every pixel would show "late excess" every year; subtracting the reference removes that shared part.
- `L′(p)` = median of `L′_s` over seasons.
- `late_flag(p)` (multi-season) = `L′_s > late_k_multi × SE(L_s)` (2.0) in at least half of the seasons with defined `L′_s` **and** in ≥ 2 seasons. Short records: §2.4b.
- **Rain check (reported, not pass/fail):** per season, Spearman ρ between the AOI-median `L′_s` and late-window rainfall. C-band phase responds to soil moisture, so a rainy August can fake late motion. Record in `eval.json.model_a.rain_check`.
- Citation: Zwieback & Meyer (2021), *The Cryosphere* 15, 2041–2055, doi:10.5194/tc-15-2041-2021, on top-of-permafrost ground ice indicated by late-season subsidence **[unconfirmed: check the DOI before it appears in the UI]**.

**NISAR-only pixels** (no Sentinel-1 record, one season): short-record rules (§2.4b); `E_slope` = NaN; confidence capped at **medium** (§2.5).

### 2.3 Noise estimate

`σ_p` = RMS of residuals about the per-season fits (F1), pooled over seasons, **kept separately per sensor**: `σ_p^C` (Sentinel-1) and `σ_p^L` (NISAR). Used by confidence (§2.5) and the this-season flag (§2.7). If Part 2 provides its own noise (triplet closure), use the larger of the two. (The late-excess test uses `SE(L_s)`, §2.2.)

### 2.4 Class rules (fixed rules, chosen over clustering)

Motion is relative to a reference area (Part 2 §B). A reference that itself moves adds a common shift to every pixel's `E`. So thresholds are defined **relative to a set of reference patches**, not as absolute cm.

**Reference patches** `R`: pixels in the Part 2 reference area (e.g. airport gravel) plus ≥ 3 other high-coherence, low-slope patches that Part 2 lists. `E_ref` = median `E` over `R`. `σ_ref` = 1.4826 × MAD of `E` over `R`.

`E′(p) = E(p) − E_ref`.

`τ_s = max(2·σ_ref, E_floor)` with `E_floor = E_floor_cm_per_season / ΔA_med`, where `ΔA_med` = median over training seasons of `A(t_end) − A(t_first)` (AOI-wide dates). A pixel at `E_floor` sinks 1.0 cm in a typical season.

#### 2.4a Multi-season rules (≥ `min_seasons` seasons with defined `E_s`)

| Order | Class | Rule (all in config) |
|---|---|---|
| 1 | **Can't measure** | `mean coherence < coh_min[band]` (start: C-band 0.30, L-band 0.25 **[unconfirmed, tune on Part 2's 2018–2023 histograms]**) **or** `valid-date share < 0.6` |
| 2 | **Degrading** | `late_flag` **or** (`E_slope` rising per §2.2 **and** `E′ > τ_s`) |
| 3 | **Stable** | `E′ ≤ τ_s` and not degrading |
| 4 | **Seasonal only** | everything else (clear sensitivity, no late excess, not rising) |

The published map may use ≥ 3 seasons where mean coherence ≥ `coh_good[band]`; mark `n_seasons`.

#### 2.4b Short-record rules (1–3 seasons)

Used for pixels with fewer than `min_seasons` seasons, NISAR-only pixels, and the test-year maps in Tests A and B.

| Order | Class | Rule |
|---|---|---|
| 1 | **Can't measure** | coherence or valid share as in 2.4a, **or** no season with defined `E_s` |
| 2 | **Degrading** | one season: `L′_s > late_k_single × SE(L_s)` (3.0). Two or three seasons: `L′_s > late_k_multi × SE(L_s)` in every season |
| 3 | **Stable** | `E′ ≤ τ_s` and not degrading (`E` pooled as in F1′ over the available seasons) |
| 4 | **Seasonal only** | everything else |

No trend term: one to three points cannot show a trend.

**Comparison map for κ (Tests A and B):** the frozen fit classified with 2.4a **without the trend term** (Degrading = `late_flag` only), because a trend cannot be checked in one or two test seasons. For two seasons the late rules in 2.4a and 2.4b are then the same. Report separately, untested, the share of pixels that are Degrading by trend only (`eval.json.model_a.trend_only_degrading_share`).

Order matters: Degrading beats Stable only when late excess or a significant upward trend exists. Class codes: `0` can't measure, `1` stable, `2` seasonal only, `3` degrading, nodata `255` (outside screened area/water).

**Fixed rules versus clustering: decision.** Run both, publish the fixed rules.
- Clustering (Gaussian mixture on `E′, L′`, k = 3; `E_slope` is left out because it is NaN for many pixels) is the sensitivity check. Compare by (a) adjusted Rand index between frozen-fit and test-year maps, (b) class stability across years, (c) whether cluster means map onto Stable/Seasonal/Degrading sensibly.
- Reason for fixed rules: clustering labels shift with data and can't be explained to the Hamlet Council in one sentence; fixed rules can.
- Record the agreement (κ) between fixed and clustered maps in `eval.json.model_a.sensitivity`.

### 2.5 Confidence per pixel

Four components, each scaled 0–1:

```
c_coh   = clip(mean_coh / coh_good[band], 0, 1)                               coh_good: C 0.6, L 0.5 [tune]
c_valid = clip(valid_share, 0, 1)
c_fit   = clip(1 − σ_p / max(|E|·ΔA_med, 2·σ_ref·ΔA_med), 0, 1)              all terms in cm
c_n     = clip(0.5 + 0.1·(n_seasons − 1), 0.5, 1)                             (1 season → 0.5, 6+ seasons → 1)
conf    = (c_coh · c_valid · c_fit · c_n)^(1/4)                               geometric mean
```

- `temp_quality: low` seasons: multiply `conf` by 0.85.
- Pixels classified from a **single season** (including NISAR-only): cap `conf` at `single_season_conf_cap` = 0.69, i.e. medium at most.
- Bins: **high** ≥ 0.70, **medium** 0.45–0.70, **low** < 0.45. Low confidence → Part 4 treats the pixel as "not enough data". Store `behaviour_conf.tif` as uint8 0–100.
- **Check (reported, not pass/fail):** in Test A, for each bin, the share of pixels with the same class in the comparison map and the test-year map. Expect high > medium > low. Record as `eval.json.model_a.conf_check`; if it is not in that order, say so in the notes. The bins are not changed after the tag.

### 2.6 Tests

**Test A: same sensor, unseen years (2024, 2025, Sentinel-1 p137).**

Procedure:
1. Frozen fit on 2018–2023 gives `E_train(p)`, `SE(E)`, `E_ref` and `τ_s`.
2. For each test season and pixel with `conf ≥ medium`: predict `ŷ_i = c − E_train(p)·x_i` using that season's observed temperatures. **Every model and baseline gets one free offset `c` per pixel-season (the season mean)**, so the score does not depend on which date was zero. Compare with observed `y_i`.
3. Metrics, computed over confident pixels and again at 500 m block medians:
   - **RMSE (cm) over all in-season dates (primary; used in the pass table).** Error in the season's total change (last minus first date) is reported as secondary.
   - **Skill** = `1 − RMSE_model² / RMSE_ref²`, with `RMSE_ref` = the lower block-level RMSE of baselines (a) and (b), pooled over both test seasons.
   - Spearman ρ of `E_train` against `E_test(p)` (F1 on the test season alone), at pixel level and at 500 m blocks.
   - Class agreement: Cohen's κ (3 measured classes) between the comparison map (§2.4b) and the test-year short-record map, on pixels confident in both. Also report the confusion matrix and per-class agreement, because κ is unstable when one class dominates.
   - 95% intervals by **block bootstrap** (1,000 resamples of 500 m blocks) for every metric. Status is decided on the point estimate; the interval is reported beside it.
4. **Baselines (none uses this year's warmth):**
   - (a) zero motion (a flat line after the free offset);
   - (b) time only: per-pixel `y = c − b·√(days since t_on)`, with `b` fitted on 2018–2023. It is concave like real subsidence, so it is a fair time-only rival. (It replaces the linear day-of-year curve, which any √-shaped model beats on shape alone.) It uses this year's onset date but not its warmth;
   - (c) average warmth: the same `E_train`, but with A taken from the mean 2018–2023 TDD curve by calendar day instead of this year's temperatures. Skill against (c) is the **warmth skill**: what knowing this year's temperatures adds. It is reported with each test year's warmth anomaly (z-score of season-end A against the training seasons). It is not in the pass table, because if the test years were average, warmth skill is near zero by construction.

**Test B: new sensor, NISAR 2026 (headline).**
1. Resample `E_train` and the comparison map to the NISAR pixels' footprint (Part 2 already gives both on the shared grid).
2. Compute `E_nisar(p)` with (F1) on NISAR dates ≤ `t_end`, starting 25 Jun.
3. Compare **ordering**, not absolute values (L-band and C-band respond to different depths and moisture): Spearman ρ at pixel and block level; κ between the comparison map and the NISAR short-record map, on pixels confident in both. Block-bootstrap intervals as in Test A.
4. **Named-area ordering:** reported, **not part of the status**. With three areas a random ordering matches exactly one time in six and gets at least two of three pairs right half the time.
5. If `s1_p108` 2026 is processed: compare C-band 2026 to NISAR over the common date window as a sensor-versus-sensor check separate from year effects.

**Pre-registered pass criteria** (config; freeze before running):

| Test | Pass | Partial | Fail |
|---|---|---|---|
| A: skill vs best of baselines (a), (b) (block level, all-date RMSE) | ≥ 0.25 | 0 to 0.25 | < 0 |
| A: block-level ρ (`E_train` vs `E_test`) | ≥ 0.70 | 0.50–0.70 | < 0.50 |
| A: κ classes | ≥ 0.40 | 0.25–0.40 | < 0.25 |
| B: block-level ρ vs NISAR | ≥ 0.60 | 0.40–0.60 | < 0.40 |
| B: κ classes | ≥ 0.30 | 0.15–0.30 | < 0.15 |

Overall Test A status = the *worst* of its three rows; likewise Test B (two rows). Report each row.

**Data quality versus model failure** (trap: S-1 single-satellite 2022–2024):
- **Noise ceiling:** `R₁` = mean pairwise block-level Spearman ρ between single-season `E_s` maps over the training seasons. `R_train = n·R₁ / (1 + (n−1)·R₁)` with n = number of training seasons. Because `E_test` comes from one season, `ρ_ceil = sqrt(R_train · R₁)`. Report `ρ_observed / ρ_ceil`.
- **Leave-one-year-out** inside 2018–2023 (including 2022, a single-satellite year): for each year, fit on the other five and compute block-level ρ with that year's `E_s`. The range of these values is the yardstick for an unseen Sentinel-1 year.
- Report mean coherence and `σ_p` for each test year versus training years.
- If test metrics fall short but `ρ_observed/ρ_ceil ≥ 0.8`, or `ρ_observed` lies within the leave-one-year-out range, or the shortfall matches the coherence drop, write "data quality, not model" in `eval.json.model_a.notes`. **The status is unchanged.**

**Robustness (not pass/fail, but reported):**
- Leave out 2021 and refit; require ≥ 90% of confident pixels keep their class. If lower, say so and show the no-2021 map as the alternative.
- Reference sensitivity: shift `E_ref` by ±1 `σ_ref`; report share of pixels that change class. Ordering is unchanged by construction.

### 2.7 This-season expectation

Given the stored frozen `E` and `SE(E)` (no retraining) and the current season's passes up to `t_end`:

```
ref            = mean of the first two usable passes (position and A)    halves the noise of a single zero date
expected(p, t) = −g · E(p) · [A(t) − A_ref]                               (cm)
observed(p, t) = y(p, t) − y_ref(p)
resid(p)       = observed − expected                                       (negative = sinking more than expected)
sd(p)          = sqrt( 1.5·σ_p,sensor² + (g · [A(t) − A_ref] · SE(E))² )
z(p)           = resid(p) / sd(p)
```

- `t` = latest radar date ≤ `t_end`; `A(t)` from temperatures up to that date (the radar date, not today). Once freeze-back has passed, set `season_closed: true` and raise no new flags.
- `σ_p,sensor` is the noise for the sensor of the current season (`σ_p^L` for NISAR: Part 2's noise, or the RMS residual over the calibration pixels this season).
- **Sensor gain for NISAR:** `E` is C-band calibrated.
  - Calibration pixels: high-confidence stable/seasonal pixels **outside every named area and its 500 m buffer**. Fitting on the areas being judged would absorb their anomaly.
  - Fit `g` = Huber slope of observed on expected using **500 m block medians** (block medians cut the noise in `expected`, which would otherwise bias `g` toward 0).
  - If fewer than 3 NISAR passes exist, or `g` is outside 0.3–3, fall back to **ordering only** (rank z-scores across areas) and say so in the output.
  - If `s1_p108` 2026 is processed, report the C-band/L-band ratio as an independent check on `g`.
  - Limitation, stated in the output: `g` absorbs any anomaly shared by the whole calibration area, so a flag means "sinking more than the rest of the mapped area this season", not "more than in past years". If `g > 1.5`, add the note "whole area sinking more than past seasons suggest".
- **Pixel flag:** `z(p) < −2`.
- **Area flag** (computed in Part 4, definition here): ≥ 30% of confident pixels flagged **and** area median `z < −1.5`, on **two consecutive passes**. Consecutive passes share the same reference, so this guards against one noisy latest pass, not against a noisy start.
- Writes `expected.json` (below) and per-pixel `E.tif` and `E_se.tif` used by Part 5.

### 2.8 Second driver [stretch] (default **no**)

Candidates: previous-winter snow-on-ground (days or mean depth) and summer rainfall to date, from Part 1's station fields.
- Add as extra regressor to the per-season fit: `y = c − E·x + β·z_driver`.
- Test via leave-one-year-out over 2018–2025: adopt only if RMSE drops ≥ 10% in at least 5 of 8 held-out years **and** held-out Test A skill rises by ≥ 0.05. Otherwise keep it out and report the result.

### 2.9 What six summers cannot support (copy for the UI)

> Six or seven summers show how ground moves with warmth now. They cannot show how it will behave in decades, and they miss sudden collapse. Motion is relative to a reference area and measured at 40–80 m, so results describe areas of land, not houses.

---

## 3. Model B: ground prediction where radar can't measure (predicted)

### 3.1 Labels

- Source: final Model A map (multi-season rules, §2.4a), pixels with `conf ≥ medium` and class in {1,2,3}.
- **Binary label:** `degrading = (class == 3)`, versus not (`class ∈ {1,2}`). (Three-class is a stretch; the UI only needs the chance of degrading.)
- **Minimum data:** ≥ 300 confident pixels in each class, spread across ≥ 15 distinct 2 km blocks per class. If not met: Model B status = `not_run`, reason recorded, and `ground_pred.tif` is not written.
- Only labelled pixels *with all features valid* enter training.

### 3.2 Features

`elevation, slope, roughness, wetness_index, water_occurrence, dist_to_water, ndvi_summer, dist_to_coast, geology_class (one-hot)`. Distances in metres on the EPSG:32608 grid.

- Drop any feature with > 20% NaN in the AOI.
- Geology from surficial maps is probably too coarse at block scale: keep it only if permutation importance on held-out blocks is above zero; otherwise drop and note it.
- Do **not** add coordinates or any Model A output as features.

### 3.3 Model

`sklearn.ensemble.RandomForestClassifier`:
- `n_estimators=500, min_samples_leaf=20, max_features="sqrt", max_depth=12, class_weight="balanced_subsample", n_jobs=-1, random_state=0`.
- Chosen over gradient boosting: fewer settings, less overfit with noisy labels. Gradient boosting may be run as a comparison only [stretch].
- **Probability calibration: sigmoid (Platt)**, fitted inside each training fold on an inner group split; the final model is calibrated with out-of-fold predictions. (Isotonic overfits with about 100 blocks.)
- Caveat: calibration is done on ground radar can measure. The share of degrading ground where radar fails is unknown, so probabilities there can be off even with a good ECE. §3.4's target weighting checks part of this.

### 3.4 Test: whole-area hold-out

Neighbouring pixels are alike, so random splits inflate scores.
- **Block size:** 2 km square on the EPSG:32608 grid. (AOI is ~17 × 31 km, so ~120 blocks.) Check the empirical semivariogram range of the labels on the training map and raise the block size if the range exceeds 2 km **[unconfirmed]**.
- **Folds:** `StratifiedGroupKFold(n_splits=5, shuffle=True)`, grouped by block, stratified by label; repeat 5× with block origins shifted by 0, 400, 800, 1,200 and 1,600 m (diagonally) and seeds 0–4. Report the mean and spread. If a test fold has fewer than 30 degrading pixels, use 4 folds for that repeat and record it.
- **Buffer:** drop training pixels within 500 m of any test block edge.
- **Baselines (computed with the same folds):**
  1. *Chance:* balanced accuracy 0.5. A majority-class rule always scores exactly 0.5, so it is not computed separately.
  2. *Nearest measured pixel's class:* for each test pixel, the class of the nearest training-fold labelled pixel (KD-tree on UTM coordinates). Written `BA_NN` below.
- **Target-domain weighting.** Labels exist where radar works; predictions are made where it doesn't, and loss of coherence is itself linked to fast deformation. Plain cross-validation says nothing about that ground. So:
  1. Train a domain classifier (random forest, same features, 200 trees, same block folds) to tell can't-measure non-water pixels from labelled pixels. Report its ROC-AUC as `domain_auc` (0.5 = same kind of ground, near 1 = very different).
  2. Weight each test pixel by `w = P(target|x) / (1 − P(target|x))`, clipped to [0.1, 10].
  3. Report weighted balanced accuracy for the model and for the nearest-neighbour baseline.
- **Applicability coverage:** the share of can't-measure non-water pixels inside the domain (§3.6). Report it; Part 4 states it in the UI.
- **Metrics:** balanced accuracy (primary), ROC-AUC, Brier score, expected calibration error (10 equal-count bins), reliability curve data for the UI. Block-bootstrap intervals.
- **[stretch] Gap-shaped hold-out:** hold out patches with the size distribution of real can't-measure gaps, so the nearest-neighbour baseline is as strong as it will be in use (most gaps sit 40–200 m from measured pixels).

### 3.5 Decision rule (pre-registered)

Evaluate in the order fail → pass → partial, so every result gets exactly one status.

| Status | Condition | UI consequence |
|---|---|---|
| **fail** | mean balanced accuracy over repeats ≤ `BA_NN` or ≤ 0.5, **or** ECE > 0.15 | not shown; tool states "Ground prediction did not beat a simple baseline" |
| **pass** | balanced accuracy ≥ `BA_NN` + 0.05 (mean over repeats), > 0.5 in ≥ 4 of 5 folds (median over repeats), ECE ≤ 0.10, **and** weighted balanced accuracy ≥ weighted `BA_NN` | layer shown, labelled *predicted* with confidence |
| **partial** | everything else (beats `BA_NN` by < 0.05, ECE 0.10–0.15, or loses on the weighted comparison) | **not shown on the map**; test appears in "How do we know?" |
| **pending / not_run** | labels not ready / minimum data unmet | "pending" with reason, never a fake |

The tool must say which status it has in `eval.json` and the manifest (Part 5/6 read it).

### 3.6 Per-pixel confidence

For prediction pixel *q* (only where Model A = can't measure, not water):

1. **Applicability domain:** standardise features with training mean/SD. `dist_q` = mean distance (in feature space) to its 10 nearest training pixels. Reference quantiles `d50`, `d80`, `d95` of the same statistic for training pixels, computed leave-one-block-out. Also outside the domain if any continuous feature is outside its training P1–P99.
2. **Confidence from domain distance:** **high** if `dist_q ≤ d50`, **medium** if `≤ d80`, **low** if `≤ d95`, otherwise outside the domain (code 255, "not enough data").
3. **P itself carries the uncertainty.** It is shown as is; Part 4 describes P in 0.35–0.65 as "uncertain (about even chance)". A calibrated 0.5 is an answer, not missing data. (Tree-vote spread is dropped: with averaged leaf probabilities it mostly restates P.)

`ground_pred_conf.tif` uint8: `0` low, `1` medium, `2` high, `255` not enough data / outside domain. Part 4 shows low as "not enough data".

### 3.7 Plain-language feature importance

Permutation importance on held-out blocks (not impurity importance), permuting each group together: *wetness* (wetness index, water occurrence, distance to water), *vegetation*, *terrain* (elevation, slope, roughness), *coast*, *geology*. Output top three groups, with direction taken from **accumulated local effects (ALE)** rather than partial dependence (the wetness features are strongly correlated, and partial dependence averages over combinations that don't occur). Copy template:

> "The model leans most on {group1}, then {group2}. Wetter, lower, vegetated ground was more often degrading where radar could measure it."

(Replace the second sentence with whatever the data actually shows.)

### 3.8 Reindeer Point consistency check

- `m_A` = share of confident Reindeer Point pixels measured as degrading (Model A), as a percentile among AOI 2 km blocks.
- `p_B` = mean predicted `P(degrading)` over Reindeer Point where radar can't measure, as a percentile among AOI blocks.
- Report both. Status: `consistent` if both are above the AOI median; `mixed` if one is; `not consistent` if neither; `not_available` if Model B did not pass or no Reindeer Point pixel is inside the domain.
- Always append: "Radar labels come from the same area, so this is a consistency check, not proof." Public reports (Canadian Geographic, Oct 2026) are cited by Part 4.

### 3.9 Limits (UI copy)

> Wet tundra is where radar fails most and where the model has fewest examples, so predictions there are often marked "not enough data". Ground ice is only moderately predictable from the surface. This is a screen for where to drill, not a verdict.

---

## 4. Model C: shoreline arrival years (predicted)

All geometry is computed in EPSG:32608.

### 4.1 Transects

- **Baseline:** smooth the 2025 shoreline with a 200 m moving average. For each contiguous stretch, offset it seaward by `max(150 m, d_max + 50 m)`, where `d_max` is the largest seaward distance from the smoothed 2025 line to any historical shoreline in that stretch. Every historical shoreline then lies landward of the baseline. (A fixed 150 m fails wherever retreat has averaged more than about 1.9 m/yr since 1947.) Store `baseline_offset_m`.
- **Spacing:** 50 m along the baseline. Transects perpendicular to the smoothed baseline.
- **Length:** from the baseline to 600 m inland of the 2025 shoreline; extend to 1,000 m wherever a named area edge lies farther inland. On Tuk Island, stop at the opposite shore.
- **Crossings:** on tight curves, neighbouring transects can cross. If the crossing point lies landward of every shoreline plus the largest arrival distance, shorten both transects there; otherwise drop the later one and flag `crossing: true`.
- **Shore type:** `shore_type ∈ {open, spit, island, sheltered}` from the shore-type polygons (§1). Spits and islands migrate rather than simply retreat, so their arrival ranges are marked low confidence. If no polygons are available, hand-flag Tuk Island and the harbour spits.
- **IDs:** `T0001…`, ordered from the west end. Store start and end coordinates (EPSG:4326) and the baseline azimuth.
- **Coverage:** every shoreline stretch inside the AOI (sea, and lake shorelines if Part 1 supplies them; sea only for the weekend).

### 4.2 Position per date per transect

`x_{j,k}` = distance (m) from the baseline to the shoreline *k* along transect *j*, positive landward (retreat increases `x`).

- Intersect each dated shoreline line with each transect. If multiple intersections, take the one nearest the previous date's position; if none, `NaN` for that date.
- **One shoreline definition in every fit.** Part 1 chooses bluff top or waterline **[unconfirmed]**. A source that cannot deliver that definition (e.g. Landsat at 30 m cannot resolve a bluff top) becomes a **check epoch**: positions are computed and reported but not used in rate fits or pass/fail. There is no source-bias term: in this record source and era coincide, so a bias term cannot be separated from a change in rate.
- Combined position error for date *k*: `σ_k = sqrt(σ_reg² + σ_dig² + σ_def² + σ_env²)`:

| Source | σ_reg | σ_dig / pixel | σ_def (shoreline definition) | σ_env (storm/tide) |
|---|---|---|---|---|
| NRCan air-photo mosaic | per-mosaic RMSE vs fixed features (Part 1), start 8 m | 3 m | 5 m | 5 m |
| Landsat (30 m) | 6 m | 15 | 5 | 5 |
| Sentinel-2 (10 m) | 3 m | 5 | 5 | 5 |

Use `position_error_m` from `shorelines.geojson` where Part 1 supplies it; otherwise these starting values **[unconfirmed]**. Registration error is shared by every transect on the same date, so errors are correlated along the shore; §4.4 therefore reports per epoch.

- **[stretch]** Bluff tops from ArcticDEM strips (2 m, 2010s onward) to add same-definition recent dates.

### 4.3 Rate estimators

For transect *j* with fit-eligible dates `t_k` (years) and positions `x_k`:

```
x(t)    = a + r·(t − t̄_w)                         t̄_w = weighted mean date (a and r uncorrelated)
w_k     = 1 / (σ_k² + σ_proc²)
σ_proc² = smallest value ≥ 0 that brings reduced χ² down to ≤ 1    (storm-driven scatter beyond measurement error)
SE(r)   = sqrt( 1 / Σ w_k (t_k − t̄_w)² )
SE(a)   = sqrt( 1 / Σ w_k )
```

Two estimator types: **long** (all fit-eligible dates in its window) and **recent** (dates from a later start).

**Selection (pre-registered, one choice for the whole AOI):**
- Fit on dates ≤ 2004: long = 1947–2004; recent = 1985–2004 (≥ 3 dates; otherwise that transect uses long).
- Predict every fit-eligible epoch in 2005–2025. The type with the lower median absolute error across transects becomes the *central* estimate; ties go to recent (retreat has sped up).

**Future rates (used for arrival years):**
- long = WLS on 1947–2025; recent = WLS on dates ≥ 2005 (≥ 5 dates; otherwise long). Protected transects use dates before 2023 only (§4.6).
- central = the selected type; other = the remaining type.

Smooth rates along-shore with a 5-transect (250 m) median to damp noise, but keep the unsmoothed values in the file.

### 4.4 Hindcast (primary test)

- **Fit:** long estimator on fit-eligible dates ≤ 1985 (air photos 1947–1985; at least 3 dates required per transect, else transect flagged `hindcast: false`).
- **Predict:** positions at every later fit-eligible epoch. Check epochs are reported separately and do not count toward status.
- **Error per transect and epoch:** `e = x_pred − x_obs` (m). Bias = mean `e`, MAE, RMSE across transects at each epoch and overall, and against lead time.
- **Baselines:** (a) persistence: last training position, zero retreat; (b) regional mean rate: the AOI-median training rate applied to every transect. Persistence is weak on a retreating coast (any positive rate beats it); the regional rate is the baseline that matters.
- **90% prediction interval:** `x_pred ± 1.645·sqrt(σ_obs² + σ_proc² + SE(a)² + (t − t̄_w)²·SE(r)²)`.
- **Coverage:** per epoch, the share of transects whose observation lies inside the interval. Transects on one date are not independent, so the status uses the **median of per-epoch coverage**.
- **Lead-time inflation:** at each epoch, `k = P90(|e|) / median(interval half-width)`. If `k > 1` at the longest lead, `SE(r)` is multiplied by `k` for arrival years. Record as `model_c.interval_inflation`.

Evaluate in the order fail → pass → partial:

| Status | Condition |
|---|---|
| **fail** | beats persistence MAE at fewer than 2 later epochs, or median coverage < 0.60 |
| **pass** | beats regional-mean MAE (and persistence) at ≥ 2 later epochs, and median coverage ≥ 0.80 |
| **partial** | everything else (coverage 0.60–0.80, or beats persistence but not the regional mean at ≥ 2 epochs) |

Expect underprediction late (acceleration). If bias shows the model systematically underpredicts retreat, compute `b = −median(bias) / median(observed retreat over the lead time)` at the longest lead, report it, and **widen** future ranges with it (§4.5) rather than hide it.

Report overall: "Fitting on 1947–1985 predicted shoreline position {N} years later to within {MAE} m on average."

### 4.5 Arrival-year ranges

Per transect and per distance `D` inland of the 2025 shoreline position, `D ∈ {25, 50, 100, 200, 400}` m (plus named-area distances: from each Part 4 area's polygon edge to nearest shoreline, along the transect).

Monte-Carlo (10,000 draws, seeded):

1. **Pick a rate component:** central (0.7) or other (0.3). If `b > 0` (§4.4): central 0.5, other 0.3, accelerated 0.2, where accelerated = `r_central·(1 + b)`. Draw `r ~ Normal(r_component, (k·SE_component)²)`.
2. **Floor:** set any draw below 0.01 m/yr to 0.01 m/yr (avoids dividing by zero). Count draws ≤ 0.05 m/yr for the first rule below.
3. **Current shoreline offset** `δ ~ Normal(0, σ_now²)`, where `σ_now` = position error of the latest shoreline.
4. **Arrival year** `T = 2025 + max(D + δ, 0) / r`.
5. **Likely range** = 10th–90th percentile of `T`. Round `lo` **down** and `hi` **up** to 5 years, so the range is always at least 5 years wide.

Rules (first match wins):

| Condition | Wording | Stored |
|---|---|---|
| `P(r ≤ 0.05 m/yr) > 0.5`, or 10th percentile > 2100 | "not expected before 2100" | `lo: null, hi: null, arrival_not_before: 2100` |
| 90th percentile > 2100 | "from {lo}, possibly after 2100" | `hi: null` |
| otherwise | "between {lo} and {hi}" | `lo`, `hi` |

- Never report a single year.
- Spit and island transects carry `low_confidence: true`.
- The UI horizon (10–40 yr) is applied by Part 4: transect/area is "within horizon" if `arrival_lo ≤ 2026 + horizon`.

### 4.6 Protection works (2023–2025)

- Part 1 supplies protected stretches (polygons or intervals). Flag transects intersecting them `protected: true`.
- Rate uses data **before** protection installation only (`t < 2023`), and the arrival range is stated as "unprotected trend". The model does not simulate the protection.
- UI note: "Shore protection built in 2023–2025 may slow retreat; this range assumes it is absent."

### 4.7 What it cannot see (UI copy)

> The shoreline range is a trend, not a forecast of single storms. It does not capture sudden collapse of ice-rich bluffs, thaw slumping, or changes to the coast from protection works.

---

## 5. Output files and schemas

All rasters: GeoTIFF, LZW compressed, computed on the EPSG:32608 grid. Published copies are reprojected to EPSG:4326 for the web layer (nearest-neighbour for uint8, bilinear for float32).

| File | dtype | Encoding |
|---|---|---|
| `behaviour.tif` | uint8 | 0 can't measure, 1 stable, 2 seasonal only, 3 degrading, 255 nodata (water/outside) |
| `behaviour_conf.tif` | uint8 | 0–100 (`conf×100`); 255 nodata |
| `E.tif` | float32 | cm per √(°C·day), positive = sinks; NaN where undefined; values are relative (E′ is also written as `E_rel.tif`) |
| `E_se.tif` | float32 | `SE(E)`, same units; used by §2.7 |
| `E_slope.tif` | float32 | per year; NaN if undefined |
| `late_season.tif` | float32 | `L′`, cm excess sinking relative to the reference patches (positive = excess); NaN if undefined |
| `ground_pred.tif` | float32 | P(degrading) 0–1, **only where Model A = can't measure** and domain passes; NaN elsewhere |
| `ground_pred_conf.tif` | uint8 | 0 low, 1 medium, 2 high (from domain distance), 255 not enough data / outside domain |

### `expected.json`

```json
{
  "schema": "expected/2",
  "stack_id": "nisar_t159",
  "season": 2026,
  "latest_pass": "2026-09-17",
  "season_closed": false,
  "reference_passes": ["2026-06-25", "2026-07-07"],
  "tdd_at_latest": 612.4,
  "A_latest": 24.75,
  "A_ref": 9.8,
  "sensor_gain": {"g": 0.84, "method": "huber_block_median", "calibration": "outside named areas + 500 m",
                  "n_blocks": 310, "status": "applied", "p108_ratio": null},
  "noise": {"sigma_cm": 0.6, "source": "part2"},
  "mode": "magnitude",
  "relative_to": "rest of mapped area this season",
  "pixel_flag_rule": "z < -2",
  "area_flag_rule": ">=30% pixels flagged and median z < -1.5, two consecutive passes",
  "notes": [],
  "areas": [
    {"id": "reindeer_point", "n_pixels": 212, "share_flagged": 0.34,
     "median_z": -1.7, "consecutive_passes_flagged": 2, "flag": true,
     "observed_cm": -3.1, "expected_cm": -1.9, "provenance": "modelled"}
  ]
}
```
`mode` is `"magnitude"` or `"ordering_only"` (when gain cannot be fitted).

### `transects.geojson` (one feature per transect)

```json
{
  "type": "Feature",
  "geometry": {"type": "LineString", "coordinates": [[-133.0291, 69.4412], [-133.0262, 69.4381]]},
  "properties": {
    "id": "T0123",
    "n_dates": 9, "n_fit_dates": 7,
    "definition": "bluff_top",
    "shore_type": "open", "crossing": false,
    "baseline_azimuth_deg": 214, "baseline_offset_m": 190,
    "rate_long_m_yr": 1.4, "rate_recent_m_yr": 2.1, "rate_central_m_yr": 2.1,
    "rate_se_m_yr": 0.3, "sigma_proc_m": 4.0, "rate_estimator": "recent",
    "hindcast": {"fit_to": 1985, "n_epochs": 4, "mae_m": 14.2, "bias_m": -9.0, "within_90pi": 0.75},
    "protected": false,
    "low_confidence": false,
    "arrival": {
      "25":  {"lo": 2030, "hi": 2045, "text": "between 2030 and 2045"},
      "100": {"lo": 2045, "hi": 2080, "text": "between 2045 and 2080"},
      "200": {"lo": 2070, "hi": null, "text": "from 2070, possibly after 2100"}
    },
    "provenance": "modelled"
  }
}
```

### `eval.json`

```json
{
  "schema": "eval/2",
  "generated_at": "2026-11-15T20:00:00Z",
  "prereg_tag": "prereg-eval",
  "deviations": [],
  "model_a": {
    "test_a": {
      "status": "partial", "n_pixels": 5120, "n_blocks": 61,
      "metrics": {
        "skill_vs_best_baseline": {"value": 0.18, "ci95": [0.05, 0.29]},
        "rho_block": {"value": 0.74, "ci95": [0.62, 0.83]},
        "kappa": {"value": 0.33, "ci95": [0.24, 0.41]}
      },
      "baselines": {"zero_motion_rmse_cm": 1.9, "sqrt_time_rmse_cm": 1.6, "avg_warmth_rmse_cm": 1.52, "model_rmse_cm": 1.45},
      "warmth_skill": 0.09,
      "warmth_anomaly_z": {"2024": 0.4, "2025": -0.2},
      "noise_ceiling": {"R1": 0.62, "R_train": 0.91, "rho_ceiling": 0.75, "rho_over_ceiling": 0.99},
      "loyo_rho_range": [0.58, 0.79],
      "conf_check": {"high": 0.86, "medium": 0.71, "low": 0.55, "ordered": true},
      "notes": "2024-25 coherence lower (single satellite); shortfall consistent with noise. Status unchanged."
    },
    "test_b": {"status": "pass",
               "metrics": {"rho_block": {"value": 0.66, "ci95": [0.51, 0.77]}, "kappa": {"value": 0.34, "ci95": [0.22, 0.45]}},
               "area_order": {"pairs_agreeing": 2, "of": 3, "counts_toward_status": false}},
    "trend_only_degrading_share": 0.04,
    "rain_check": {"rho_late_excess_vs_rain": 0.31, "n_seasons": 6},
    "robustness": {"without_2021_same_class_share": 0.93, "ref_shift_class_change_share": 0.06},
    "sensitivity": {"cluster_vs_rules_kappa": 0.52}
  },
  "model_b": {
    "status": "pending",
    "reason": "Model A labels not final",
    "metrics": null, "baselines": null,
    "weighted": {"ba_model": null, "ba_nn": null},
    "domain_auc": null,
    "applicability_coverage": null,
    "n_labels": {"degrading": null, "not_degrading": null}
  },
  "model_c": {
    "status": "pass", "n_transects": 612,
    "selected_estimator": "recent",
    "metrics": {"mae_m": 21.3, "rmse_m": 29.8, "bias_m": -8.6, "coverage_median_epoch": 0.84},
    "baselines": {"persistence_mae_m": 47.5, "regional_rate_mae_m": 28.1},
    "by_epoch": [{"date": "2004", "mae_m": 12.0, "coverage": 0.90}, {"date": "2023", "mae_m": 33.4, "coverage": 0.78}],
    "check_epochs": [{"source": "landsat", "n_dates": 6, "mae_m": 26.0}],
    "interval_inflation": 1.15,
    "acceleration_b": 0.12
  },
  "reindeer_point_consistency": {"status": "not_available", "reason": "Model B pending", "note": "consistency check, not proof"},
  "limits": ["Block scale, not houses", "Thaw season only", "Motion is relative to a reference area"]
}
```

Every test uses exactly one of `pass | partial | fail | pending | not_available` (Reindeer Point: `consistent | mixed | not consistent | not_available`). Never write `pass` for something not run.

---

## 6. Config keys (`config.yaml` additions)

```yaml
models:
  seed: 0
  crs: {compute: "EPSG:32608", publish: "EPSG:4326"}
  tdd:
    onset_search_from: "04-01"
    onset_min_run_days: 3
    snow_off_run_days: 5
    freeze_search_from: "08-15"
    freeze_min_run_days: 3
    max_filled_share: 0.10
    max_gap_days: 7
    bias_correct_filled: true
  behaviour:
    train_years: [2018, 2019, 2020, 2021, 2022, 2023]
    test_a_years: [2024, 2025]
    test_b: {stack_id: nisar_t159, season: 2026}
    min_dates_per_season: 5
    min_A_span: 8.0                 # sqrt(degC*day) [tune on training]
    min_seasons: 4
    min_seasons_high_coh: 3         # published map only
    season_weight_cap: 2.0
    late_md: "08-10"
    late_A_share: 0.25
    min_early_dates: 4
    late_k_multi: 2.0
    late_k_single: 3.0
    coh_min: {C: 0.30, L: 0.25}
    coh_good: {C: 0.60, L: 0.50}
    valid_share_min: 0.6
    E_floor_cm_per_season: 1.0
    slope_alpha: 0.10
    slope_fdr_q: 0.10
    slope_min_change_share: 0.25
    conf_bins: {high: 0.70, medium: 0.45}
    single_season_conf_cap: 0.69
    temp_low_conf_factor: 0.85
    bootstrap: {n: 1000, block_m: 500}
  expectation:
    pixel_z: -2.0
    area_share: 0.30
    area_median_z: -1.5
    consecutive_passes: 2
    min_passes: 3
    gain_bounds: [0.3, 3.0]
    named_area_buffer_m: 500
    gain_block_m: 500
  ground_pred:
    block_km: 2.0
    folds: 5
    repeats: 5
    origin_shift_m: 400
    buffer_m: 500
    min_labels_per_class: 300
    min_blocks_per_class: 15
    min_test_degrading: 30
    calibration: sigmoid
    domain_weight_clip: [0.1, 10]
    domain: {k: 10, quantiles: [0.50, 0.80, 0.95], feature_range: [1, 99]}
  shoreline:
    spacing_m: 50
    smooth_m: 200
    inland_m: 600
    inland_long_m: 1000
    seaward_min_m: 150
    seaward_margin_m: 50
    hindcast_fit_to: 1985
    hindcast_min_dates: 3
    select_fit_to: 2004
    select_recent_from: 1985
    select_recent_min_dates: 3
    recent_from: 2005
    recent_min_dates: 5
    protection_cutoff_year: 2023
    smooth_transects: 5
    r_floor_m_yr: 0.01
    r_none_m_yr: 0.05
    mc_draws: 10000
    mix: {central: 0.7, other: 0.3}
    mix_accel: {central: 0.5, other: 0.3, accelerated: 0.2}
    percentiles: [10, 90]
    round_years: 5
    horizon_cap_year: 2100
  thresholds:   # frozen at tag prereg-eval
    test_a: {skill_pass: 0.25, skill_partial: 0.0, rho_pass: 0.70, rho_partial: 0.50, kappa_pass: 0.40, kappa_partial: 0.25}
    test_b: {rho_pass: 0.60, rho_partial: 0.40, kappa_pass: 0.30, kappa_partial: 0.15}
    ground_pred: {margin_over_nn: 0.05, ece_pass: 0.10, ece_partial: 0.15, min_folds_above_chance: 4}
    shoreline: {coverage_pass: 0.80, coverage_partial: 0.60, min_epochs_beating: 2}
```

---

## 7. Failure handling

| Situation | Behaviour |
|---|---|
| Temperature gap > 7 days in a season | Exclude season; log; Model A continues with remaining seasons |
| No snow data for a season | Onset from air temperature only; `onset_source: "air_temp"` |
| Radar dates after freeze-back | Excluded from Model A fits; `expected.json.season_closed = true` |
| Fewer than 4 seasons for a pixel | Short-record rules (§2.4b); `E_slope = NaN`; confidence reduced via `c_n` |
| NISAR gain cannot be fitted | `expected.json.mode = "ordering_only"` |
| Model B labels too few | `status: not_run`, no raster |
| Model B test fold has < 30 degrading pixels | 4 folds for that repeat; recorded |
| Model B fails or partial | Raster not written; eval records why |
| Transect has < 3 pre-1985 dates | `hindcast: false`; rate from all dates; flagged in output |
| Transects cross | Shortened, or dropped with `crossing: true` |
| Source cannot deliver the chosen shoreline definition | Check epoch only; not used in fits or status |
| Rate ≤ 0 within uncertainty | Arrival reported as "not expected before 2100" |
| Empty or all-NaN output raster | Pipeline raises; Part 5's validation gate keeps last good data |

---

## 8. Unconfirmed items (resolve before coding)

1. Part 2 supplies per-pixel valid-date counts and noise per season (else §2.3 computes them).
2. Coherence thresholds (`coh_min`, `coh_good`): tune on Part 2's 2018–2023 histograms only.
3. Zwieback & Meyer (2021) DOI.
4. Whether `E_ref` patches are the same list used by Part 2's reference.
5. The shared grid is UTM 8N (EPSG:32608), agreed with Parts 1 and 2.
6. Snow depth and rainfall source (Part 1), or satellite snow-off fallback.
7. Position error values for air-photo mosaics (Part 1 registration RMSE).
8. Shoreline definition (bluff top vs waterline), which sources can deliver it, and whether lakeshores are in scope.
9. Shore-type polygons (spits, Tuk Island, sheltered stretches).
10. Variogram range for the Model B block size.
11. Protected-stretch polygons and installation dates (Part 1).
12. Whether S-1 p108 2026 is processed in time for the sensor-versus-sensor check.
13. Whether the 2025 p137 stack includes Sentinel-1C (6-day revisit).
14. Path of the named-area polygons (Part 4).

---

## 9. Plain-language copy for Part 6 (reuse)

- **Behaviour legend:** "Stable: little movement in any summer. Seasonal only: settles each summer with warmth, no sign of worsening. Degrading: keeps sinking late in the season or sinks more each year. Can't measure: radar signal too noisy; this is not the same as stable."
- **Predicted ground:** "Predicted (moderate confidence): where radar can't measure, a model estimates ground condition from terrain, water and vegetation. It was tested on areas it hadn't seen."
- **Predicted ground coverage:** "Predictions cover {share}% of the ground radar can't measure. The rest is too unlike anywhere radar could measure to predict."
- **This-season flag:** "Flags compare each area with the rest of the mapped area this summer. A summer that is unusual everywhere will not show up as a flag."
- **Shoreline:** "The coast is expected to reach this distance between {lo} and {hi}. Tested by predicting where the coast was after fitting only on 1947–1985."
- **Not shown message:** "Ground prediction did not beat a simple baseline in testing, so it is not shown."

---

## 10. After the weekend [stretch]

- **Net multi-year subsidence.** Each season is zeroed, so ground that sinks and does not recover over winter (the most direct sign of thawing ground ice) is invisible. Ask Part 2 whether year-to-year pairs (late June to late June) keep coherence on dry or gravel ground; L-band (NISAR, from 2026) should do better.
- Gap-shaped hold-out for Model B (§3.4).
- ArcticDEM bluff tops for Model C (§4.2).
- Second driver (§2.8).
- Three-class Model B; gradient-boosting comparison.
- Correcting soil-moisture phase bias, instead of only reporting the rain check.
