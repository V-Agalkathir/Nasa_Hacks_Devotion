# Part 6 spec: Ground Check, the interactive product

Target path in repo: `docs/architecture/specs/06-interactive-product.md`
Status: written 15 Nov 2026 from the frozen results (tag `prereg-eval`, eval schema `eval/2`) and the design canvas, version 29 (https://claude.ai/artifact/B4oSNuouP7ajLf1juF5Sjz, private until shared).
Build: React 18 + Vite + MapLibre GL + Recharts, static files only. The canvas uses the real screening cells, so every number quoted here is a real one.

---

## 0. Decisions

| Topic | Decision |
|---|---|
| Pitch | "Satellites can't yet certify ground in Tuk. We tested that honestly, and the screen still narrows the search for the relocation team's cores to high, dry, inland ground near the highway." |
| Shape | One page, phone first (390 px). The map and the Ground check panel are the product; everything else supports them |
| Unit of selection | The 240 m screening cell from `areas.geojson`. Named areas are presets that select the cells they touch |
| Answer | Tier (lower, moderate, higher, not enough data) plus three measured drivers: Coast, Height, Ground. Never a percentage, never a "best site" |
| Ground driver | Always labelled UNCONFIRMED and never counted in the tier (Test A failed) |
| Not shown | Predicted ground (Model B not run), shoreline arrival years (Model C failed its hindcast), the 2026 radar motion (Test B failed), air-photo shorelines from 1947–1985 |
| Failed tests | Shown as cards with their number and baseline, at the same visual weight as passes would get |
| Demo banner | Only when `manifest.mock` is true. With real data, a dark "Real results" strip replaces it |

## 1. Views and navigation

One scrolling page with anchors, no router. Order on every width:

1. **Results strip** (or the demo banner when `mock: true`).
2. **Header:** brand, freshness line, season chip, About button.
3. **Hero:** H1, lead, three stat tiles. Each tile is a button: Core next layer · zoom to the town · scroll to `#tests`.
4. **Map card:** layer switch, map with tools, the control bar for the layer, legend, options.
5. **Ground check panel** (`#check`): selection, Try chips, needs, Run button, report, Save.
6. **Side by side** (`#compare`).
7. **How do we know?** (`#tests`).
8. **Limits strip, footer.** About opens a modal.

**First screen on a phone:** results strip, header, H1 and the three tiles. The layer switch starts about 700 px down. **First screen on desktop (1440):** hero plus the top of the map and the panel side by side.

**Layout.** At 1100 px or wider there are two columns: map 560 px, sticky at `top: 16px`, and the panel takes the rest. Below 1100 px there is one column with the map at most 640 px wide. Below 720 px the gutters are 16 px, tool labels collapse to icons and the needs controls wrap under their labels. Use container queries on the page root, as in the canvas, so the same CSS works in any frame.

## 2. Components

The existing files are kept and reworked; the new files sit in `src/components/`.

| Component | Status | Props | Notes |
|---|---|---|---|
| `App.jsx` | rework | – | Owns all state (§2.1), loads data, lays out sections |
| `ResultsStrip` | new | `mock` | Results strip or demo banner |
| `FreshnessLine` | new | `manifest.latest_pass`, `manifest.update_status` | Exact wording in §4 |
| `HeroStats` | new | `promCount`, `namedHigher`, `tests` | Counts derived from data, not hard-coded |
| `LayerControl` | rework | `layer`, `onLayer`, `layersAvailable`, `opts`, `onOpts` | Five-button segmented control plus two checkboxes. A layer whose file is missing is disabled, with a "(not available)" title |
| `MapView` | rework | `data`, `layer`, `step`, `shoreYear`, `tool`, `zoom`, `sel`, `saved`, `onPick(ids, mode)`, `onHover(id)` | Cells source, raster overlays, selection and saved outlines, tools |
| `MapTools` | new | `tool`, `onTool`, `zoom`, `onZoom` | Move · Box · Paint · Erase, then Region · Town |
| `MapReadout` | new | `cell`, `layer`, `step` | One line, `aria-live="polite"` |
| `TimeSlider` | rework → radar steps | `steps`, `value`, `onChange` | Classes · 2021 … 2025 · 2026 |
| `ShorelineDates` | new (or a `TimeSlider` variant) | `dates`, `value`, `onChange` | 1985 · 1995 · 2005 · 2015 · 2025 |
| `Legend` | rework | `layer`, `step` | Swatches from `lib/tokens.js`; one line of layer note under them |
| `CoreList` | new | `cells`, `onSelect` | The six nearest to town, under the map on the Core next layer |
| `ZonePanel` | rework → `CheckPanel` | `sel`, `ran`, `need`, `running`, … | Hosts the components below |
| `NeedsList` | new | `need`, `onNeed`, `results` | Five rows, each with glyph, label, value and select |
| `TierTile`, `DriverCard` | new | `report` | Driver level is shown as three bars (0, 1, 2) |
| `TierMix`, `HeightHistogram`, `SummerChart`, `CoastChange` | new | `report` | `SummerChart` uses a Recharts BarChart with a ReferenceArea for y ±1. The others are divs |
| `CompareStrip` | new | `cols`, `need`, `onShow`, `onRemove` | Scrolls sideways on a phone |
| `TestCards` | new | `validation` | One card per entry, in file order |
| `LimitsStrip` | new | `limits` | From `manifest.limits`, or the fallback list in §4 |
| `AboutModal` | rework | `onClose` | Keeps focus trap and Escape. New copy in §4 |

Logic lives in three `lib/` files:
- `lib/data.js`: loading and v1/v2 fallbacks.
- `lib/check.js`: `aggregate(ids)`, `tierRule(agg)`, `needs(agg, ids, need)`, `autoName(ids)`.
- `lib/tokens.js`: colours and labels.

### 2.1 State in `App.jsx`

| Key | Default | Meaning |
|---|---|---|
| `layer` | `'screen'` | One of `screen`, `height`, `coast`, `radar`, `core` |
| `step` | `'cls'` | Radar step: `'cls'`, the years `2021`…`2025`, or `2026` |
| `shoreYear` | `2025` | Coast date control |
| `tool` | `'move'` on touch, `'box'` on mouse | Map tool |
| `zoom` | `'region'` | Region fits the manifest bounds; Town fits [-133.10, 69.36, -132.92, 69.47] |
| `sel` | Reindeer Point cells | Selected cell ids, sorted |
| `selName` | `'Reindeer Point'` | Comes from the preset or from `autoName` |
| `ran` | snapshot of `sel` | `{ids, name, namedId}` of the last run |
| `running` | `false` | True during the 900 ms scan; skipped with reduced motion |
| `need` | `{minH: 4, maxHwy: 1000, minSea: 300, maxWet: 40, minCov: 70}` | Taken from `areas.settings.filters_default` where present |
| `saved` | `[A: The Point, B: Highway km 26]` | Up to 3 entries of `{slot, name, ids, namedId}` |
| `hoverId` | `null` | Cell under the pointer, or the last tapped cell |
| `aboutOpen`, `showRoad`, `showNames` | `false`, `true`, `true` | |

Selection changes bump a `selVer` counter. When `selVer` differs from the version recorded in `ran`, the report is stale: show it at 50% opacity, with the button reading "Run the check again".

## 3. Interactions and states

### 3.1 Map layers

| Layer | Cells coloured by | Overlays | Control bar |
|---|---|---|---|
| **Screen** (default) | `tier` | Named outlines (dashed), airport pad | – |
| **Height** | `h`: under 2.5 m · 2.5–4 · 4–8 · 8–15 · 15 m or more | – | – |
| **Coast** | `sea`: ≤100 m · 100–300 m · over 300 m | Shoreline for the selected date (solid), other dates (dashed, 45% opacity); transects coloured by `measured_change` | Shoreline dates |
| **Radar** | Classes step: dominant class from `behaviour.png`. Year step: `motion_<year>.png` | Note card (below) | Radar steps |
| **Core next** | `coring = promising_unconfirmed` in teal, other land faint | ▲ on `conflicting_evidence` cells | CoreList under the map |

Cells are one GeoJSON fill layer with a data-driven `fill-color` per layer (a `match` on the property). Hatches are `fill-pattern` images registered with `map.addImage`. The radar layers are image sources drawn under the cells, with the cell fill set to transparent so the outlines stay selectable. Water is the basemap; draw a flat water colour at 0.35 opacity over Esri imagery so that lower-tier cells never read as water.

**Radar note cards** sit bottom-left on the map, above the readout:
- **Classes:** title "Unconfirmed", text "Radar patterns did not repeat between years. Read classes as a hint, not a finding."
- **2026:** title "2026: insufficient data", text "One NISAR pair failed to unwrap and several lost coherence, so there's no connected series." The 2026 step greys every cell with the "no radar record" stripe.

**Radar step labels:** each year shows "<n>% read", from `manifest.layers.motion[year].valid_share`. The 2025 step also rings the cells flagged by the this-season rule; the legend reads "2025 only: moved more than expected".

### 3.2 Selecting land

| Gesture | Move | Box | Paint | Erase |
|---|---|---|---|---|
| Drag | Pans the map | Draws a rectangle that replaces the selection | Adds the cells under the finger | Removes the cells under the finger |
| Tap or click | Toggles one cell | Toggles one cell | Adds one cell | Removes one cell |
| Pinch or wheel | Zooms | Zooms | Zooms | Zooms |

- **Box:** uses `queryRenderedFeatures` on the screen rectangle. Box, Paint and Erase disable `dragPan` while active.
- **Try chips** select the same areas by keyboard: The Point · Town core · Reindeer Point · Highway km 6 · Highway km 26. The two highway chips are 5×5 cell blocks: cols 40–44, rows 86–90, and cols 62–66, rows 16–20, from `C{col}_{row}`.
- **Selection outline:** a cream 6 px halo under a coffee 2.5 px line. It is built client-side from cell edges whose grid neighbour isn't selected, using `C{col}_{row}`.
- **Saved selections:** outlined A dashed, B dotted, C dash-dot, each with a letter badge.
- **Readout**, for example: "Lower · 9.4 m above sea · 1.4 km from shore · 1.9 km to highway · Promising, unconfirmed".

### 3.3 The check

1. **Run ground check** is disabled with nothing selected. Running shows a marching box and a scan line over the selection's bounds for 900 ms, then the report. With `prefers-reduced-motion` the report appears instantly.
2. **Named presets** report the named area's own `areas.geojson` values: tier, reason, drivers and indicators.
3. **Drawn selections** apply the Part 4 rule to their cells:
   - `coastLevel`: 2 if min `sea` ≤ 100 m, 1 if ≤ 300 m, else 0.
   - `heightLevel`: 2 if the mean share below 2.5 m is ≥ 0.5, 1 if p10 of the cells' `p10` is < 4.0 m, else 0.
   - `tier` = higher at level 2 and moderate at level 1. Otherwise it is `not_enough_data` when cells that can't be measured are ≥ 50%, and lower in all other cases. The ground level is never counted.
   - If `p10` or `low` is missing from the compact cells, fall back to the median `h`: below 2.5 m gives level 2, below 4 m gives level 1.
4. **Needs.** Each row is evaluated on the cells:
   - Every cell passes: ✓.
   - At least half pass: ◐.
   - Fewer than half pass: ✕.
   - Not run yet: –.

   Named presets get ✓ or ✕ from the area values. The header reads "Meets n of 5". Changing a need updates the glyphs live without re-running.

   | Need | Options (default in bold) | Cell test |
   |---|---|---|
   | Height above sea | Any · 2.5 m · **4 m** · 6 m · 8 m or more | `h ≥ minH` |
   | Close to the highway | Any · 500 m · **1 km** · 2 km | `hw ≤ maxHwy` |
   | Away from the shore | Any · 100 m · **300 m** · 500 m | `sea > minSea` |
   | Dry ground | Any · **under 40% water** · under 25% | `wet < maxWet` |
   | Radar can see it | Any · half or more · **70% or more** | `cov ≥ minCov` |

   These five, with nothing flagged by radar, are the "promising, unconfirmed" rule. Say so in the About modal.
5. **Report**, top to bottom:
   - Tier tile with the reason sentence.
   - Three driver cards, each MEASURED; Ground also UNCONFIRMED with "Not counted in the tier".
   - "The squares inside": tier mix bar with counts.
   - "How high is it?": histogram, bins 0–2.5 · 2.5–4 · 4–6 · 6–8 · 8–10 · 10–12 · 12–15 · 15+, first bin dark, bins under the height need faded.
   - "Each summer": median cm per year against a shaded ±1 cm band, plus a hatched 2026 column reading "Insufficient data".
   - "The coast": distance to the 2025 shoreline as a big number, then measured change as a dot with ±15 m whiskers on a −20 to +60 m axis.
   - "Where to core": counts and "Show on the map".
   - Save button.
6. **Large selection** (over 250 cells): add "Large selection: it mixes very different ground. Smaller areas give clearer answers."

### 3.4 Side by side

Columns: saved A–C plus the current unsaved run, which has a dashed border. Rows: tier · tier mix bar · Coast · Height · Ground (with UNCONFIRMED) · Highway · To town · Water · Radar reads · need glyphs and "n of 5 needs" · Select on map · Remove. The current needs apply to every column. On a phone, columns are 230 px wide and the strip scrolls sideways; the first column's labels repeat in each column.

### 3.5 How do we know?

Build one card per `validation.json` entry. Each card shows, top to bottom:
1. Status chip.
2. Title.
3. Headline number and its unit.
4. Baseline line.
5. Plain sentence.
6. Method line, in small muted text.

| Status | Chip text | Chip style |
|---|---|---|
| pass | Passed | Solid teal, ✓ |
| partial | Partly passed | Teal outline, ◐ |
| fail | Failed | Solid coffee |
| not_run | Not run | Dashed outline |
| not_available | Not available | Dotted outline |

The hero tile counts passes over entries whose status is pass, partial or fail ("0 of 3"), and names the rest ("2 more couldn't run").

## 4. Copy deck (final wording)

**Strip and header**
- Real-data strip: pill `REAL RESULTS`, text "Tests were fixed before we looked at the answers (tag prereg-eval). Every failed test is shown below with its number."
- Demo banner (only when `mock: true`): pill `DEMO`, text "Demo data: every number on this page is simulated until the radar pipeline delivers."
- Freshness line, exact: "Last radar pass: 5 Oct 2025, Sentinel-1. Updates every 12 days, June to September." The date and sensor come from `manifest.latest_pass` (last usable pass). Second line: "NISAR passes are checked automatically; the 2026 summer gave no usable series." The season chip reads "Winter pause" from 1 Oct to 31 May and "Watching for passes" otherwise.

**Hero**
- H1: "Satellites can't yet certify ground in Tuk."
- Lead: "We tested that honestly. The screen still narrows the search for the relocation team's cores to high, dry, inland ground near the highway."
- Tiles:
  - "**763** squares worth a core: high, dry, inland, near the highway · Show where"
  - "**3 of 3** named areas are higher risk: they sit on the shoreline · See the town"
  - "**0 of 3** tests passed, and 2 more couldn't run · See every test"

**Map**
- Layer buttons: Screen · Height · Coast · Radar · Core next.
- Tools: Move · Box · Paint · Erase. Zoom: Region · Town.
- Options: "Highway and roads" · "Place names and outlines".
- Readout when idle: "Drag a box over any land from the town down to highway km 32, or tap one square." At Town zoom: "Town view. Each square is 240 m across. Drag to select."
- Map label for the reference area: "Airport pad (reference)".
- Layer notes, each followed by " Squares are 240 m: block scale, not single houses.":
  - Screen: "Second-move risk for every 240 m square, from measured height, distance to the 2025 shoreline and radar."
  - Height: "Height above sea level. The 2.5 m storm-surge reference is the line that matters most."
  - Coast: "Distance to the 2025 shoreline, with measured shoreline change along each transect."
  - Radar, classes: "Radar classes from five summers. Unconfirmed: the patterns did not repeat between years."
  - Radar, a year: "Movement in summer <year>, relative to the airport gravel pad. ±1 cm is within the noise."
  - Radar, 2026: "NISAR 2026: insufficient data."
  - Core next: "Where a core would tell the relocation team the most. Ordered by distance from town, not ranked."
- Radar bar note: "Sentinel-1 2021–2025, 80 m. NISAR from 2026: a different sensor, so read 2025→2026 with care. "% read": share of the land radar measured that summer."
- Coast bar note: "Waterline from <date>, ±15 m. Air-photo shorelines from 1947–1985 failed visual review and are left out."
- CoreList note: "The six closest to town of 763. Ordered by distance from town, not ranked: it suggests where a core would tell the relocation team the most and doesn't replace their judgement."
- Legends:
  - Screen: Lower · Moderate · Higher · Not enough data · Water.
  - Height: "Under 2.5 m: storm-surge reach" · 2.5–4 m · 4–8 m · 8–15 m · 15 m or more.
  - Coast: "Within 100 m of shore" · 100–300 m · "More than 300 m: not a factor" · "Change within ±15 m" · "15–40 m landward" · "More than 40 m landward" · "Moved seaward".
  - Radar, classes: Stable · Seasonal only · Degrading · Can't measure · `UNCONFIRMED` · `NOT RUN` "Predicted ground: 110 of 300 examples needed".
  - Radar, a year: "Sank 2 cm or more" · "Sank 1–2 cm" · "Within ±1 cm: noise" · "Rose 1–2 cm" · "Rose 2 cm or more" · "No radar record".
  - Radar, 2026: "Insufficient data".
  - Core next: "763 promising, unconfirmed" · "5 conflicting evidence" · "Other land".

**Ground check panel**
- Eyebrow "Ground check". Empty selection name "Nothing selected", with the size line "Drag on the map or pick a place". Under the Run button when nothing is selected: "Drag a box on the map, paint squares, or pick a place above."
- Try chips: "Try" followed by the five chips.
- Needs: header "What do you need?", status "Meets n of 5", button "Reset". Values before a run: "Run the check to see". Value formats:
  - Height: "Middle 8.1 m · lowest tenth 5.3 m"
  - Highway: "530 m to the highway" or "The highway runs through it"
  - Shore: "On the 2025 shoreline" or "1.4 km from the 2025 shoreline"
  - Dry: "26% water or ponds around it"
  - Radar: "Radar reads 93% of it"
- Run button: "Run ground check" · "Checking the ground…" · "Run the check again". Stale note: "Showing the last check (<name>). Your selection changed: run it again."
- Tiles: "Lower-risk ground" · "Moderate risk" · "Higher risk" · "Not enough data". Eyebrow "Second-move risk · <name>". Reason sentence comes verbatim from `areas.geojson` (Part 4).
- Driver cards: eyebrows Coast · Height · Ground. Text is the driver string without its prefix. Level line: "Not a factor" · "Some concern" · "Main concern"; for Ground, "Not counted in the tier" plus "Unconfirmed: radar patterns did not repeat between years."
- Section titles: "The squares inside" · "How high is it?" (sub "Squares by height above sea, m") · "Each summer" · "The coast" · "Where to core" (sub "Where a core tells the most. Not a ranking.").
- Histogram note: "Dark bar: within storm-surge reach (2.5 m reference). Faded: below your <n> m need."
- Summer chart:
  - Headline: "Within about 1 cm of the airport pad every summer." or "Outside the ±1 cm band in at least one summer."
  - Sub: "Typical summer: 0.2 cm more movement than the airport pad."
  - Legend: "±1 cm: can't tell from the airport pad" · "Median, cm (down = sank more)".
  - Note box: "The 2021–23 pattern did not predict 2024–25 (skill −0.24 against "no motion"), so this can't confirm the ground either way."
  - Flag chip: "<n> squares moved more than expected in summer 2025" or "Nothing moved more than expected in summer 2025".
- Coast:
  - Big number "On the shoreline" (sub "The 2025 waterline touches this land") or "1.4 km" (sub "from the 2025 shoreline").
  - Change sentence: "Moved 3 m landward between 2005–09 and 2021–25 (±15 m)." If the change is 15 m or less, add "Within the error: can't tell from no change."
  - Inland: "More than 300 m inland: the coast is not a factor here, so the tier reflects height and ground."
  - No transect: "No measured transect near this land."
  - Note box: "Arrival years are hidden: our shoreline forecast missed by 48 m on average, worse than assuming no change (14 m)."
- Coring chip: "<n> promising, unconfirmed · <n> conflicting evidence", or "No coring flags inside this selection." Button "Show on the map".
- Save: "Save to compare as A/B/C". Notes: "Keeps this check for Side by side, below." · "Already in Side by side." · "Side by side holds three. Remove one first."

**Side by side:** title "Side by side", sub "Your needs, applied to every saved check. Up to three." The unsaved column reads "not saved yet". Buttons: "Select on map" · "Remove".

**How do we know?** Title "How do we know?", sub "Each test was fixed before we saw the answer. Failures stay on the page." Cards; the site reads these from `validation.json`, and this is the wording the pipeline should write:

| id | Title | Number | Baseline line | Plain sentence |
|---|---|---|---|---|
| `test_a` | Do radar patterns repeat? | −0.24 skill | Baseline: "no motion" (skill 0). Block ρ 0.31 · κ 0.14. Post-hoc deramp: ρ 0.52, still fails. | Radar can't yet tell stable from degrading ground here at 80 m. |
| `test_b` | Does NISAR agree? | 0.01 ρ | Needs a connected series of at least five dates. | One pair failed to unwrap and several lost coherence, so 2026 has no connected series. |
| `model_b` | Predict where radar can't see | 110 of 300 examples | Needs 300 measured examples of degrading ground in 15 blocks. | Too few examples to learn from, so no predicted layer exists. |
| `model_c` | Can we forecast the shoreline? | 48 m average error | Baseline: "no change", 14 m error. | The 30 m satellite waterline is too noisy. Arrival years are hidden; measured change is shown instead. |
| `reindeer` | Reindeer Point reports | 0% degrading by radar | Needs the ground prediction. A consistency check, never proof. | Homes sit on gravel pads; at 80 m radar can't separate pad settling from ground thaw. |

Two boxes follow the cards:
- "What still works": "Height above sea, distance to the 2025 shoreline, measured shoreline change and distance to the highway are measured directly. The screen leans on these."
- "What we don't predict": "Ground condition under a single house · when the coast arrives · sudden collapse or the damage from one storm."

**Limits** (fallback if `manifest.limits` is missing): "Block scale: 240 m squares, 80 m radar" · "Thaw season only (June to September)" · "Motion is relative to the airport gravel pad" · "A screen, not an engineering sign-off" · ""Lower-risk" doesn't mean "safe"".

**About modal:** title "About Ground Check", then three paragraphs:
1. "Free radar from Sentinel-1 (2021–2025) and NISAR (2026) was tested for whether it can tell stable from degrading ground around Tuktoyaktuk. At 80 m it can't yet: relative to the airport gravel pad, almost all land moves within about 1 cm per summer, and the patterns didn't repeat between years."
2. "What the screen does use is measured directly: height above sea, distance to the 2025 shoreline, measured shoreline change, wetness and distance to the highway. Select land, set what you need, and the check returns a second-move risk tier with its drivers. It never gives a percentage or names a best site."
3. "Squares that meet all five needs, with nothing flagged by radar, are marked promising, unconfirmed."

Keep the existing credits list and the community-knowledge line, and add "Landsat (USGS) and Sentinel-2 waterlines" and "© OpenStreetMap contributors (ODbL)".

**Loading, empty and error states**

| Case | What shows |
|---|---|
| Loading | Grey page skeleton with "Loading the map…" (keep `.loading`) |
| `manifest.json` fails | Full-page message: "We couldn't load the map data. Try again in a minute." Small detail line: "<file>: HTTP <code>" |
| `areas.geojson` fails | Map with basemap only. Panel says "The screening grid didn't load, so selection and the check are off." Tiles show "–" |
| A raster fails | That layer's button is disabled, with title "Not available right now". Other layers work |
| `timeseries.json` fails | Named presets fall back to the cell medians. If those are absent too: "Per-summer numbers didn't load." |
| `validation.json` fails | "Test results didn't load. Nothing here counts as passed." The hero tile shows "–" |
| `coastline.geojson` fails | Coast layer shows distance bands only, with "Shorelines didn't load." |
| A summer has no radar for the selection | The column reads "no data" |
| Selection is all water | Not possible: only cells are selectable |

## 5. Colour tokens (`lib/tokens.js`)

Colour-blind safe: tiers rise in darkness, so they read without hue, and the hatches carry meaning on their own. Can't measure is always a cross-hatch, never flat, never teal.

| Token | Value |
|---|---|
| page / card / inset | `#F7F2DC` / `#FFFCF0` / `#ECE4B7` |
| text / muted | `#311E10` / `#5E4733` |
| CTA (Run button, change dot) | `#DD6031`, hover `#C4532A` |
| water | `#A3BAC3` |
| tier lower / moderate / higher | `#DCEDD2` / `#E9B949` / `#7A3214` (text on higher: `#FFFCF0`) |
| tier not enough data | Cross-hatch `#5E4733` on `#D9D3BD` |
| height bins | `#2F3A5E` · `#5D6680` · `#9A967E` · `#CDBF7E` · `#F2E6A6` |
| coast distance | `#2F3A5E` ≤100 m · `#93A0BC` 100–300 m · `#F2EBD3` over 300 m |
| transects | Within ±15 m `#5E4733` at 45% · 15–40 m `#E08214` · over 40 m `#7A3214` · seaward `#542788` |
| radar classes | Stable `#2E7D8C` · seasonal only `#E9B949` · degrading `#B8521A` · can't measure cross-hatch |
| motion (PuOr) | `#B35806` · `#FDB863` · `#F4EEDC` · `#B2ABD2` · `#542788` · no record: stripe `#A8977A` on `#E5DCB0` |
| core | Promising `#1F6F7D` · conflicting ▲ `#311E10` with cream edge · other land `#E7E0C4` |
| pills | MEASURED solid 1.5 px · UNCONFIRMED dashed · NOT RUN dotted · PREDICTED dashed with a light fill (reserved) · DEMO coffee stripes |
| type | Fraunces for headings and numbers; Atkinson Hyperlegible for text |

## 6. Data contract v2 (`frontend/public/data/`)

`lib/data.js` loads `manifest.json` first, then the files it names in parallel. Any file except the manifest may be missing (§4). Keep reading v1 keys (`seasons`, `zones`, `colour_range_cm`) when `schema` is absent, so the current demo still loads.

| File | Required fields (v2) | Optional, used if present |
|---|---|---|
| `manifest.json` | `schema: 2`, `mock`, `generated_at`, `bounds` [-133.30, 69.20, -132.85, 69.48], `latest_pass {date, sensor}`, `update_status`, `layers {behaviour, motion{year: {image, valid_share, sensor}}, elevation}`, `statuses {test_a, test_b, model_b, model_c}`, `files {areas, timeseries, validation, coastline}` | `limits[]`, `town_bounds` |
| `rasters/*.png` | `behaviour.png`, `motion_2021…2025.png`, `elevation.png`, each 900×560 on the bounds | – |
| `areas.geojson` | `schema: 'areas/2'`, `settings`. Named features carry full Part 4 properties. Cell features: Polygon geometry plus `id, tier, coring, h, hw, sea, wet, cov` | Cells: `p10`, `low` (share below 2.5 m), `chg` (m, within 300 m of shore), `dom` (dominant class), `mv` [5 summers, cm], `flag` (2025) |
| `timeseries.json` | Per named area, per summer: `[{date, cm}]` (measured median) and `expected` where available | – |
| `validation.json` | `[{id, title, status, headline: {value, unit}, baseline, plain, method}]` | `ci95` |
| `coastline.geojson` | Dated shorelines (`date`, `source`, `position_error_m`), 1985–2025. Transects (`id`, `measured_change {landward_m, se_m, from, to}`) | – |

Example of a compact cell, values from the real `C042_090`:

```json
{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[...4 corners...]]},
 "properties":{"id":"C042_090","tier":"moderate","coring":"promising_unconfirmed",
  "h":4.3,"hw":79,"sea":384,"wet":0.32,"cov":1.0,"p10":1.7,"low":0.16,"dom":"stable",
  "mv":[-0.2,-0.6,-1.3,-0.4,0.3],"flag":false}}
```

This cell shows why the tier and the coring flag are separate: its median height passes the 4 m need, but its lowest tenth (1.7 m) is near the surge reference, so it is moderate and still promising.

**Budget:**
- `areas.geojson` gzipped ≤ 250 KB: round coordinates to 5 decimals and numbers to 1 decimal.
- Each PNG ≤ 120 KB, indexed colour.
- First load under 2 MB: MapLibre about 220 KB gz, React and Recharts about 120 KB gz, data about 600 KB, Esri tiles on demand.

## 7. Accessibility

- **Contrast:** body text is at least 4.5:1 on every surface:
  - Cream on higher (`#7A3214`): 8.9:1.
  - Coffee on moderate: 8.7:1.
  - Coffee on lower: 12.9:1.
  - Muted on page: 7.7:1.
  - Cream on the Run button (`#DD6031`): 3.5:1. That only passes as large text, so the label stays 20 px bold.

  Pills carry text, not colour alone.
- **Focus order:** strip → header → hero tiles → layer switch → tools → step bar → legend options → Try chips → needs → Run → report → Save → compare → tests. Visible focus: a 3 px coffee outline.
- **Map text alternatives:** the Try chips and CoreList "Select" buttons are the keyboard path into the map. The readout is `aria-live="polite"`. Each chart has a `role="img"` label with all its numbers (see the canvas `aria-label`s).
- **Colour is never the only signal:** tiers carry bars (1, 2, 3), glyphs carry ✓ ◐ ✕ –, and statuses carry words.
- **Targets:** at least 44 px; Try chips at least 36 px with 6 px gaps.
- **Motion:** `prefers-reduced-motion` removes the scan, the marching box and all transitions.

## 8. Ten-minute manual test (do at 390 and 1440)

1. Load with the network throttled to Slow 4G. The skeleton appears, then the page within 6 s. No console errors.
2. Rename `validation.json`, then `coastline.geojson`, then one raster: each state in §4 appears and the rest of the page still works.
3. Each layer button changes the fill and legend. Radar 2026 shows the note card and stripes. Coast date buttons move the solid line.
4. Box-select a block near highway km 14, then paint two squares, then erase one. The name updates (for example "2 km west of highway km 14"). The Run button reads "Run the check again" and the old report fades.
5. Run. The tier, drivers, histogram, summer bars and coast chart all match the readout of a square inside.
6. The Try chips reproduce the canvas: The Point, Town core and Reindeer Point Higher; Highway km 26 Lower and "Meets 4 of 5".
7. Change "Away from the shore" to Any: the glyph turns ✓ without re-running, and Side by side updates.
8. Save C. A fourth save is refused with "Side by side holds three. Remove one first."
9. Keyboard only: reach Reindeer Point, run, save. Focus is always visible. Escape closes About.
10. Search the DOM text: no "safe" except inside "doesn't mean "safe"", no "%" next to a tier, no year after 2026, no NASA logo.

## 9. 30-second demo path (one take at 390 px)

| s | Screen | Says |
|---|---|---|
| 0–4 | Hero | "Satellites can't yet certify ground in Tuk." |
| 4–9 | Screen layer, Region | Red on the shore, pale inland along the highway |
| 9–14 | Reindeer Point chip → Run | "Higher: on the shoreline. Ground unconfirmed." |
| 14–19 | Side by side: The Point · Highway km 26 · Reindeer Point; set Height to 8 m or more | Reindeer Point (8.1 m) and km 26 still pass on height; only the shore keeps Reindeer Point back |
| 19–23 | Core next + list | "763 squares worth a core, ordered by distance, not ranked." |
| 23–27 | Coast, 2005 vs 2025 | Measured change, ±15 m; no arrival years |
| 27–30 | Test card "−0.24" | "Every failed test stays on the page." |

**Slides** (at most 7): hero · Screen map · Reindeer Point report · Side by side · Core next · Coast · test cards.

## 10. Open questions for the frontend lead

1. **Freshness line:** it names a NISAR pass (11 Oct 2026) although NISAR gave no usable series. Keep the exact line (current rule) or switch to the last usable pass, Sentinel-1 5 Oct 2025?
2. **Model C headline:** `eval.json`'s `model_c.headline` says 73 m against baselines of 36 m and 19 m, but `metrics` say 48.2 m, with 28.2 m for the regional rate and 13.8 m for no change. The canvas uses `metrics`. Which does `validation.json` carry?
3. **Optional cell fields:** without `p10`, `low` and `mv` in the compact cells, drawn selections use the median-height fallback and have no summer chart. Add them to the export (+ about 60 KB)?
4. **Radar coverage:** Sentinel-1 read only about 20% of the land in 2022–2024. Show those years at all, or grey them as "partial coverage"?
5. **Default tool:** the canvas has no Move tool because it is static. Confirm Move as the touch default, and whether a long-press should start a box selection.
