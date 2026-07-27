# Phase A3: Thickened Lake Outline

**Goal:** Hide jagged grid edges at the shoreline by layering the lake polygon outline on top of the grid with a thicker stroke.

**Approach:** Zero rendering pipeline changes. Leaflet's built-in `bringToFront()` moves the existing polygon above all grid rectangles. A thicker stroke covers the cell edges that bleed past the shoreline.

**File:** `web/index.html`

## Changes

### 1. Thicken outline stroke
In `drawLakePolygon()` (line ~978): `weight: 2` → `weight: 5`

### 2. Bring outline to front after grid draws
Add `if (lakePolygonLayer) lakePolygonLayer.bringToFront();` at the end of:
- `drawGridHeatmap()` (~line 1039)
- `redrawGridHeatmap()` (~line 967)

### 3. Bump service worker cache
In `sw.js`: bump VERSION

## Verification
- `python3 -m pytest tests/ -q` — 10/10 must stay green
- Browser screenshot at `http://host.docker.internal:8765/` — confirm outline covers jagged grid edges
- Zoom/pan — outline must stay on top
- Time slot switch — outline must stay on top after redraw
- `git diff` — exactly 3 touch points, no test changes

## Edge Cases
- Grid redraw on time slot change: `redrawGridHeatmap` clears + re-adds rectangles → `bringToFront()` at end keeps outline on top
- Zoom/pan: Leaflet handles polygon repositioning natively, no listener needed
- Mobile: thicker outline is purely visual, no perf impact
