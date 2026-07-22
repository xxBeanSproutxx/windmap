# UI Polish Pass — Phase C Polish Batch

**Date:** 2026-07-22
**Branch:** master
**Scope:** `web/index.html` (+ `web/sw.js` version bump)

## Context

Live browser audit of the Blue Lake Wave Forecast PWA revealed 7 small UI issues. None are blockers, but collectively they make the app feel unfinished. This is a single-batch polish pass — all CSS/JS fixes, no backend changes, no new dependencies.

## Current State

1. **Map leak above forecast bar** — `#map` fills viewport (`top: 0; bottom: 0`), header and time bar overlay it. At certain scroll/zoom states, map tiles peek through between or above UI layers. Root cause: nothing clips or masks the map above the time bar.
2. **Time-pill carousel cutoff** — `.time-selector-bar` has `overflow-x: auto` and hidden scrollbar. Pills end abruptly at right edge with no visual indicator (gradient fade, arrow) that more exist.
3. **FORECAST label imbalance** — label sits cramped against first pill, tons of empty space to the right. Feels disconnected.
4. **Low contrast inactive pills** — `.time-pill` uses `color: var(--body)` (light grey `#6b7280`), border `var(--border)` (`#e5e7eb`). Hard to read against white background.
5. **Wave icon off-center** — `.brand-icon` "~" text slightly vertically off in its purple circle.
6. **Grid tooltip overlap** — clicking a grid cell shows a Leaflet tooltip, but the tooltip appears partially covered by adjacent grid rectangles (z-index/pane issue).
7. **Metric units in tooltip** — Grid tooltip shows wave height in meters, fetch in km, shore distance in meters. Header and time pills already use mph. Tooltip should use SAE (feet, miles). Internal physics math stays metric.

## Proposed Change

All 7 fixes in one commit targeting `web/index.html`. Each is independent and low-risk.

### 1. Fix map leak — mask above time bar
Add a `clip-path` or adjust the map container so tiles don't render above the UI overlay zone. Simplest: set `#map { clip-path: inset(0 0 0 0) }` scoped to the area below the time bar, or add a solid background strip.

### 2. Add scroll indicator to time pills
Add a CSS gradient fade on the right edge of `.time-selector-bar` using `::after` pseudo-element: `background: linear-gradient(to right, transparent, var(--bg))`. Width ~40px, positioned absolute right.

### 3. Balance FORECAST label
Remove the `margin-right: 6px` on `.time-selector-label` and instead give the label consistent spacing. Alternatively, right-align the label's container or add equal padding on both sides of the pill container.

### 4. Improve inactive pill contrast
Change `.time-pill` text color from `var(--body)` to a darker shade (e.g., `#4b5563` or `var(--heading)`). Keep border the same — the text contrast is the main issue.

### 5. Center wave icon
Adjust `.brand-icon` flexbox alignment: `display: flex; align-items: center; justify-content: center; line-height: 1`. Ensure the "~" character sits dead center in the purple circle.

### 6. Fix grid tooltip z-index
The Leaflet tooltip renders in the `tooltipPane` which has lower z-index than `overlayPane` (where grid rectangles live). Fix: either move tooltip to a higher pane, or set `.grid-tooltip { z-index: 10000 !important; position: relative }`. Alternatively, use `leaflet-tooltip-pane` z-index override.

### 7. Convert tooltip units to SAE
In `drawGridHeatmap()` and `redrawGridHeatmap()`, convert display values:
- `wave_height_m` → feet (`* 3.28084`), show as `ft`
- `fetch_km` → miles (`* 0.621371`), show as `mi`
- `shore_distance_m` → feet (`* 3.28084`), show as `ft`
- Keep `shield_factor` as percentage (already unitless)
- Keep internal calculations in metric (physics math unchanged)

## Out of Scope

- Grid/outline edge problem (deferred Phase A3)
- Backend/engine changes
- New features or pages
- Multi-lake architecture
- PWA install flow

## Acceptance Criteria

- [ ] Browser screenshot confirms no map leak above time bar at any zoom
- [ ] Time-pill carousel has visible right-edge fade indicator
- [ ] FORECAST label spacing looks balanced
- [ ] Inactive time pill text is clearly readable (contrast ≥ 4.5:1)
- [ ] Wave "~" icon centered in purple circle
- [ ] Grid tooltip fully visible when clicking a cell (not obscured)
- [ ] Tooltip shows wave height in ft, fetch in mi, shore distance in ft
- [ ] 10/10 Python tests still pass
- [ ] Service worker cache version bumped

## Files Reference

| File | Changes |
|------|---------|
| `web/index.html` | CSS + JS tooltip text changes (~20 lines total) |
| `web/sw.js` | Cache version bump (1 line) |

## Effort Estimate

Small — ~30 min for all 7 items. Single subagent delegation.
