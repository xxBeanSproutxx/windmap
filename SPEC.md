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

---

## 6. References

- `AGENTS.md` — project context, decision log (D1–D5)
- `blue_lake.kml` — raw MN DNR data, source of truth for the lake outline
- NWS API docs: `https://www.weather.gov/documentation/services-web-api`
- MN DNR Lakefinder: `https://www.dnr.state.mn.us/lakefind/lake.html?id=30010700`
