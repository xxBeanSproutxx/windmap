# Fix: Grid Color Consistency Across Identical-Display Wind Conditions

**Date:** 2026-07-23
**Status:** Ready for implementation
**Scope:** `web/index.html`, `web/sw.js`

## Problem

Two adjacent time slots displaying identical wind (same mph, same direction)
produce significantly different grid color patterns. Example: 4:00 AM and
5:00 AM both show "7 mph from 229°" but one displays an orange-dominated
center while the other shows a pink-dominated center. This breaks user trust
in the forecast.

## Root Cause (two compounding bugs)

### Bug 1 — Display rounding hides real wind differences

**File:** `web/index.html`, `fetchLiveWind()`, lines 863-864

```js
speed_mph: Math.round(hourly.wind_speed_10m[i] * 0.6214),     // ← integer
speed_ms: Math.round(hourly.wind_speed_10m[i] * KMH_TO_MS * 100) / 100,  // ← 2 decimals
```

Two forecast entries can display the same "7 mph from 229°" while having
different raw `speed_ms` values (e.g., 3.13 vs 3.33 m/s). The impact
math uses `speed_ms`, so the grid changes even though the pills show
identical stats.

### Bug 2 — Hard color thresholds amplify small differences

**File:** `web/index.html`, `gridImpactColor()`, around line 748

```js
function gridImpactColor(score) {
  if (score > 0.40) return '#db2777';  // pink  — HIGH
  if (score > 0.15) return '#f59e0b';  // orange — MEDIUM
  return '#10b981';                     // green  — LOW
}
```

A cell at impact 0.38 displays orange; at 0.42 displays pink. A 10%
wind change tips cells across this hard boundary, making the grid
look radically different when the underlying change is small.

## Fix Plan

### Part A: Show real precision (fixes Bug 1)

1. Display mph to 1 decimal in time pills
   - Current: `"12:00 AM 6 mph"`
   - New: `"12:00 AM 6.1 mph"`
   - Change the `pill.innerHTML` template in `buildTimePills()`
   - Also add direction to the pill display so the user sees the real values

2. The pill title (tooltip) already shows direction — that's correct. Keep it.

### Part B: Smooth color mapping (fixes Bug 2)

Replace the 3-bucket hard threshold with a continuous gradient that
interpolates between colors based on the impact score.

Replace `gridImpactColor()` with a function that maps impact score
to a smooth color ramp:

```
Score 0.00 → bright green (#10b981)    — LOW impact, safe to paddle
Score 0.20 → yellow (#eab308)          — MODERATE
Score 0.40 → orange (#f97316)          — ELEVATED  
Score 0.60 → red (#ef4444)             — HIGH
Score 0.80+ → deep magenta (#db2777)   — VERY HIGH, stay off the water
```

Implementation: interpolate between these anchor points
using simple linear blending. Each anchor is a {score, r, g, b}.
For a given impact score, find the two bracketing anchors and
lerp between them in RGB space.

Update the legend to use the same continuous scale.
Current legend: 3 categories (High/Medium/Low). 
New legend: show the gradient bar or update categories to match.

### Part C: Housekeeping

- Bump `CACHE_VERSION` in `web/sw.js` (currently v14 → v15)
- Run `python3 -m pytest tests/test_compute_engine.py -q` — must stay 10/10
- Run `node --check web/index.html` for JS syntax

## Files Changed

- `web/index.html` — `buildTimePills()`, `gridImpactColor()`, legend
- `web/sw.js` — `CACHE_VERSION`

## Verification

1. Load the app, compare adjacent time pills with same rounded mph — the
   displayed values should now show the difference
2. Switch between two slots with similar wind — the grid should shift
   smoothly (gradual color change), not jump between categories
3. 10/10 tests still pass
4. No console errors
