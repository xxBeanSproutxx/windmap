# Live Wind Data — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Split data so the heavy static stuff (shoreline, grid, fetch, NLCD) is generated once, and the frontend fetches live wind directly from Open-Meteo on every page load or refresh — no cron, no SSH, no re-running the engine.

**Architecture:** `lake_data.json` shrinks to geometry + pre-computed fetch distances. The browser calls Open-Meteo's public API for current wind, then recomputes impact scores in JavaScript using the same formulas as the Python engine. Two data sources, one render pipeline.

**Tech Stack:** Open-Meteo API (free, no key), JavaScript fetch(), existing Leaflet render pipeline.

---

## Current State

- `compute_engine.py` does everything: fetches wind, computes impact scores, writes full JSON including wind hourly array and per-cell impact_score
- `lake_data.json` is ~400KB with baked-in wind from whenever the engine last ran
- The refresh button re-fetches `lake_data.json` from disk — same stale wind until engine re-runs
- The Python engine takes ~12 seconds (NLCD WMS queries) — too slow for on-demand use

## Target State

- `compute_engine.py` generates a lightweight `lake_static.json`: polygon, shoreline segments, grid cells with lat/lon/fetch_km/nlcd_*/shore_distance_m/shore_normal_deg — everything EXCEPT wind and impact_score
- `index.html` fetches TWO things on load: `lake_static.json` (cached) + Open-Meteo API (live)
- JavaScript recomputes `impact_score` per grid cell using the same formula as Python
- Refresh button re-fetches only the Open-Meteo API, not the static data
- No cron job needed. No engine re-run needed unless the shoreline or NLCD data changes.

---

## Task 1: Create static data output from compute_engine.py

**Objective:** Split the engine so it can output geometry-only data without wind baked in.

**Files:**
- Modify: `engine/compute_engine.py`

**Changes:**

Add a `--static` flag:

```python
parser.add_argument("--static", action="store_true",
                    help="Output static geometry data only (no wind fetch)")
```

When `--static` is passed:
- Skip the Open-Meteo fetch entirely
- Skip NLCD WMS queries if they're already in the output (they're already in grid cells from prior runs)
- Actually — NLCD data is already embedded in grid cells from the last full run. The static output just needs to strip wind fields and impact_score.

In `main()`, after computing shoreline and grid, if `--static`:

```python
if args.static:
    static_output = {
        "lake": output["lake"],
        "shoreline": output["shoreline"],  # already has nlcd_class etc
        "grid": output["grid"],            # already has lat/lon/fetch_km/nlcd_*
        "generated_at": datetime.now().isoformat()
    }
    # Strip wind-dependent fields from grid cells
    for cell in static_output["grid"]:
        cell.pop("impact_score", None)
        cell.pop("wave_height_m", None)
        cell.pop("shield_factor", None)
    # Strip wind-dependent fields from shoreline
    for seg in static_output["shoreline"]:
        seg.pop("impact_score", None)
        seg.pop("wave_height_m", None)
        seg.pop("wind_speed_ms", None)
        seg.pop("wind_direction_deg", None)
    
    static_path = args.output.replace("lake_data.json", "lake_static.json")
    with open(static_path, "w") as f:
        json.dump(static_output, f, indent=2)
    print(f"Static data written to {static_path}")
    return
```

**Verify:**
- `python3 engine/compute_engine.py --static` creates `data/lake_static.json`
- File has `lake.polygon`, `shoreline` segments (with nlcd fields, no impact_score), `grid` cells (with fetch_km, no wave_height_m)
- File is smaller than `lake_data.json` (no wind hourly array, no per-cell impact scores)

## Task 2: Add Open-Meteo fetch to JavaScript

**Objective:** Create a JS function that calls Open-Meteo's public API and returns wind data in the same format the render pipeline expects.

**Files:**
- Modify: `web/index.html`

**New function:**

```javascript
async function fetchLiveWind(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${lat}&longitude=${lon}`
    + `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m`
    + `&forecast_days=1`;
  
  const resp = await fetch(url);
  const raw = await resp.json();
  const hourly = raw.hourly;
  
  // Build forecast array matching current format
  const KMH_TO_MS = 1.0 / 3.6;
  const forecast = [];
  for (let i = 0; i < hourly.time.length; i++) {
    const utcTime = hourly.time[i];
    // Convert UTC to CDT (UTC-5)
    const localDt = new Date(utcTime + 'Z');
    localDt.setHours(localDt.getHours() - 5);
    const timeStr = localDt.toISOString().slice(0, 16); // "2026-07-20T07:00"
    
    forecast.push({
      timestamp: timeStr,
      speed_ms: Math.round(hourly.wind_speed_10m[i] * KMH_TO_MS * 100) / 100,
      speed_mph: Math.round(hourly.wind_speed_10m[i] * 0.6214),
      gust_mph: Math.round((hourly.wind_gusts_10m?.[i] || hourly.wind_speed_10m[i]) * 0.6214),
      direction_deg: hourly.wind_direction_10m[i]
    });
  }
  return forecast;
}
```

## Task 3: Port impact score computation to JavaScript

**Objective:** Mirror `compute_grid()` and `compute_shield_factor()` from Python in JS so the browser can recompute impact scores from live wind + static geometry.

**Files:**
- Modify: `web/index.html`

**Functions to port:**

```javascript
// Mirror Python compute_shield_factor()
function computeShieldFactorJS(distanceM, waterNormalDeg, windDirDeg, nlcdReduction) {
  const SHIELD_DISTANCE_M = 100;
  if (distanceM == null || distanceM >= SHIELD_DISTANCE_M) return 1.0;
  
  const windToDeg = (windDirDeg + 180) % 360;
  let diff = Math.abs(windToDeg - waterNormalDeg);
  if (diff > 180) diff = 360 - diff;
  
  if (diff < 90) {
    const shoreShield = 1.0 - (nlcdReduction || 0.5);
    return shoreShield + (1.0 - shoreShield) * (distanceM / SHIELD_DISTANCE_M);
  }
  return 1.0;
}

