# Canvas Grid Rendering — Implementation Plan

> **For Hermes:** Use `delegate_task` to dispatch this to a single subagent (all changes in `web/index.html`).

**Goal:** Replace 500+ individual Leaflet DOM rectangles with a single `<canvas>` overlay that uses native `ctx.clip()` to trim grid cells to the lake polygon — smooth shoreline edge, survives zoom/pan, no DOM bloat.

**Architecture:** A Leaflet `L.canvas` or custom `L.Layer` draws the grid on an HTML Canvas element synced to the map. On every zoom/pan/time-slot change, the canvas redraws in one pass: project each cell's bounds → fill rect with impact color → clip to lake polygon → done. Native canvas clipping handles the shoreline trim perfectly.

**Tech Stack:** Vanilla JS Canvas 2D API + Leaflet 1.9.4 (already loaded)

---

## Files

- **Modify:** `web/index.html` — changes in JS only (remove `redrawGridHeatmap`, `drawGridHeatmap`, `pointInPolygon`; add `GridCanvasLayer` + redraw function)

---

### Task 1: Add GridCanvasLayer class

**Objective:** Create a Leaflet-compatible canvas layer that renders the grid.

**Insert after** the `clearGridHeatmap` / `drawGridHeatmap` / `redrawGridHeatmap` functions (replace all three).

```js
// ── Canvas Grid Layer (replaces individual DOM rectangles) ──

const GridCanvasLayer = L.Layer.extend({
  initialize: function(options) {
    this._grid = options.grid || [];
    this._windSpeedMs = options.windSpeedMs || 0;
    this._windDirDeg = options.windDirDeg || 0;
    this._lakePolygon = options.lakePolygon || null;
  },

  onAdd: function(map) {
    this._map = map;
    this._canvas = document.createElement('canvas');
    this._canvas.style.position = 'absolute';
    this._canvas.style.pointerEvents = 'none';  // click-through to map
    map.getPanes().overlayPane.appendChild(this._canvas);
    this._ctx = this._canvas.getContext('2d');
    this._resize();
    this._draw();
    map.on('moveend zoomend resize', this._draw, this);
  },

  onRemove: function(map) {
    map.off('moveend zoomend resize', this._draw, this);
    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
  },

  _resize: function() {
    const size = this._map.getSize();
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = size.x * dpr;
    this._canvas.height = size.y * dpr;
    this._canvas.style.width = size.x + 'px';
    this._canvas.style.height = size.y + 'px';
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  _draw: function() {
    const ctx = this._ctx;
    const map = this._map;
    const size = map.getSize();
    ctx.clearRect(0, 0, size.x, size.y);

    if (!this._grid.length || !this._lakePolygon) return;

    // ---- Clip to lake polygon ----
    ctx.save();
    ctx.beginPath();
    this._lakePolygon.forEach((coord, i) => {
      const pt = map.latLngToContainerPoint([coord[1], coord[0]]);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.closePath();
    ctx.clip();

    // ---- Draw each grid cell ----
    const halfCell = GRID_CELL_SIZE / 2;
    const halfPx = 0; // we project all 4 corners for accuracy

    this._grid.forEach(cell => {
      // Compute impact score (carried in cell or recomputed)
      let impactScore;
      if (cell._impactScore != null) {
        impactScore = cell._impactScore;
      } else {
        impactScore = recomputeImpactScore(cell, this._windSpeedMs, this._windDirDeg);
      }

      const color = gridImpactColor(impactScore);

      // Project cell corners to pixel space
      const topLeft = map.latLngToContainerPoint([cell.lat + halfCell, cell.lon - halfCell]);
      const topRight = map.latLngToContainerPoint([cell.lat + halfCell, cell.lon + halfCell]);
      const botRight = map.latLngToContainerPoint([cell.lat - halfCell, cell.lon + halfCell]);
      const botLeft = map.latLngToContainerPoint([cell.lat - halfCell, cell.lon - halfCell]);

      const minX = Math.min(topLeft.x, topRight.x, botRight.x, botLeft.x);
      const minY = Math.min(topLeft.y, topRight.y, botRight.y, botLeft.y);
      const maxX = Math.max(topLeft.x, topRight.x, botRight.x, botLeft.x);
      const maxY = Math.max(topLeft.y, topRight.y, botRight.y, botLeft.y);

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
    });

    ctx.globalAlpha = 1.0;
    ctx.restore();
  },

  // Public API to update data without recreating the layer
  updateData: function(grid, windSpeedMs, windDirDeg, lakePolygon) {
    this._grid = grid;
    this._windSpeedMs = windSpeedMs;
    this._windDirDeg = windDirDeg;
    this._lakePolygon = lakePolygon;
    if (this._map) this._draw();
  }
});
```

### Task 2: Wire GridCanvasLayer into existing rendering pipeline

**Objective:** Remove old DOM-based grid rendering and wire the canvas layer.

**Step 1: Remove old grid state and functions**

Delete these variables and functions:
- `gridHeatmapLayers` (line ~640) — remove
- `clearGridHeatmap()` — remove
- `drawGridHeatmap()` — remove
- `redrawGridHeatmap()` — remove
- `pointInPolygon()` — remove

**Step 2: Add canvas layer state variable**

Replace `let gridHeatmapLayers = [];` with:
```js
let gridCanvasLayer = null;
```

**Step 3: Replace `redrawGridHeatmap()` calls**

