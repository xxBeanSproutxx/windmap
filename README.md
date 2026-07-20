# Blue Lake Wave Fetch — Spike

Visualize wave fetch and wind impact on Blue Lake (Princeton, MN). Single-page web app that shows where wind creates choppy water vs calm areas using live Open-Meteo wind data.

> **This is a spike** — a throwaway experiment, not production code.

## What It Does

- Fetches real wind data from Open-Meteo (free, no API key)
- Computes wave fetch (distance wind travels over open water) for every cell in a ~40m grid
- Estimates wave height and wind impact using simplified fetch-limited wave formulas
- Applies tree-line shielding: cells within 100m of shore with onshore wind get reduced wind
- Renders a colored grid heatmap on a Leaflet map with Stripe-inspired UI

## How It Works

1. **Shoreline** — Blue Lake polygon extracted from MNDNR KML (`/tmp/blue_lake.kml`)
2. **Wind** — Open-Meteo hourly forecast API
3. **Grid** — ~40m grid over the lake bounding box; filter to cells inside the polygon
4. **Fetch** — ray-cast from each cell in the wind-from direction to first shoreline intersection
5. **Wave height** — simplified SMB formula: `H = 0.017 × U × √F` (U in m/s, F in meters)
6. **Shielding** — cells within 100m of shore with onshore wind get linear reduction (0% at shore, 100% at 100m)
7. **Impact score** — `min(1.0, fetch_km / 1.0) × (wind_mph / 17.5)`
8. **Render** — colored heatmap on Leaflet with three impact tiers (Low/Medium/High)

## File Structure

```
wave-fetch/
├── compute_engine.py    # Pure Python stdlib: KML parsing, Open-Meteo fetch, fetch/wave math, JSON output
├── index.html           # Self-contained single-page app: Leaflet map, grid heatmap, time pills
├── lake_data.json       # Live wind output (grid cells + shoreline segments)
└── README.md            # This file
```

## How to Run

```bash
cd /home/reid/spikes/wave-fetch

# Fetch real wind data, generate lake_data.json
python3 compute_engine.py

# Serve the page
python3 -m http.server 8765
```

Then open **http://localhost:8765**

## Features

- **Live wind** — real Open-Meteo wind with 24hr forecast time pills
- **Grid heatmap** — ~854 cells at ~40m resolution, colored by impact score
- **Time pill recolor** — scales impact by wind speed ratio when switching hours
- **Tree-line shielding** — onshore wind reduction near shore
- **Units** — all displayed in mph
- **Design** — Stripe-inspired (Source Sans 3, purple accent, clean shadows)

## Key Formulas

| Metric | Formula | Notes |
|--------|---------|-------|
| Fetch | Ray-cast to polygon intersection | Tangent-plane Cartesian projection for accuracy |
| Wave height | `H = 0.017 × U × √F` | U = wind speed (m/s), F = fetch (meters) |
| Impact score | `min(1.0, fetch_km / 1.0) × (wind_mph / 17.5)` | Normalized 0–1 |
| Shielding | Linear ramp 0m → 100m from shore | Onshore wind only (within 90° of water-facing normal) |

### Color Thresholds

| Tier | Threshold | Color |
|------|-----------|-------|
| Low | < 0.15 | Green (`#15be53`) |
| Medium | 0.15–0.40 | Amber (`#f59e0b`) |
| High | > 0.40 | Ruby (`#ea2261`) |

## Technical Notes

- **Zero external Python dependencies** — stdlib only (`xml`, `json`, `math`, `urllib`)
- Open-Meteo returns km/h; converted to m/s (÷ 3.6)
- Ray casting uses tangent-plane Cartesian projection centered on origin point
- Fetch capped at 1.0 km for grid cells, 5.0 km for shoreline segments
- Point-in-polygon for cell filtering uses standard ray-casting edge-crossing test