// Mirror Python compute_grid() impact formula
function recomputeImpactScore(cell, windSpeedMs, windDirDeg) {
  const shieldFactor = computeShieldFactorJS(
    cell.shore_distance_m,
    cell.shore_normal_deg,
    windDirDeg,
    cell.nlcd_reduction || 0.5
  );
  const effectiveWind = windSpeedMs * shieldFactor;
  const windFactor = effectiveWind / 7.82;  // 7.82 m/s = 17.5 mph
  return Math.min(cell.fetch_km / 1.0, 1.0) * windFactor;
}
```

**Verify:** These produce the same output as the Python versions for a sample cell.

## Task 4: Wire up dual-fetch in index.html

**Objective:** Replace `loadData()` with a version that fetches static geometry once (cached) and live wind on every load/refresh.

**Files:**
- Modify: `web/index.html`

**Changes to `loadData()`:**

```javascript
const STATIC_URL = 'lake_static.json';  // loaded once, cached by browser
let staticData = null;

async function loadData() {
  $loadingBar.classList.add('visible');
  
  try {
    // Fetch static geometry (cached after first load)
    if (!staticData) {
      const staticResp = await fetch(STATIC_URL);
      if (!staticResp.ok) throw new Error('Static data HTTP ' + staticResp.status);
      staticData = await staticResp.json();
    }
    
    // Fetch live wind from Open-Meteo
    const forecast = await fetchLiveWind(45.49, -93.50);
    if (!forecast || forecast.length === 0) throw new Error('No wind forecast');
    
    // Build the combined data object the render pipeline expects
    data = {
      lake_polygon: staticData.lake.polygon,
      grid_cells: staticData.grid,
      shoreline_segments: staticData.shoreline,
      wind_forecast: forecast
    };
    
    // Recompute impact scores for current wind
    const currentWind = forecast[0];
    data.grid_cells = staticData.grid.map(cell => ({
      ...cell,
      impact_score: recomputeImpactScore(cell, currentWind.speed_ms, currentWind.direction_deg)
    }));
    
    // ... rest of render pipeline unchanged ...
    
    $loadingBar.classList.remove('visible');
  } catch (err) {
    console.warn('Could not load data:', err.message);
    showNoData();
    $loadingBar.classList.remove('visible');
  }
}
```

**Important:** The time pill switching also needs updating. When the user picks a different forecast hour, `selectTimeSlot()` must recompute impact scores for that hour's wind, not just recolor. The existing `recolorGridHeatmap()` uses a ratio approach — replace it with a full recompute using `recomputeImpactScore()` for the selected hour's wind.

## Task 5: Generate static data and update run docs

**Objective:** Generate `lake_static.json` and update README run commands.

**Files:**
- Create: `data/lake_static.json` (via `python3 engine/compute_engine.py --static`)
- Modify: `README.md`

**Updated run command in README:**

```bash
# Generate static geometry (one-time, or when shoreline/NLCD data changes)
python3 engine/compute_engine.py --static

# Serve locally
cd web && python3 server.py
```

## Task 6: Update data/ symlink

**Objective:** The old symlink needs to also serve `lake_static.json`. Since it points to `data/`, the new file is automatically available.

**Verify:** `curl http://localhost:8765/data/lake_static.json` returns 200 with valid JSON.

## Task 7: Verification checklist

- [ ] `python3 engine/compute_engine.py --static` creates `data/lake_static.json`
- [ ] `lake_static.json` has NO `impact_score`, `wave_height_m`, or `shield_factor` in grid cells
- [ ] `lake_static.json` has NO `wind` section
- [ ] `lake_static.json` has `lake.polygon`, `shoreline` (with nlcd), `grid` (with fetch_km)
- [ ] `python3 -m pytest tests/ -v` — all 10 tests still pass
- [ ] Server running, page loads, wind shows current data (not stale)
- [ ] Refresh button fetches new wind from Open-Meteo
- [ ] Time pills switch between forecast hours with correct recomputed impact scores
- [ ] Impact score displayed matches what the Python engine would compute for the same wind
- [ ] Git commit all changes

## Risks

- **Open-Meteo CORS:** The browser may block cross-origin requests to api.open-meteo.com. Open-Meteo supports CORS (it's a public API), but verify. If blocked, the fetch will fail and we'll see it in the console.
- **Open-Meteo rate limiting:** 10,000 requests/day free tier. A single page load + occasional refresh is well within limits.
- **JS formula drift:** The JS `recomputeImpactScore()` must stay in sync with Python `compute_grid()`. The existing tests cover the Python side. If we notice divergence, we add JS tests.
