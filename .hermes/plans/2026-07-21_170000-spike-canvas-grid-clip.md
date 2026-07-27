# Spike: Canvas Grid Clip Validation

**Date:** 2026-07-21
**Status:** complete — spike built, pending manual visual tests
**Goal:** Validate `ctx.clip()` canvas overlay for Leaflet grid rendering in isolation before touching production code.

## Why

The last attempt to add canvas-based grid clipping directly into the main app burned 4 rounds of debugging, offset issues (`latLngToLayerPoint`, DPR, resize lifecycle), and a rollback. This spike validates the approach in a throwaway standalone file with no wind data, no SW, no UI chrome — just the map, the polygon, and the canvas.

## What

Single file: `spikes/canvas-grid-clip/index.html`

- Leaflet map centered on Blue Lake
- Hardcoded lake polygon (from KML)
- ~20 fake grid cells (hardcoded lat/lon bounds, colored)
- Canvas overlay (`L.Layer` subclass) that:
  - Uses `latLngToLayerPoint` for coordinate mapping
  - Handles `devicePixelRatio` via `setTransform` or canvas sizing
  - Resizes on `moveend`, `zoomend`, `resize`
  - Applies `ctx.clip()` to trim cells to the polygon boundary
- No wind data, no service worker, no UI chrome, no server — just open the HTML file

## Tests (visual, manual)

1. Canvas positioning — no offset from Leaflet tiles
2. Grid cells clipped cleanly to polygon boundary
3. Zoom in/out — grid stays aligned
4. Pan — grid moves with map
5. No empty triangles at shoreline edges (cells extend past boundary then clip)
6. Resize browser window — canvas adapts

## Verdict Template

```markdown
## Verdict: VALIDATED | PARTIAL | INVALIDATED

### What worked
- ...

### What didn't
- ...

### Surprises
- ...

### Recommendation for real build
- Exact pattern to copy into web/index.html
```

## Next Steps After Validated

Write a plan to integrate the working canvas pattern into `web/index.html`, replacing the current `pointInPolygon()` DOM-based approach. One clean dispatch, one commit.