In `selectTimeSlot()` (~line 1148-1151), replace:
```js
redrawGridHeatmap(data.grid_cells, forecastEntry.speed_ms, forecastEntry.direction_deg);
applyLakeClip();
```
With:
```js
if (gridCanvasLayer) {
  // Pre-compute impact scores so the canvas draw loop is fast
  data.grid_cells.forEach(cell => {
    cell._impactScore = recomputeImpactScore(cell, forecastEntry.speed_ms, forecastEntry.direction_deg);
  });
  gridCanvasLayer.updateData(data.grid_cells, forecastEntry.speed_ms, forecastEntry.direction_deg, data.lake_polygon);
}
```

In `loadData()` (~line 1193-1196), replace:
```js
redrawGridHeatmap(data.grid_cells, currentWind.speed_ms, currentWind.direction_deg);
applyLakeClip();
```
With:
```js
if (gridCanvasLayer) {
  map.removeLayer(gridCanvasLayer);
}
data.grid_cells.forEach(cell => {
  cell._impactScore = recomputeImpactScore(cell, currentWind.speed_ms, currentWind.direction_deg);
});
gridCanvasLayer = new GridCanvasLayer({
  grid: data.grid_cells,
  windSpeedMs: currentWind.speed_ms,
  windDirDeg: currentWind.direction_deg,
  lakePolygon: data.lake_polygon
}).addTo(map);
```

**Step 4: Remove `applyLakeClip()` function**

The canvas uses `ctx.clip()` — no SVG clip-path needed. Delete the entire `applyLakeClip()` function.

### Task 3: Handle tooltips

**Objective:** Canvas grids don't have DOM elements for Leaflet tooltips. Add a single floating tooltip that appears on tap/hover.

Add to `GridCanvasLayer.onAdd()`:
```js
this._tooltip = L.tooltip({ className: 'grid-tooltip', direction: 'top' });
```

Add a click handler in `onAdd()`:
```js
this._canvas.style.pointerEvents = 'none'; // default to click-through

// Use a transparent overlay for interaction
// OR: enable pointerEvents on the canvas and handle clicks

// Simpler approach: mousemove on the map to show nearest cell data
map.on('mousemove', (e) => {
  if (!this._grid.length) return;
  // Find closest cell center to cursor
  const pt = map.latLngToContainerPoint(e.latlng);
  let closest = null;
  let minDist = Infinity;
  this._grid.forEach(cell => {
    const cPt = map.latLngToContainerPoint([cell.lat, cell.lon]);
    const dist = Math.hypot(pt.x - cPt.x, pt.y - cPt.y);
    if (dist < minDist) { minDist = dist; closest = cell; }
  });
  if (closest && minDist < 20) {
    // Use _impactScore if precomputed, or recompute
    const score = closest._impactScore != null ? closest._impactScore
      : recomputeImpactScore(closest, this._windSpeedMs, this._windDirDeg);
    const shieldFactor = computeShieldFactorJS(
      closest.shore_distance_m, closest.shore_normal_deg, this._windDirDeg,
      closest.nlcd_reduction != null ? closest.nlcd_reduction : 0.5
    );
    const waveH = 0.017 * (this._windSpeedMs * shieldFactor) * Math.sqrt((closest.fetch_km || 0) * 1000);
    let tip = '<strong>Fetch:</strong> ' + (closest.fetch_km || 0).toFixed(3) + ' km<br>'
      + '<strong>Impact:</strong> ' + (score * 100).toFixed(0) + '%<br>'
      + '<strong>Wave:</strong> ' + waveH.toFixed(3) + ' m';
    if (shieldFactor < 0.99) tip += '<br><strong>Shield:</strong> ' + (shieldFactor * 100).toFixed(0) + '%';
    if (closest.shore_distance_m != null && closest.shore_distance_m < 150) tip += '<br><strong>Shore:</strong> ' + closest.shore_distance_m.toFixed(0) + 'm';
    this._tooltip.setLatLng(e.latlng).setContent(tip).addTo(this._map);
  } else {
    this._map.removeLayer(this._tooltip);
  }
});
```

Remove the mousemove handler in `onRemove()`:
```js
map.off('mousemove'); // Note: use a bound reference for clean removal
```

Actually, to keep it simple and avoid mousemove perf issues on mobile, just drop tooltips for now and add back later if needed. The impact colors + legend already communicate the data.

### Task 4: Verification

1. `cd /home/reid/projects/blue-lake-wave && python3 -m pytest tests/ -q` — 10/10 must pass
2. Start server, load page:
   - Grid should render with same colors as before
   - Shoreline edge should be clean (canvas clip)
   - Zoom in/out — grid should redraw correctly (no artifacts)
   - Pan the map — grid should stay aligned with lake
   - Switch time pills — grid colors should update
3. Bump SW cache to v6
4. Commit: `feat: canvas-based grid rendering with native polygon clipping`

---

## What gets removed

| Removed | Reason |
|---------|--------|
| `gridHeatmapLayers` array | Replaced by single `gridCanvasLayer` |
| `clearGridHeatmap()` | Canvas handles its own lifecycle |
| `drawGridHeatmap()` | Replaced by GridCanvasLayer |
| `redrawGridHeatmap()` | Replaced by GridCanvasLayer |
| `pointInPolygon()` | Replaced by `ctx.clip()` |
| `applyLakeClip()` | Replaced by `ctx.clip()` |
| All `bindTooltip` calls on rectangles | Tooltip deferred to future PR |

## Risks

- **Tooltips:** Initially lost (canvas has no DOM). Mitigation: mousemove-based tooltip (Task 3) or defer to follow-up.
- **Performance:** Canvas redraws on every zoom/pan. With ~500 cells this is sub-5ms — fine. The expensive part (impact recompute) is pre-cached.
- **`devicePixelRatio`:** HiDPI screens need canvas scaling. Addressed with `_resize()` method.
