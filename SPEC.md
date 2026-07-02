# Windmap — Blue Lake Wind Exposure Simulator

**Status:** Spec v0.1 (Phase 5 of /spec — drafted in local sandbox, no GitHub issue)
**Owner:** User (solo, Blue Lake angler)
**Last updated:** 2026-07-02

---

## 1. Why

### Who is affected
A solo kayak angler (the user) who drives ~40 minutes to Blue Lake, Zimmerman, MN to fish, and has a real recurring problem: deciding whether current wind conditions will make the lake too choppy to safely launch and fish.

### Current behavior
- User checks the iOS Weather app for current wind speed and direction.
- If forecast wind is <12 mph, goes without further thought.
- If 12-15 mph, hesitates; if >15 mph, usually skips.
- Occasionally goes at 12-15 mph; experiences the "80/20" outcome — 80% of the lake is too choppy, ~20% is unexpectedly calm because it's blocked by tree lines or bluffs.

### Desired behavior
User opens a single screen, sees a colored map of Blue Lake with each cell shaded by *effective wind* (real NWS wind rotated/attenuated by shoreline fetch + ray-cast shadowing from terrain/tree obstructions), and can drag a 24-48h time slider to find the calmest window. A 5-second glance replaces the 12-mph gut-check.

### Why now
This is a personal-utility project. The "blocker" is real: every missed-OK day wastes ~1.5 hours of drive time. But the real reason to build it now is that the user wants to *finish* a small app, and this is the right shape (concrete data, real pain, bounded scope, one lake). See `AGENTS.md` for the "10% and stop" pattern we are trying to break.

