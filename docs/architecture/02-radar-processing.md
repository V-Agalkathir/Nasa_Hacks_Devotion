# Brief 2: Radar processing

> Synced on 14 Nov 2026 from the team's shared Claude doc, "Tuk Ground-Screening Tool: Build Plan". Edit the doc first, then re-sync.

Write only the spec file named below. Do not change code. Read `docs/architecture/00-overview.md` first if you have the repo.

This part turns interferogram pairs from two sensors into one consistent product per sensor: vertical ground motion in centimetres at each date, on a shared grid, with a quality measure. Return a spec as `docs/architecture/specs/02-radar-processing.md`; read `data-pipeline/src/process.py`, `inspect_h5.py` and `config.yaml` first if you have the repo.

Inputs from Part 1:

- **Sentinel-1** (C-band, 5.55 cm wavelength), path 137 frame 223, ascending, summers 2018–2025, as HyP3 product folders (GeoTIFFs in UTM).
- **NISAR** (L-band, 23.84 cm), track 159 frame 53, descending, eight pairs (nine dates) from 25 Jun to 11 Oct 2026, as L2 GUNW HDF5 at 80 m posting.

**Your job:** specify the chain precisely enough to code: every formula, the order of steps, thresholds with reasons, and how to check each step on one real pair.

## Decisions already made

- **Output grid:** the one in `config.yaml`. A better resolution is allowed as a config change.
- **Output per stack** in `data/interim/motion/<stack_id>/`: `cum_<YYYYMMDD>.tif` (vertical cm since the season's first usable date, negative = sinking, NaN = masked), `coh_<season>.tif` (mean coherence), `index.json` (sensor, band, track, direction, incidence, reference, dates, pairs and gaps per season).
- **Seasons are independent.** Nothing is linked across winter.
- **Tools:** numpy, rasterio, h5py. MintPy only if it is quicker to get working this weekend than a small least-squares inversion in numpy.

## What the spec must answer

**A. Reading the inputs**

1. HyP3: which files hold unwrapped phase, coherence, incidence angle and water mask; units; sign convention of the phase and of the displacement maps; a one-pair check that proves the sign.
2. NISAR GUNW: HDF5 paths for unwrapped phase, coherence, connected components, ionosphere screen, coordinates, projection and incidence. We believe they sit under `/science/LSAR/GUNW/grids/frequencyA/unwrappedInterferogram/HH/` (unconfirmed): how to confirm with `inspect_h5.py`, what to put in `config.yaml`, the sign convention and the same one-pair check.
3. Phase to line-of-sight displacement, d = phase × λ / (4π), with the sign explicit per sensor.

**B. Making pairs comparable**

1. **Reference.** HyP3 references each pair to its own point, so pairs cannot simply be added. Define one reference for the whole stack. Tuk has no bedrock: compare a fixed gravel area such as the airport, the median of high-coherence pixels, and several stable-looking patches. Recommend one, say what "relative to the reference" means for a reader, and whether both sensors can share it.
2. **Masking:** coherence threshold per band; water (lakes, and sea on three sides); unwrapping failures (connected components for NISAR, a test for Sentinel-1); minimum share of valid pairs per pixel.
3. **Ionosphere and atmosphere:** whether to apply NISAR's ionosphere layer; what residual atmosphere remains over 31 km after referencing; whether more is worth doing this weekend.

**C. Building the time series**

1. With nearest and second-nearest pairs, how to solve for displacement at each date (least squares per pixel); missing dates; what to do when the network splits after a long gap.
2. How to choose each season's first usable date, since early scenes may have snow or meltwater: a rule based on coherence or temperature.
3. Line-of-sight to vertical: d\_vertical = d\_los / cos(incidence), assuming vertical motion. When that fails (slopes, bluffs) and how to flag those pixels.
4. Resampling to the shared grid: method for displacement and coherence; how 80 m NISAR and 40 or 80 m Sentinel-1 map onto it.

**D. Quality**

1. A per-pixel quality summary for Part 4: mean coherence, share of valid dates, and a noise estimate (scatter about a smooth fit, or triplet closure error).
2. Sanity checks: sinking through summer over tundra; near zero at the reference; lakes masked; no half-wavelength jumps between neighbours (2.8 cm C-band, 11.9 cm L-band).
3. How to compare the two sensors in 2026 over a common window if Sentinel-1 path 108 is processed.

**E. Year-round checks (stretch)**

1. Same-season pairs a year apart (for example August 2024 → August 2025) to measure net change across a winter: where coherence survives on C-band, and how to report it without over-reading sparse coverage.
2. NISAR winter pairs (November 2025 – January 2026): whether L-band keeps coherence through snow here, as a first look at year-round monitoring.
3. What Part 3's behaviour classes need from this part beyond the motion stack: per-pixel valid-date counts and a noise estimate per season.

## Known traps

- The current `process.py` sums pairs without re-referencing, filters seasons by year in a filename, keeps line-of-sight values and writes one total per season. The spec replaces this logic.
- NISAR starts on 25 June, weeks after thaw begins, so its season total is not comparable with Sentinel-1's. Keep exact dates so Part 3 can account for it.
- One NISAR pair spans 24 days (19 Jul → 12 Aug): higher unwrapping risk.
- Some NISAR pairs come in two versions. Use one.
- Sentinel-1 was a single satellite from 2022 to 2024 (12-day pairs at best): expect lower coherence.
- C-band loses coherence over wet, vegetated tundra. Large masked areas are a finding to show, not to fill in.
- L-band phase also responds to soil moisture. Say whether this matters at centimetre scale.

## Tiers and required sections

- **Must:** one NISAR pair and one Sentinel-1 pair read correctly, sign and reference verified, coherence map over the area.
- **Should:** full 2026 NISAR series; Sentinel-1 2021–2025.
- **Stretch:** 2018–2020; path 108; triplet closure statistics.

The returned spec needs: the chain as numbered steps with inputs and outputs; formulas and sign conventions with the verification test; reference choice with comparison; masking rules; the time-series inversion including the split-network case; output files including the full `index.json` schema; quality measures and checks; `config.yaml` changes; anything unconfirmed.
