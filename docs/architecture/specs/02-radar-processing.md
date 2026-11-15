# Part 2 spec: Radar processing

`docs/architecture/specs/02-radar-processing.md` · Ground Check · Team Devotion · drafted 14 Nov 2026

## 0. Summary

This part turns radar pairs from two satellites into one product per stack: **vertical ground motion in centimetres at every usable date of each thaw season, on the shared grid, with a quality score per cell.**

The chain for one stack and one season:

1. Read each pair.
2. Mask bad pixels.
3. Convert phase to line-of-sight centimetres with an explicit sign.
4. Warp onto the shared grid.
5. Re-reference every pair to one common area (the airport gravel).
6. Drop unwrapping errors with a closure test.
7. Solve for displacement per date by least squares.
8. Convert to vertical.
9. Write GeoTIFFs and `index.json`.

**One structural fact drives most of the design.** NISAR only publishes nearest-neighbour (12-day) GUNW products ([NISAR GUNW docs](https://nisar-docs.asf.alaska.edu/gunw/)). So NISAR has **no second-nearest pairs**: its "network" is a single chain, there is no redundancy, closure tests are impossible, and a pixel lost in one pair loses every later date. Sentinel-1 has n+1 and n+2 pairs (`pairs.neighbours: [1, 2]`), so it gets a real least-squares inversion and closure checks. The spec treats the two sensors with the same code path, but the outcomes differ, as described in §7.

New code goes in **new files** (proposed `src/radar_read.py` and `src/radar_stack.py`). `process.py` stays untouched so the v1 web export keeps working until Part 6 moves to v2.

---

## 1. Reading the inputs (A1, A2)

### 1.1 Matching pairs to files

The source of truth is `data/interim/granules.csv` (`source, stack_id, season, ref_date, sec_date, path, frame, flight_dir, id, url`).

| Stack | Where the files are | How to match a row to a file |
|---|---|---|
| `s1_p137`, `s1_p108` | `data/raw/s1/<job_id>/<product_name>/<product_name>_*.tif` (`hyp3_submit.py --download` unzips into a folder per job) | Product name starts `S1xy_YYYYMMDDTHHMMSS_YYYYMMDDTHHMMSS_...`. Parse both dates and match to `ref_date` and `sec_date` of a row with `source == "S1"`. Paths 137 and 108 never share a date, so the match is unique. Glob with `**/*_unw_phase.tif`. |
| `nisar_t159` | `data/raw/nisar/<id>.h5`. This is the **AOI-cropped** copy written by `fetch_nisar.py`, with the same internal paths as a full GUNW. | `<id>` equals the `id` column. |

**Duplicate NISAR versions.** After matching, assert that `(ref_date, sec_date)` is unique per stack. If it isn't, keep one file according to `nisar.version_preference: [PR, UR]` (highest `_00N` within a type) and record the dropped id in `index.json` (`pairs[].dropped_duplicates`).

### 1.2 Sentinel-1 (HyP3 INSAR_GAMMA, 80 m, UTM GeoTIFFs)

`hyp3_submit.py` requests `include_inc_map`, `include_look_vectors`, `include_dem` and `include_displacement_maps`, with `apply_water_mask=False`. Each product folder therefore holds:

| File | Content | Units | Used for |
|---|---|---|---|
| `*_unw_phase.tif` | unwrapped phase, referenced to one pixel | radians | the measurement |
| `*_corr.tif` | coherence | 0–1 | masking, quality |
| `*_water_mask.tif` | water mask (delivered even though it wasn't applied during unwrapping) | 0/1 | fallback water mask |
| `*_lv_theta.tif` | look-vector elevation angle | radians | incidence angle |
| `*_lv_phi.tif` | look-vector orientation | radians | not needed (stretch: asc+desc decomposition) |
| `*_inc_map.tif` | incidence-angle map | radians | cross-check of incidence |
| `*_los_disp.tif`, `*_vert_disp.tif` | HyP3's own displacement maps | metres | **sign check only** |
| `*_dem.tif` | DEM used | metres | slope flag fallback |
| `*.txt` | parameter file, including the **reference point** (map and SAR coordinates) | n/a | logging the HyP3 reference |

**Two facts about HyP3 that matter:**

- Unwrapping starts from the **highest-coherence pixel**, and that pixel's coordinates are written to the `.txt` file. Every pair therefore has its own zero, which is why §4 re-references.
- The HyP3 readme states that **the sign convention of the unwrapped phase is opposite to that of the displacement maps** ([hyp3-gamma v5.4.1 changelog](https://zenodo.org/records/6629125)). We never trust either sign without the test in §2.2.

**Trap:** HyP3 GeoTIFFs use `0` as nodata. The HyP3 reference pixel has a phase of exactly 0, so it will read as nodata. That's harmless (one pixel), but never use that pixel in a check.

### 1.3 NISAR (L2 GUNW, 80 m, HDF5, cropped by Part 1)

Paths, with `G = science/LSAR/GUNW/grids/frequencyA/unwrappedInterferogram` (`nisar.grid_group`):

| Path | Content | Units / fill |
|---|---|---|
| `G/HH/unwrappedPhase` | unwrapped phase | radians; **no fill value defined in spec** → mask with conncomp |
| `G/HH/coherenceMagnitude` | coherence | 0–1; fill NaN |
| `G/HH/connectedComponents` | unwrapping regions | int; fill 255; 0 expected to mean "not unwrapped" (SNAPHU/ISCE convention, **verify**) |
| `G/HH/ionospherePhaseScreen` | ionosphere estimate, **not applied** to the phase | radians; fill NaN |
| `G/mask` | byte flags (layover/shadow, quality); bit meanings not documented | fill 255 |
| `G/xCoordinates`, `G/yCoordinates` | **pixel-centre** coordinates | metres in the projection |
| `G/projection` | EPSG code as a scalar | n/a |
| `science/LSAR/GUNW/metadata/radarGrid/incidenceAngle` | 3-D cube (height, y, x) on a coarse grid | degrees (**verify**) |
| `.../radarGrid/losUnitVectorX`, `losUnitVectorY` | east and north LOS components (up = √(1−X²−Y²)) | unitless |
| `.../radarGrid/heightAboveEllipsoid`, `xCoordinates`, `yCoordinates` | cube axes | m |
| `science/LSAR/identification/*` | dates, track, direction, ids | n/a |

Sources: NISAR GUNW product spec D-102272 §5.3 ([PDF](https://nisar.asf.earthdatacloud.nasa.gov/NISAR-SAMPLE-DATA/DOCS/NISAR_D-102272_L2_GUNW_Product_Spec_R3.4_231109_clean_w-sigs.pdf)) and the [NISAR GUNW data catalogue](https://www.earthdata.nasa.gov/data/catalog/asf-nisar-l2-gunw-provisional-v1-1).

**Coordinates location (unconfirmed).** The product spec lists `xCoordinates`, `yCoordinates` and `projection` **under `G/HH/`**, while `fetch_nisar.py` and `config.yaml` read them from `G/`. If `fetch_nisar.py` succeeds, the real files have them at `G/` and nothing changes. If it fails with a `KeyError` on `xCoordinates`, that's a Part 1 fix (read from `G/HH/`). The Part 2 reader should try `G/` first, then `G/HH/`.

**Confirming paths on a real file** (there's no `inspect_h5.py` in the repo, and we don't need one; this one-liner prints the whole tree):

```bash
python -c "import h5py,sys; h5py.File(sys.argv[1],'r').visititems(lambda n,o: print(n, getattr(o,'shape',''), getattr(o,'dtype','')))" data/raw/nisar/<id>.h5
```

Also print `np.unique(conncomp)`, `np.unique(mask)`, the `units` attribute of `incidenceAngle`, and the ionosphere layer's attributes. Paste the output into §16.

**Grid transform.** Coordinates are pixel centres, so the transform needs a half-pixel shift:

```python
dx, dy = x[1] - x[0], y[0] - y[1]                       # dy > 0 (y decreases downwards)
transform = from_origin(x[0] - dx/2, y[0] + dy/2, dx, dy)
```

(`process.py` omits the half pixel, which shifts NISAR by about 40 m.)

---

## 2. Phase to displacement and the sign (A3)

### 2.1 Formula

Our internal convention is **positive = moving toward the satellite** (in LOS), which becomes **positive = up** after conversion to vertical. So the project rule "negative = sinking" falls out naturally.

```
d_los_cm = s · φ · λ / (4π) · 100
```

| Stack | λ (m) | cm per radian | One cycle (2π) in LOS = λ/2 | Expected `s` |
|---|---|---|---|---|
| Sentinel-1 | 0.0555 | 0.4417 | 2.775 cm | −1 (verify) |
| NISAR | 0.2384 | 1.897 | 11.92 cm | −1 (verify) |

`s` lives in config per sensor (`radar.phase_sign`), so a flipped sign is a one-line change, never a code edit.

### 2.2 Verification test (do it on one pair per sensor before anything else)

**Sentinel-1: compare with HyP3's own map (decisive).**
1. Compute `d_ours = s · unw_phase · λ/(4π)` in metres, with `s = −1`.
2. Over pixels with coherence ≥ 0.5 that aren't water, fit `los_disp = a · d_ours + b` (use `np.polyfit`, or a median of ratios to be robust).
3. Expect **a = +1.00 ± 0.01**. If a ≈ −1, set `s = +1`. If |a| isn't ≈ 1, the wavelength or units are wrong: stop.
4. HyP3 documents its displacement maps as **positive = toward the satellite** (uplift). That's to be confirmed in the product README inside the folder. If the README says otherwise, flip the meaning, not the test.

**Both sensors: physical check (independent of documentation).**
1. Take a mid-July pair. After re-referencing to the airport (§4), compute the median LOS change over undisturbed tundra (land, not water, not town, coherence ≥ threshold).
2. Thawing tundra sinks, so expect a **negative** median, typically −0.1 to −1 cm per 12 days. If most pairs in July–August come out positive, the sign is flipped.
3. Caveat: a single pair can be dominated by atmosphere or ionosphere, so judge on the sum of all July–August pairs once available.

**NISAR: cross-sensor check.** Correlate the NISAR 2026 season map with the Sentinel-1 2025 season map (both vertical, same reference) over cells valid in both, aggregated to 500 m blocks. The ground pattern from year to year is similar, so Pearson r must be **positive**. A clearly negative r means NISAR's sign is flipped.

Record the outcome in `index.json → phase_to_los_sign` and `sign_check`.

---

## 3. The processing chain (numbered steps)

Per stack, per season. Each step lists its input and output.

| # | Step | Input | Output |
|---|---|---|---|
| 1 | **Inventory**: match `granules.csv` rows to files, deduplicate NISAR, keep pairs whose dates fall inside the season window | granules.csv, `data/raw/` | list of pairs (ref, sec, days, path) |
| 2 | **Read** each pair in its native grid (§1) | pair files | φ, coherence, conncomp (NISAR), iono (NISAR), water, incidence, transform, CRS |
| 3 | **Ionosphere** (NISAR, if enabled): `φ ← φ − φ_iono` (§6) | φ, φ_iono | φ |
| 4 | **Native masks**: coherence < threshold; conncomp ∈ {0, 255} (NISAR); fill values → NaN | φ, coh, cc | φ with NaN |
| 5 | **Phase → LOS cm** with sign `s` (§2) | φ | d_los |
| 6 | **Warp to shared grid** (§9): d_los and coherence bilinear; masks nearest; validity check | native rasters | (H, W) arrays on the shared grid |
| 7 | **Water mask** on the grid (§5) | JRC water occurrence, coast | d_los with water → NaN |
| 8 | **Reference**: subtract the median of d_los over the reference cells; drop the pair if too few reference cells are valid (§4) | d_los, reference mask | re-referenced d_los |
| 9 | **Connectivity flag**: label coherent regions; flag cells not connected to the reference region (§5) | coherence, mask | flag bit 2 |
| 10 | **Season limits**: pick first and last usable dates; drop pairs outside them (§7.2) | coherent fraction per pair, temperatures | trimmed pair list |
| 11 | **Closure test** (S1) or **24-day consistency test** (NISAR): mark suspected unwrapping errors (§5.4) | re-referenced pairs | per-pixel pair validity |
| 12 | **Inversion** per pixel, grouped by validity pattern; split-network handling; residual RMS (§7.1) | valid pairs | d_los(t) per date, rms |
| 13 | **Minimum-valid rule**: NaN for pixels with < 70% of season pairs valid | validity | final mask |
| 14 | **LOS → vertical**: divide by cos θ; flag slopes and bluffs (§8) | d_los(t), θ, slope, coast distance | d_v(t), flags |
| 15 | **Quality layers**: mean coherence, valid-date fraction, noise (§11) | everything above | coh, valid, noise, flags |
| 16 | **Write** outputs with `common.write_tif` plus `index.json` (§10) | arrays | files in `data/interim/motion/<stack_id>/` |
| 17 | **Sanity checks**, logged to `index.json → seasons[].checks` (§11.2) | outputs | pass/fail list |

Steps 1–9 run per pair, steps 10–17 per season. Seasons never touch each other.

---

## 4. Reference (B1)

### 4.1 Why

HyP3 unwraps every pair from its own highest-coherence pixel, and NISAR's absolute level is also arbitrary. Adding pairs with different zeros mixes those offsets into the result. Before anything is combined, **every pair is shifted so the same area reads zero**:

```
d_los_ref(pair) = d_los(pair) − median( d_los(pair)[ reference cells ∩ valid ] )
```

If fewer than `radar.ref_min_valid_cells` (proposed 20) reference cells are valid in a pair, **drop the pair** and log `reason: "reference not coherent"`.

### 4.2 The three options

Tuktoyaktuk has no bedrock, so every choice is "relative to something that also moves a bit".

| Option | Pro | Con | Verdict |
|---|---|---|---|
| **A. Airport gravel** (runway and apron of Tuktoyaktuk / James Gruben Airport, just south of the town core; polygon from OSM `aeroway` via Part 1's services layer) | Thick engineered gravel pad, maintained, high coherence in both bands every summer, same physical place for both sensors, easy to explain | Gravel pads over permafrost can still settle a few mm per season; one area, so its own noise passes into every pixel | **Recommended** |
| **B. Median of all high-coherence pixels** | Automatic, no polygon needed | Most coherent land is thawing tundra, which **sinks every summer**. Making the typical tundra pixel zero hides the main signal, and stable gravel would appear to rise. The reference also changes with each pair's coherence pattern. | Reject as the reference; keep as a diagnostic |
| **C. Several stable-looking patches** | Averages out one patch's local problems | "Stable-looking" has to be chosen from motion, which is circular; it's hard to defend in the pitch | Reject; possible upgrade later if A turns out noisy |

**Recommendation: A, the airport polygon, buffered inward by one cell to avoid edge pixels.** As a check, report every season's motion of the airport relative to option B in `index.json → reference.diagnostics`. If the airport moves more than 1 cm relative to the coherent-land median in a season, warn and look at it.

**What a reader is told:** "Numbers show how much the ground moved **compared with the airport's gravel pad**. If the pad itself settled 0.5 cm, every value on the map is 0.5 cm too high. Differences between areas are reliable; absolute values carry that uncertainty."

**Both sensors share it.** Both frames cover the airport, so NISAR and Sentinel-1 use the same polygon. That's what makes the 2026 comparison (§11.3) meaningful.

**Config:** `radar.reference.polygon` points to a GeoJSON (proposed `data/interim/context/reference_airport.geojson`, digitised from OSM; approximate centre 69.433 N, −133.026 E, **verify on a map**).

---

## 5. Masking (B2)

All masks set cells to NaN. Each one is logged as a count in `index.json → pairs[].masked`.

### 5.1 Coherence threshold, per band

| Band | Proposed threshold | Reason |
|---|---|---|
| C (S1) | **0.30** (current `processing.min_coherence`) | Below about 0.3, phase noise at 80 m multilooking grows fast and MCF unwrapping errors become common. This is the usual Sentinel-1 cut-off for distributed targets. |
| L (NISAR) | **0.35** | The same phase noise in radians is **4.3× more centimetres** at L-band (1.90 vs 0.44 cm per radian), so a slightly stricter cut keeps the centimetre noise comparable. L-band coherence over tundra is usually high, so the coverage loss is small. |

Both are starting values. On the first pair, plot the coherence histogram over land, and adjust if the threshold lands in the middle of the main mode. Config: `radar.coherence_min: {C: 0.30, L: 0.35}`.

**Mean coherence is computed before masking**, so `coh_<season>.tif` shows where data is poor and not just where it survived.

### 5.2 Water (lakes, and sea on three sides)

- **Primary:** Part 1's `data/interim/features/water_occurrence.tif` (JRC, already on the grid). Mask cells with occurrence ≥ **50%**, meaning water in at least half of observations. Add a one-cell buffer for mixed shoreline cells.
- **Sea:** cells seaward of `data/interim/context/coast` (or `distance_to_coast` ≤ 0).
- **Fallback** if Part 1 isn't ready: HyP3 `*_water_mask.tif` for S1. For NISAR, coherence plus the HyP3 mask warped from any S1 pair.
- **Why it matters here:** `apply_water_mask=False` means HyP3 unwrapped across lakes. Phase can jump by a full cycle across a lake, which is why §5.3 exists.

### 5.3 Unwrapping failures

**NISAR.** Keep only cells whose connected component (`conncomp`) is > 0 and ≠ 255. Components are unwrapped independently, so each can carry its own whole-cycle offset. Keep the component that contains most of the reference polygon. Cells in **other** components are kept but flagged (bit 2, "not connected to reference").

**Sentinel-1** (HyP3 GAMMA has no connected-components layer). Build our own:
1. On the shared grid, define good = coherence ≥ threshold, not water.
2. Label the good cells with `scipy.ndimage.label` (8-connectivity). If scipy is missing, it's the only extra dependency, and it's small.
3. The region containing the reference is "connected". Cells in other regions are kept but flagged (bit 2).
4. Regions smaller than 25 cells are masked.

Flagged cells are not deleted, because tundra lakes fragment the coherent area and deleting would throw away a lot of real data. A cell flagged with bit 2 can carry a whole-cycle offset that no test can see. Part 3 and Part 4 should treat it as lower confidence.

### 5.4 Per-pixel error tests

**Sentinel-1: triplet closure.** For each consecutive triplet of dates (i, i+1, i+2) where all three pairs exist, using re-referenced LOS cm:

```
c = d(i,i+1) + d(i+1,i+2) − d(i,i+2)
```

- If |c| > λ/4 (**1.39 cm** for C-band, the equivalent of π radians), one of the three pairs is off by a cycle. **Mark the long pair (i,i+2) invalid at that cell.** Long pairs have lower coherence and are the likelier culprit, and dropping them keeps the chain of short pairs intact.
- Log the fraction of cells failing per triplet (`closure_fail_fraction`).
- Small non-zero |c| (well under λ/4) is noise or soil moisture (§6.3). It feeds the noise estimate.

**NISAR: 24-day pair consistency** (no triplets exist). The 19 Jul → 12 Aug pair is the riskiest. Compare its value with twice the mean of the neighbouring 12-day pairs at the same cell. If the difference is > λ/4 (**5.96 cm**), mark the 24-day pair invalid at that cell. This catches whole-cycle errors (11.9 cm) without needing redundancy.

### 5.5 Minimum valid share

After steps 11–12, a cell needs **≥ 70% of the season's pairs valid** and a network connected from the first usable date (§7.1). Otherwise the whole season is NaN at that cell. Config: `radar.min_valid_pair_fraction: 0.7`. NISAR has only 8 pairs, so 70% means at least 6.

Large masked areas over wet tundra are a **finding to show, not to fill**. Part 3's ground prediction fills them later, labelled "predicted".

---

## 6. Ionosphere, atmosphere and soil moisture (B3)

### 6.1 NISAR ionosphere

- The GUNW includes an ionospheric phase screen that is **not applied** by default.
- Tuktoyaktuk sits under the auroral zone, and L-band is about 18× more sensitive to the ionosphere than C-band (the effect scales with λ²). The ionosphere shows up as a long, smooth ramp across the frame and can reach centimetres.
- **Rule:** correct as `φ_corr = φ − φ_iono` **if** the screen is valid (not NaN) over ≥ 90% of the AOI. Validate on the first pair: fit a plane to `φ` over coherent land, then to `φ_corr`. The ramp across the AOI should **shrink**. If it grows, the sign of the screen is opposite: set `nisar.ionosphere_sign: -1` (that is, add instead of subtract) and re-test.
- If the screen is NaN over the AOI, process uncorrected and log `"ionosphere": "unavailable"`.
- Config: `radar.nisar_apply_ionosphere: true` (pending this test).

### 6.2 Residual atmosphere (both sensors)

- The terrain is nearly flat (0–50 m), so **height-related** tropospheric delay is negligible.
- **Turbulent** water vapour over 31 km remains, typically a few mm to about 1 cm in LOS in an Arctic summer. It grows with distance from the reference, so the highway strip 25 km south gets more of it than the town.
- Referencing removes the constant. A planar ramp would remove more, but real subsidence differences between coast and inland could also look like a ramp, so **no deramping by default**.
- Instead, each pair's best-fit plane across the AOI is logged (`pairs[].ramp_cm`). If a pair's ramp exceeds 2 cm across the AOI, it's flagged for review.
- **Not worth more this weekend.** Weather-model corrections (ERA5 or GACOS) take hours to set up and barely matter at this scale. The noise layer (§11.1) carries what's left.

### 6.3 Soil moisture (mainly an L-band question)

- Wetting soil changes the radar phase without the ground moving. Effects are typically **millimetres**, occasionally up to about 1 cm right after heavy rain. They show up as small non-zero closure (§5.4).
- **The effect reverses when the soil dries**, so it doesn't build up over a season: the seasonal total is affected by millimetres at most.
- **At the centimetre scale we report, it doesn't change the result.** It does make individual dates after heavy rain noisier. If `daily_temperature.csv` includes precipitation, flag dates with > 10 mm in the 3 days before (`dates[].wet_flag`) so Part 3 can down-weight them.

---

## 7. Building the time series (C1, C2)

### 7.1 Least-squares inversion (`numpy`, no MintPy)

The inversion here is about 40 lines of numpy and MintPy's HyP3/NISAR loaders would take longer to get working this weekend, so **no MintPy**.

**Unknowns.** Usable dates `t_0 … t_{N−1}`. Displacement `x_k` at `t_k` with `x_0 ≡ 0` (season starts at zero), so there are N−1 unknowns.

**Design matrix.** One row per valid pair (i, j), i < j:

```
A[row, j−1] = +1
A[row, i−1] = −1   (only if i ≥ 1)
b[row]      = d_los_ref(i, j)
```

**Solve per cell.** `x = lstsq(A_valid, b_valid)`, unweighted. Residual `r = A x − b`, and `rms = sqrt(mean(r²))` over the cell's pairs (defined only when the number of pairs is greater than the number of unknowns).

**Speed trick.** Cells that share the same pattern of valid pairs share the same A. Encode each cell's validity as a bit pattern (`np.packbits` along the pair axis), loop over `np.unique` patterns, and solve all cells of a pattern in one `lstsq` call (b becomes a matrix). That gives hundreds to a few thousand patterns for 500k cells, which runs in seconds.

```python
for pattern, cells in groups:                        # cells: flat indices
    used = pair_index[pattern]                       # pairs valid for this pattern
    comp = date_component(used, start=0)             # dates reachable from t_0 (union-find on pairs)
    A = design(used, comp)                           # rows: used pairs inside comp; cols: comp dates except t_0
    X, *_ = np.linalg.lstsq(A, B[used][:, cells], rcond=None)
    out[comp_cols][:, cells] = X;   out[other dates][:, cells] = NaN
```

**Missing dates at a cell.** A date with no valid pair touching it at that cell becomes NaN for that cell. It's never interpolated.

**Split network** (a long gap that no pair crosses, or masking that breaks the chain at a cell):
- Build the date graph (dates are nodes, valid pairs are edges) and find connected components.
- **Keep only the component containing the first usable date.** Dates in other components become NaN at that cell, because their offset relative to the start is unknown and guessing would invent motion.
- Log at stack level in `index.json → seasons[].network` (segments and the gap that split them), and at cell level in flag bit 4.
- Config already keeps the n+1 pair up to 60 days (`pairs.max_days_first`), so a stack-wide split should only happen after gaps longer than 60 days.
- Bridging a split with a velocity model would be possible but isn't this weekend's job.

**What this means for each sensor:**
- **S1 (n+1 and n+2 pairs).** About 2N−3 pairs for N−1 unknowns, so it's redundant. The inversion averages noise, and the residuals give a noise estimate.
- **NISAR (8 consecutive pairs, 9 dates).** No redundancy, so the least-squares solution is just the running sum of re-referenced pairs. A cell masked in pair k loses all dates after k (split rule). There's no residual, so noise comes from §11.1 method (b).

### 7.2 First and last usable date per season

Early scenes can have snow or meltwater, and late ones snow.

For each consecutive pair k, compute the **coherent fraction** f_k: the share of land cells (not water, inside the AOI) with coherence ≥ the threshold. Let f_med be the median of f_k over the season.

- **First usable date** = the earliest t_k such that:
  - f_k ≥ 0.5 · f_med (the pair starting at t_k is decent), **and**
  - if temperatures exist, at least 5 of the 7 days before t_k have `tmean_c > 0` (thaw has started).
- **Last usable date** = the latest t_k such that the pair ending at t_k has f ≥ 0.5 · f_med.
  - Late-season heave at freeze-up is real signal, so temperature doesn't cut the end. Snow pairs fail on coherence by themselves.
  - Late dates with 3 or more consecutive days of `tmax_c < 0` beforehand get `dates[].freeze_flag = true` for Part 3.
- Pairs touching dates outside the usable range are dropped (`reason: "outside usable season"`).
- Record the rule outcome and the reason in `seasons[].first_date_reason`.

**NISAR specifics:**
- The first NISAR date (25 Jun) is about three weeks after thaw begins. Its season total therefore **misses early thaw** and isn't comparable with Sentinel-1's.
- `index.json` stores every exact date plus `thaw_started_before_first_date: true` and the thawing degree-days accumulated before the first date (if temperatures are available). Part 3 uses those to compare seasons.
- **Config clash:** `season_window.end: "10-05"` would drop NISAR's 11 Oct date. Propose a per-stack override (`radar.season_end: {nisar_t159: "10-15"}`) and let the coherence rule decide the real end. The 4 Nov pairs fall outside either way.

---

## 8. Line of sight to vertical (C3)

```
d_v = d_los / cos(θ_inc)
```

Here θ_inc is the incidence angle at the ground, measured from the vertical (ellipsoid normal), and **not** the local incidence relative to the slope. The equation assumes all motion is vertical.

**Where θ comes from:**
- **S1:** `θ = π/2 − lv_theta`. Cross-check against `*_inc_map.tif` and against the ratio `los_disp / vert_disp` (which should equal cos θ if HyP3 converts the same way). Expect 30–46° for IW. If the three disagree by more than 1°, investigate before continuing: `inc_map` may be the *local* angle.
- **NISAR:** interpolate the `incidenceAngle` cube at the cell's ellipsoidal height (Tuk is near sea level, and the result is insensitive to height over tens of metres), then interpolate bilinearly in x and y onto the grid. Cross-check: `cos θ = sqrt(1 − X² − Y²)` from `losUnitVectorX/Y`. Check the units (degrees expected).

**Where the vertical assumption fails** (keep the values, set flag bit 1):
- slope > **5°** (from `features/slope.tif`, or derived from `context/elevation_m.tif`)
- within **100 m of the coast** (eroding bluffs and thaw slumps move sideways and toward the sea)

The ascending S1 and descending NISAR in 2026 view these places from opposite sides. Disagreement between the two sensors there is evidence of sideways motion (stretch: decompose into east and vertical components where both exist).

**Noise** also converts: `noise_v = noise_los / cos θ`.

**Do the jump test (§11.2) in LOS, before this step.** One cycle is exactly λ/2 in LOS; in vertical it's larger (about 3.3 cm for C-band at 33°).

---

## 9. Resampling to the shared grid (C4)

**The grid** (from `common.grid()`, fixed interface): `aoi.bbox` [−133.30, 69.20, −132.85, 69.48], 0.0005°, EPSG:4326, so **900 × 560 cells**. At 69.3° N a cell is about **20 m east–west × 56 m north–south**.

- Both sources are 80 m (S1 at 20×4 looks, NISAR at 80 m posting), so the grid **oversamples** them. That's fine for display, but neighbouring cells aren't independent measurements. **Part 4 must aggregate by area and must not count cells as independent samples.**
- A finer grid adds nothing for 80 m inputs. If S1 40 m jobs are ever run (15 credits each), the same grid still works.

**Methods** (warp each pair once, in step 6):

| Layer | Method | Note |
|---|---|---|
| d_los (from **unwrapped** phase only) | bilinear | linear, so converting before or after the warp gives the same result; never warp wrapped phase |
| coherence | bilinear | |
| validity (1 = valid, 0 = NaN) | bilinear on a float copy | target cell valid only if the warped validity ≥ 0.99, which stops NaN edges bleeding into neighbours |
| conncomp, masks | nearest | integer labels must not be averaged |
| incidence | bilinear | smooth field |

**Tools:**
- **S1:** `common.warp_to_grid(cfg, path, resampling=...)` works directly on GeoTIFFs. Its `src.nodata = 0` handling also hits the reference pixel (§1.2), which is harmless.
- **NISAR:** read with h5py, build the transform from the coordinates (with the half-pixel shift, §1.3), then `rasterio.warp.reproject` into a (560, 900) array. Wrap that as a small helper `warp_array_to_grid(cfg, arr, transform, crs, resampling)` in a **new** module (don't edit `common.py`).

---

## 10. Output files

All files go in `data/interim/motion/<stack_id>/` as float32 GeoTIFFs on the shared grid (`common.write_tif`, NaN nodata), except flags (uint8, 0 = no flags).

| File | Content |
|---|---|
| `cum_<YYYYMMDD>.tif` (fixed) | Vertical cm since the season's first usable date, negative = sinking, NaN = masked. The **first date's file is all 0 where valid**, so the frontend slider starts at zero. One file per usable date. |
| `coh_<season>.tif` (fixed) | Mean coherence over the season's usable pairs, computed before masking; water NaN |
| `valid_<season>.tif` (added) | Fraction of usable dates with a value at this cell, 0–1 (Part 3's valid-date count = fraction × N) |
| `noise_<season>.tif` (added) | Vertical noise estimate in cm (§11.1) |
| `flags_<season>.tif` (added) | Bits: 1 = vertical assumption weak (slope or bluff); 2 = not connected to the reference region; 4 = network split at this cell; 8 = inside the reference polygon; 16 = ionosphere not applied (NISAR) |
| `index.json` (fixed) | Schema below |

The brief allows specs to add files. The fixed ones keep their names and shapes.

### `index.json` schema (one per stack)

```json
{
  "schema_version": 1,
  "generated_at": "2026-11-15T03:00:00Z",
  "code_version": "<git sha>",
  "stack_id": "nisar_t159",
  "sensor": "NISAR",
  "band": "L",
  "wavelength_m": 0.2384,
  "track": 159,
  "frame": 53,
  "relative_orbit": null,
  "flight_dir": "DESCENDING",
  "polarisation": "HH",
  "grid": {"crs": "EPSG:4326", "bbox": [-133.30, 69.20, -132.85, 69.48], "res_deg": 0.0005, "width": 900, "height": 560},
  "units": "cm",
  "component": "vertical",
  "sign": "negative = sinking, relative to the reference area",
  "phase_to_los_sign": -1,
  "sign_check": {"method": "physical + cross-sensor", "result": "pass", "detail": "Jul-Aug tundra median -1.8 cm; r vs S1 2025 = 0.61"},
  "incidence_deg": {"min": 33.1, "max": 41.7, "mean": 37.2, "source": "radarGrid/incidenceAngle"},
  "reference": {
    "method": "airport_polygon",
    "file": "data/interim/context/reference_airport.geojson",
    "n_cells": 64,
    "meaning": "Values are motion relative to the airport gravel pad",
    "diagnostics": {"2026": {"airport_minus_coherent_land_median_cm": 1.4}}
  },
  "corrections": {"ionosphere": "applied", "deramp": false},
  "thresholds": {"coherence_min": 0.35, "min_valid_pair_fraction": 0.7, "closure_cm": 5.96, "slope_flag_deg": 5, "coast_flag_m": 100},
  "seasons": {
    "2026": {
      "first_usable_date": "2026-06-25",
      "first_date_reason": "first acquisition; coherent fraction 0.71 >= 0.5 x median",
      "thaw_started_before_first_date": true,
      "tdd_before_first_date": 142.0,
      "last_usable_date": "2026-10-11",
      "dates": [
        {"date": "2026-06-25", "file": "cum_20260625.tif", "wet_flag": false, "freeze_flag": false}
      ],
      "pairs": [
        {"ref": "2026-06-25", "sec": "2026-07-07", "days": 12, "id": "<granule id>",
         "used": true, "reason": null, "coherent_fraction": 0.71, "ramp_cm": 0.6,
         "masked": {"coherence": 12034, "water": 98211, "conncomp": 421, "unwrap_test": 37},
         "dropped_duplicates": []}
      ],
      "gaps": [{"from": "2026-07-19", "to": "2026-08-12", "days": 24, "bridged": true}],
      "network": {"connected": true, "segments": [["2026-06-25", "2026-10-11"]]},
      "stats": {"valid_cell_fraction": 0.58, "median_cum_land_cm": -2.1, "noise_median_cm": 0.4,
                "closure_fail_fraction": null},
      "checks": [{"name": "tundra_sinks", "pass": true, "value": -2.1}],
      "files": {"coh": "coh_2026.tif", "valid": "valid_2026.tif", "noise": "noise_2026.tif", "flags": "flags_2026.tif"}
    }
  }
}
```

The numbers above are placeholders that show the shape, not results.

---

## 11. Quality (D)

### 11.1 Per-cell quality summary for Part 4 (D1)

- **Mean coherence:** `coh_<season>.tif`.
- **Share of valid dates:** `valid_<season>.tif`.
- **Noise** (`noise_<season>.tif`, vertical cm):
  - **(a) S1: inversion residual RMS** (§7.1), converted to vertical. With this network, every redundant pair corresponds to one triplet, so this is effectively the closure error.
  - **(b) NISAR (no redundancy): scatter about a smooth fit.** Fit `x(t) = a · sqrt(TDD(t)) + c` (the Stefan thaw model, using `daily_temperature.csv` cumulated from the first usable date). Noise = RMS of residuals.
  - If temperatures aren't ready, fit a quadratic in time instead.
  - Cells with fewer than 5 valid dates get NaN noise.

Part 3 also asked for per-cell valid-date counts and noise per season (E3). These two files are that.

### 11.2 Sanity checks (D2)

Each check is written to `seasons[].checks`. A failed check doesn't stop the run, but it's printed in red and shown in the validation view.

| Check | Pass condition |
|---|---|
| Tundra sinks through summer | median `cum` of land cells (excluding town and reference) at the last mid-September date < 0; typical −1 to −6 cm |
| Reference near zero | \|median `cum` over reference cells\| < 0.2 cm at every date (true by construction; if it fails, the code is wrong) |
| Lakes masked | 0 valid cells where water occurrence ≥ 50% |
| No cycle jumps | in each re-referenced pair, in LOS, fraction of neighbouring coherent cell pairs with \|Δ\| > λ/4 (1.39 cm C, 5.96 cm L) < 1%; clusters of such edges indicate unwrapping errors |
| HyP3 agreement (S1) | slope of our LOS vs `los_disp` = +1.00 ± 0.01 |
| Incidence plausible | S1 30–46°, NISAR within the incidence cube's range; S1 methods agree within 1° |
| Freeze-up heave allowed | upward motion in late September/October is **not** flagged as an error |

### 11.3 Comparing the two sensors in 2026 (D3, needs `s1_p108`)

1. Both stacks use the same airport reference and are in vertical cm.
2. **Common window:** from NISAR's first usable date (25 Jun) to the last date both have. Pick the S1 date nearest each end (within ±6 days).
3. Compute each sensor's change over the window: `Δ = cum(end) − cum(start)`.
4. Aggregate to 500 m blocks (median of valid cells; a block needs ≥ 50% valid in both).
5. Report: Pearson r, median difference (bias), RMSD and block count, plus a scatter plot for the validation view.
6. Flag-1 blocks (slopes and bluffs) are reported separately. Differences there can mean sideways motion, since the two sensors look from opposite sides.
7. This is raw sensor agreement. Part 3's "Test B" (model vs NISAR) is a separate test.

**The 2026 S1A → S1D handover:** pairs mixing two satellites are allowed if HyP3 produced them. Flag them (`pairs[].cross_platform: true`) and compare their coherence with same-satellite pairs.

**2022–2024:** Sentinel-1 had a single satellite (12-day pairs at best), so expect lower coherence and more masking. That's data, not a bug.

---

## 12. Year-round checks (E, stretch)

1. **Year-apart S1 pairs** (e.g. Aug 2024 → Aug 2025, same day of year ±6 days so seasonal timing roughly cancels).
   - C-band coherence over a year survives mainly on gravel, roads, town and bare ground, not on vegetated tundra.
   - Process with the same chain (one pair, so no inversion). Keep only cells **connected to the reference region** (flag bit 2 = 0), because isolated patches can't be tied to zero.
   - Report as "net change across one winter", with the coverage percentage beside every number, and only at block scale.
   - Write to `data/interim/motion/s1_p137/annual_<YYYY>_<YYYY>.tif`.
2. **NISAR winter pairs** (Nov 2025 – Jan 2026).
   - Report **coherence only**: median coherence over land and the coherent fraction per pair.
   - Don't interpret winter phase as ground motion. Changes in snowpack shift L-band phase.
   - This is purely a feasibility check for year-round monitoring. Output goes to `index.json → winter_coherence`.
3. **What Part 3 needs beyond the motion stack:** `valid_<season>.tif`, `noise_<season>.tif`, exact dates, `thaw_started_before_first_date`, and the `wet_flag`/`freeze_flag` per date. All of these are covered above.

---

## 13. `config.yaml` changes (proposed: apply by hand, nothing removed)

The v1 keys stay so `process.py` and `export_web.py` keep working.

```yaml
radar:                                   # Part 2 v2 settings
  phase_sign: {S1: -1, NISAR: -1}        # positive LOS = toward satellite; confirmed by section 2.2
  coherence_min: {C: 0.30, L: 0.35}
  min_valid_pair_fraction: 0.7
  ref_min_valid_cells: 20
  reference:
    method: polygon
    polygon: data/interim/context/reference_airport.geojson   # OSM aeroway, buffered in 1 cell
  water_occurrence_min: 50               # % (JRC)
  min_region_cells: 25                   # S1 pseudo-connected-components
  closure_threshold_fraction: 0.25       # x wavelength -> 1.39 cm (C), 5.96 cm (L)
  first_date: {min_coherent_ratio: 0.5, thaw_days: 5, thaw_window: 7}
  season_end: {nisar_t159: "10-15"}      # default season_window.end otherwise
  nisar_apply_ionosphere: true           # pending the ramp test in section 6.1
  nisar_ionosphere_sign: 1               # 1 = subtract screen; -1 = add
  slope_flag_deg: 5
  coast_flag_m: 100
  ramp_warn_cm: 2.0
  compare_block_m: 500
  out_dir: data/interim/motion

nisar:
  coords_fallback_group: science/LSAR/GUNW/grids/frequencyA/unwrappedInterferogram/HH   # if coords are not at grid_group
```

`processing.min_coherence` stays for v1. The v2 code reads `radar.coherence_min`.

---

## 14. Tonight's Must-tier checklist

This covers one NISAR pair and one S1 pair read correctly, sign and reference verified, and a coherence map.

1. `python src/fetch_nisar.py --limit 1`, then print the tree (§1.3). Fill in §16 with the real paths, conncomp values and incidence units.
2. Read the NISAR pair, then: coherence map PNG, LOS map PNG, ionosphere ramp before and after (§6.1).
3. Download one finished S1 job (`hyp3_submit.py --download`). Run the HyP3 sign test (§2.2) and the three-way incidence check (§8).
4. Digitise the airport polygon (§4). Re-reference both pairs and confirm the reference reads ≈ 0.
5. Run the physical sign check on both pairs (§2.2). If the S1 pair is mid-summer, its tundra median should be negative.
6. Save the PNGs and numbers to `docs/architecture/specs/02-checks/`. They become the "radar is real" slide.

---

## 15. Problems in the current `process.py` (all replaced by this spec)

| Problem | Effect | Fixed in |
|---|---|---|
| Reads `cfg["nisar"]["unwrapped_phase_path"]` etc., which no longer exist in `config.yaml` | the NISAR branch crashes with `KeyError` | §1.3 |
| Sums pairs without re-referencing | each pair's arbitrary zero adds into the total | §4 |
| `np.nansum` across pairs | a masked pair counts as **0 cm of motion**, biasing totals toward zero | §7.1 (masked → NaN, inversion) |
| Picks seasons by year in the filename | fragile; ignores usable dates | §1.1, §7.2 |
| Keeps line-of-sight values | breaks the "LOS never leaves Part 2" rule; sensors not comparable | §8 |
| One total per season | no time series for the slider or Part 3 | §10 |
| NISAR transform without the half-pixel shift | about 40 m offset | §1.3 |
| Uses HyP3 `los_disp` directly | relies on HyP3's per-pair reference | §2, §4 |

---

## 16. Unconfirmed (check on the first real files)

| Item | How to confirm | Status |
|---|---|---|
| NISAR `x/yCoordinates` and `projection` at `G/` or `G/HH/` | tree print (§1.3); whether `fetch_nisar.py` ran | open |
| NISAR phase sign | §2.2 physical and cross-sensor checks | open |
| NISAR `connectedComponents`: 0 means unassigned | `np.unique`, compare with the coherence map | open |
| NISAR `mask` bit meanings | attributes in the file; product spec Rev E | open; not used except the fill value |
| NISAR `incidenceAngle` units and height axis | dataset attributes | open |
| Ionosphere screen sign and coverage over the AOI | ramp test (§6.1) | open |
| HyP3 displacement maps: positive = toward the satellite | README in the product folder, plus §2.2 regression | open |
| HyP3 `lv_theta` → incidence = π/2 − lv_theta; `inc_map` local or ellipsoid | three-way check (§8) | open |
| Airport polygon position and stability | OSM, and `reference.diagnostics` after the first season | open |
| `rasterio` bilinear behaviour at NaN edges | the validity-warp rule (§9) makes this safe either way | handled |
| Cross-platform S1A–S1D pairs process cleanly in HyP3 | job status and coherence of those pairs | open |
| `season_window.end` 10-05 drops NISAR's 11 Oct date | per-stack override (§13) | proposed |