### Done when
- The page loads in a browser (locally or on the user's phone via Tailscale/static host).
- The user sees Blue Lake's outline with cells colored green/yellow/orange/red by current effective wind.
- Dragging the time slider recomputes the map for that hour using the NWS forecast.
- A "Refresh" button re-fetches the NWS hourly forecast.
- The user trusts it enough to use it instead of the weather app on a Sunday morning.

---

## 2. Scope

### In scope (v1)
- **One lake:** Blue Lake, Zimmerman, MN (DNR ID 30010700)
- **One data source for wind:** NWS hourly forecast (free, public, no key, verified working)
- **Lake geometry:** official MN DNR KML outline (1,228-vertex polygon, already in `blue_lake.kml`)
- **Terrain shadow layer v1:** hand-curated tree-line + bluff polygons as JSON (no scraping, no API, honest about coverage)
- **Visualization:** colored map (SVG), 24-48h time slider, current-conditions header
- **Refresh:** hourly background fetch + manual "Refresh now" button (no websocket, no live)
- **Stack:** single static HTML + tiny JS file, no build step, no node_modules
- **Server:** `python -m http.server` or open `index.html` directly (works either way)

### Out of scope (v1)
- Other lakes (modular lake JSON makes them easy to add later, but not built)
- "Fishable %" headline number (deferred — color map is sufficient signal)
- Mobile-native app (a static HTML page works on phone browsers)
- Live/websocket data (NWS forecast updates hourly, that's fine)
- Depth contours (DNR KML has outline only; depth contour data lives on the Lakefinder page table, not in the KML)
- 3D rendering of the lake (SVG top-down is enough; we are not building a flight sim)
- Real CFD / fluid simulation (decision D2: vector field + ray-cast shadowing is the chosen model, not Navier-Stokes)
- MnTOPO LiDAR (real elevation data — kept as a future option, not used in v1)
- Auth, accounts, multi-user, deploy to production (this is a personal tool, runs on the user's machine / phone)
- Telemetry, analytics, error reporting (keep the dep list at zero)

### Ordering constraints
1. Lake outline + terrain JSON must be ready before the map renderer (the renderer reads them).
2. NWS API integration must be working before the time slider (the slider is meaningless without data to feed it).
3. "First slice" success criteria (see §4) must pass before polishing.

### Failure modes / rollback
- **NWS API down or rate-limited:** show the last successful forecast + a "stale" badge. Don't crash. Don't 500.
- **Lake outline or terrain JSON missing:** show a friendly error in the map area, not a blank screen.
- **No internet at all:** cache the last successful NWS response in localStorage, show that. Page still loads.
- **Browser too old for the SVG features used:** we're using basic SVG — works in any browser made this decade. If a user finds one that breaks, we add a feature check.

---

## 3. Technical Design

### Visual design (D7 — Vercel + Stripe fusion)

Source-of-truth for the visual language. Borrowed from the `popular-web-designs` skill (Vercel template + Stripe gradient discipline), customized for a single-lake, single-purpose tool.

**Canvas:**
- Page background: `#fafafa` (off-white, "gray 50" — warmer than pure white, easier on the eye for outdoor check)
- Card / map surface: `#ffffff` with the Vercel shadow-as-border treatment: `box-shadow: 0 0 0 1px rgba(0,0,0,0.08), 0 2px 2px rgba(0,0,0,0.04), 0 8px 8px -8px rgba(0,0,0,0.04)`
- Outer body: zero margin, `min-height: 100vh`, single column on mobile, max 720px wide on desktop (this is a *tool*, not a *page*)

**Typography:**
- Primary: Inter (Geist substitute, available on Google Fonts), weights 400 / 500 / 600
- Mono: JetBrains Mono (for the wind speed / "X.X mph" readout)
- Hierarchy: one heading only (lake name + current conditions, 24-32px, weight 600), no sub-heads, body text 14-16px
- Tracking: -0.01em on the heading, normal elsewhere. No aggressive negative tracking (this is not a marketing site)

**Color palette (the wind scale is the *only* chromatic decision):**
- Background: `#fafafa`
- Surface: `#ffffff`
- Text primary: `#171717`
- Text secondary: `#666666`
- Text muted: `#999999`
- Border (via shadow): `rgba(0,0,0,0.08)`
- Lake water fill: `#e8f1f8` (very pale blue, so cells stand out)
- Lake outline: `#93b6cf` (medium blue, the user's "blue lake" cue)
- Wind scale bands:
  - Slack (<6 mph): `#7ec47e` (sage green)
  - Marginal (6-8 mph): `#f5d76e` (warm yellow)
  - Choppy (8-15 mph): `#f59e63` (warm orange)
  - No go (>15 mph): `#e26464` (soft red, not garish)
- Tree polygons: `rgba(98, 130, 89, 0.35)` (forest green, semi-transparent so cells near trees are still visible)
- Boat launches: `#1e6091` (deep blue dots, 4px radius)

**Layout (mobile-first, single column):**
```
+--------------------------------+
| [lake name, 24px]              |  ← header, weight 600
| 12 mph W • 38°F • 10:14 AM     |  ← meta line, mono, 14px
|                                |
|  +--------------------------+  |
|  |                          |  |
|  |    [map of lake,         |  |  ← the map. The hero. ~70% of the
|  |     colored cells,       |  |    viewport. Drop-shadowed card.
|  |     tree polygons        |  |    Hover/tap a cell to see exact
|  |     behind, boat         |  |    effective-wind mph. Wind arrow
|  |     launches marked]     |  |    icon top-right of the map.
|  |                          |  |
|  +--------------------------+  |
|                                |
| [●———————————●—————]  2pm       |  ← time slider, full width
| Best: 7am-9am                   |  ← "best window" chip, pill shape
|                                |
| [↻ Refresh]      Updated 10:14 |  ← footer line, 12px muted
+--------------------------------+
```

**Interactions:**
- Time slider drag: re-runs wind lookup + recolors cells, <200ms target. No debounce — modern browsers handle the throughput.
- Slider tap on the "Best: 7am-9am" chip: moves slider to start of best window.
- Cell tap (touch) / hover (mouse): shows exact effective-wind mph in a small tooltip anchored to the cell.
- Refresh button: small, 32px, ghost button (white surface, shadow-as-border), shows spinner during fetch.
- Wind arrow in header: 20px SVG, neutral gray, rotates with the time slider.

**Empty / error states:**
- First paint (NWS still fetching): the map shows the lake outline in a neutral pale blue (no cells yet), with a small "Loading wind data..." caption in the header meta line.
- NWS down, no cache: the map shows the lake outline + a centered message: "Couldn't reach the National Weather Service. Try refreshing, or check your connection."
- NWS down, cache available: map renders the cached data, header shows a small "stale" pill (yellow, 12px) next to the timestamp.
- `file://` mode, no cache: same as "NWS down, no cache" but the message says "Serve this folder over http — `python3 -m http.server 8000`."

**Spacing:**
- 8px base unit. Generous padding inside the map card (24px). Header padding 16px. Slider padding 12px.
- No sections fighting for attention. The map is the only visual hero; everything else is supporting.

**What this is NOT:**
- Not a marketing page. No hero text, no "Sign up" CTA, no carousel.
- Not a dashboard. No charts, no tables, no metrics.
- Not dark mode. The user is checking this in daylight, on a phone, before driving to a lake.
- Not "AI-generated pretty." No card grids, no 3-column features, no hero illustration. The map is the only visual.

**Shadows / depth philosophy:**
- One signature card shadow on the map (the Vercel multi-layer).
- Everything else (chips, buttons, slider) uses the shadow-as-border treatment.
- The 4-band wind colors are flat fills, no gradients on the cells (gradients would muddy the cell boundaries and the user needs to see distinct zones).
- One allowed gradient: the lake water fill, a very subtle vertical `#e8f1f8` → `#dde9f1` over 200px. Almost imperceptible; just enough to make the water feel like water, not a flat shape.

**Font loading:**
- Google Fonts: `<link rel="preconnect" href="https://fonts.googleapis.com">` and Inter + JetBrains Mono weights.
- If the page loads slow on a phone (the user is sometimes in low-signal areas on the way to the lake), fall back to system stack — the design works fine with `-apple-system, Segoe UI, Roboto`.

### Stack
- **Frontend:** single `index.html` + `app.js` + `style.css`. Vanilla JS, no framework. SVG for the map.
- **Lake config:** `lakes/blue-lake.json` (outline + terrain polygons + boat launches). Trivially extensible to other lakes.
- **Wind data:** fetched at runtime from `https://api.weather.gov`. Cached in `localStorage` with timestamp.
- **Build:** none. Open the HTML in a browser. Run `python -m http.server` for testing.

### File layout
```
windmap/
├── AGENTS.md              # project context + decisions log
├── SPEC.md                # this file
├── blue_lake.kml          # raw MN DNR data, source of truth for outline
├── lakes/
│   └── blue-lake.json     # curated lake config (outline + terrain)
├── index.html             # entry point
├── app.js                 # fetch + render logic
├── style.css              # colors, layout
└── vendor/                # (empty in v1, no deps)
```

### Data shapes

**`lakes/blue-lake.json`:**
```json
{
  "id": "30010700",
  "name": "Blue Lake",
  "location": "Zimmerman, MN",
  "center": [45.478, -93.4997],
  "outline": [[-93.492821, 45.492210], ...],   // from KML, ~1,228 points
  "tree_polygons": [
    { "name": "north-shore-woods", "polygon": [[lat,lon], ...] }
  ],
  "elevation_polygons": [
    { "name": "south-bluff", "polygon": [[lat,lon], ...], "height_m": 8 }
  ],
  "boat_launches": [
    { "name": "NW Public Access", "lat": 45.482878, "lon": -93.499559 },
    { "name": "SE Public Access", "lat": 45.471328, "lon": -93.497444 }
  ]
}
```

**NWS API response (relevant fields):**
- Endpoint: `https://api.weather.gov/gridpoints/MPX/95,94/forecast/hourly` (resolved via `/points/45.44,-93.65`)
- Per-period object: `windSpeed` (string with two values, e.g. "10 mph"), `windDirection` (cardinal), `startTime`, `endTime`
- Parse the average of the windSpeed range into a number; convert windDirection from cardinal to a unit vector (N=0° → unit vector pointing *toward* the wind's source, then negate for the direction the wind is going *to* — convention is "wind from the NW" means the wind blows *toward* the SE).

### Wind model (model flavor B from D2)

For each ~10m cell inside the lake polygon, compute effective wind:

1. **Shoreline fetch factor:**
   - For the cell, compute the vector pointing *offshore* (perpendicular to the nearest shoreline segment, pointing inland to water).
   - `fetch_factor = max(0.2, dot(wind_unit_vector, offshore_unit_vector))`
   - Cells in coves where wind blows parallel to shore get the minimum (0.2x). Cells with wind blowing directly offshore get the full factor (1.0x).

2. **Terrain shadow (ray-cast):**
   - From the cell, cast a ray toward the upwind direction for up to 300m (D5).
   - Step the ray at 5m intervals. Convert lat/lon to local meters using an equirectangular projection centered on the lake's center.
   - If the ray crosses a `tree_polygon` edge first, set `terrain_attenuation = 0.25` (D5).
   - If it crosses an `elevation_polygon` edge first, set `terrain_attenuation = 0.10` (D5).
   - If it hits nothing, `terrain_attenuation = 1.0`.

3. **Effective wind (mph):**
   - `effective_wind = nws_wind_mph × fetch_factor × terrain_attenuation`

### Color scale (D5)
| Effective wind (mph) | Color  | Label     |
|----------------------|--------|-----------|
| < 6                  | green  | slack     |
| 6 – 8                | yellow | marginal  |
| 8 – 15               | orange | choppy    |
| > 15                 | red    | no go     |

### Time slider
- Range: next 48 hours from the most recent NWS forecast start time.
- Step: 1 hour.
- Default position: the hour closest to "now" at page load.
- On change: recompute the map for the selected hour. (Re-render the SVG cells, not the whole page.)

### Refresh
- On page load: check `localStorage` for a cached NWS response. If it's <60 min old, use it. Otherwise fetch.
- Hourly timer: re-fetch every 60 minutes while the page is open. If the tab is backgrounded, modern browsers throttle setInterval — that's fine, "Refresh now" exists.
- "Refresh now" button: always fetches, ignores cache, updates timestamp.

### Rendering
- SVG, viewBox set to the lake's bounding box with a small margin.
- Lake outline as a `<path>` with the KML coordinates, transformed to local meters.
- Cells: rasterize the lake polygon into a 100×250 grid (roughly 10m × 14m cells, given lake is ~1.4km × 3.5km), color each by effective wind. Render as a `<g>` of `<rect>` elements — fast, debuggable, hoverable for an optional tooltip.
- Tree polygons: drawn as semi-transparent green shapes around the lake.
- Boat launches: small markers with labels.
- Header: "Blue Lake — current conditions" + wind speed/direction text + last-updated timestamp.
- Slider: HTML `<input type="range">` styled minimally.

### Performance budget
- First paint < 1 second on a phone browser.
- Time-slider drag → re-render < 200ms for 25,000 cells (this is the only part that has to feel snappy).
- NWS fetch: < 2 seconds typical, < 5 seconds hard cap before showing stale cache.

---

## 4. First-slice success criteria (Phase 1 gate)

Before we call Phase 1 done, the user must be able to:

1. Open `index.html` in a browser and see Blue Lake's outline filled with colored cells.
2. The current hour (loaded from a *real* NWS fetch, not a hardcoded value) shows *some* realistic mix of colors — at least 3 of 4 color buckets are visible across the lake on a typical day.
3. A wind direction change (use the time slider to a different hour) visibly rotates the shadow pattern — the green cells should be in different places.
4. The "Refresh now" button works and updates the timestamp.
5. With the browser dev tools open in offline mode after a successful first load, the page still renders from the cache.

If any of those fail, Phase 1 is not done. Don't move to Phase 2 (polish + edge cases) until all 5 pass.

---

## 5. Open questions (deferred to v2 or as they come up in build)

- **Tuning the model to match real-world feel:** user said "on a 15mph day the slack water felt like ~5mph" — that's a useful signal for tuning `tree_attenuation` down from 0.25 toward 0.1. Defer until we have a real test case.
- **OSM Overpass for tree data:** worth trying if hand-curating the first 5 lakes gets tedious. Quality near Blue Lake TBD.
- **MnTOPO LiDAR for elevation:** deferred unless the 2D terrain polygons prove insufficient.
- **Multiple lakes:** the JSON config makes it a copy-paste exercise. The hard part is the terrain data per lake.
- **"Fishable %" headline number:** easy to add once the map works. Just count green+yellow cells.
- **Cell hover/tap tooltip (exact mph):** ~10 lines, defer to v2.

---

## 4.5 Edge-case addenda (from `REVIEW.md` eng E1–E10 + design T1/T2)

These pin down the details the original spec glossed over. Every item here is required reading before phase-1 code lands.

### Wind direction convention (E1 — critical)
NWS `windDirection` is a cardinal string (e.g. `"W"`, `"NW"`) representing where the wind is *coming from*. Conversion:
- `"N"` → wind from north, unit vector toward wind = `(0, -1)` (north-up coordinate)
- `"E"` → `(1, 0)`
- `"S"` → `(0, 1)`
- `"W"` → `(-1, 0)`
- Intercardinals (NE, SE, SW, NW): unit vector at 45° between the two cardinals.
- The unit vector we use for the model is the *direction the wind is going to* — i.e. the *negation* of "where it's coming from."

The ray-cast casts from each cell in this "going to" direction (so it hits obstacles *upwind* of the cell). **Implementing this backwards puts every shadow on the wrong side of every tree.**

### windSpeed range parsing (E2)
NWS `windSpeed` is a range string. Examples: `"10 mph"`, `"10 to 15 mph"`, `"Calm"`, `"5 to 10 mph"`. Parse rule:
- One number → use that number.
- Two numbers ("X to Y") → use the average `((X+Y)/2)`.
- `"Calm"` → `0`.
- Empty / unparseable → skip that period (don't render a time-slider tick).

### Calm / zero-wind handling (E3)
`windSpeed = 0` is a real and frequent value. When `nws_wind_mph === 0`:
- `effective_wind = 0` for every cell (no need to run the model).
- All cells render green. No division-by-zero risk in the model.

### 2D-only polygon treatment (E4)
The KML polygon has `Z=0` on every vertex. **Ignore Z, treat the polygon as 2D.** A future maintainer should not try to parse Z. Add a one-line comment in the KML parser.

### Geometry projection (E5, E6)
- All geometry — lake outline, tree polygons, cell centers, ray-cast steps — is projected from lat/lon to local meters using an equirectangular projection centered on the lake's centroid.
- At 45°N latitude and a 1.4km × 3.5km lake, the equirectangular approximation introduces <0.5% error at the corners. Fine for v1.
- Projection must be applied to **all** geometry in the same coordinate system, or the ray-cast is meaningless.

### Ray-cast algorithm (E6)
For each cell:
1. From the cell center, step 5m in the upwind direction (toward where the wind is *coming from* — opposite of the unit vector used for fetch factor).
2. Max 60 steps = 300m.
3. At each step, do a point-in-polygon test against every `tree_polygon`. If a tree polygon contains the step, that's a hit.
4. First hit wins:
   - If a `tree_polygon` hit → `terrain_attenuation = 0.25`
   - If an `elevation_polygon` hit → `terrain_attenuation = 0.10`
   - If no hit in 300m → `terrain_attenuation = 1.0`
- Tie-breaker: elevation polygons checked first, then tree polygons (elevation is a stronger attenuator).

### First-paint performance (E7)
The 25,000-cell grid geometry is computed **once on first load** and held in memory. Time-slider drag and refresh only re-run the *wind lookup + color step*, not the geometry step. Target: time-slider drag < 200ms.

### `file://` mode and CORS (E9)
NWS API supports CORS (`Access-Control-Allow-Origin: *`) so `http://` works. `file://` mode will fail the NWS fetch:
- If `localStorage` has cached data → render the cache, show "showing cached data" badge.
- If no cache → show a friendly "serve this folder over http — try `python3 -m http.server 8000`" message instead of the map.

Recommended dev workflow: `cd /home/reid/projects/windmap && python3 -m http.server 8000`, then open `http://localhost:8000` on the phone (via Tailscale) or laptop.

### Refresh race (E10, doc-only)
Manual "Refresh now" and the hourly timer can fire concurrently. NWS tolerates the duplicate. Do not add a mutex; this is a 1-in-1000 edge case for a personal tool.

### Wind arrow in header (CEO T1)
A single SVG arrow in the header showing current wind direction — i.e. pointing in the direction the wind is *going to*. Updates with the time slider. Drawn at 24px, neutral gray, in the same line as the wind speed text. Zero extra real estate; completes the "wind awareness" picture.

### "Best window" chip near the slider (Design T2)
The time slider by itself is just a control. To make it answer the user's actual question ("when should I go?"):
- Scan the next 48h of the NWS forecast.
- Find the 2-3 hour contiguous window with the **lowest mean effective-wind** across the lake.
- Render as a small chip near the slider, e.g. "Best window: 7am–10am."
- Tapping the chip moves the slider to the start of that window.
- If no forecast is available (NWS down), don't render the chip.

This is ~20 lines of JS (find min-wind window + render chip) and ~5 lines of CSS. **In v1, not v2.** It's the second half of the product.

---

## 6. References

- `AGENTS.md` — project context, decision log (D1–D5)
- `blue_lake.kml` — raw MN DNR data, source of truth for the lake outline
- NWS API docs: `https://www.weather.gov/documentation/services-web-api`
- MN DNR Lakefinder: `https://www.dnr.state.mn.us/lakefind/lake.html?id=30010700`
