# Blue Lake Wave Forecast

Single-page web app that shows real-time wave-fetch wind impact on Blue Lake, Minnesota — a heatmap you can check before heading out on the kayak.

## Quick Start

```bash
# Generate data (requires internet — fetches from Open-Meteo and NLCD WMS)
python3 engine/compute_engine.py

# Serve locally
cd web && python3 -m http.server 8765
```

Then open http://localhost:8765 in your browser.

## Skill Conventions (for Hermes)

Before ANY coding session, Hermes must load these skills:

1. `hermes-agent` — Hermes configuration & tooling
2. `popular-web-designs` — Stripe design reference
3. `plan` — Multi-step work planning
4. `test-driven-development` — TDD workflow when writing Python
5. `requesting-code-review` — Pre-commit review before marking work done

All coding is delegated to subagents. Roddle (Reid's co-pilot) handles architecture decisions, workflow guidance, and scope discipline — never writes code directly.

## G-Stack Loop Summary

Three shippable slices — complete one before starting the next:

| Loop | Goal | Status |
|------|------|--------|
| 1 | Productize: proper repo, tests, CI-ready | ⬜ |
| 2 | PWA + Polish: installable on phone, polished mobile UX | ⬜ |
| 3 | Refine: Blue Lake ground-truthed, math validated | ⬜ |

## Architecture

- **Compute Engine:** Pure Python stdlib — parses KML shoreline, fetches wind from Open-Meteo, queries NLCD WMS for land cover data, computes wave fetch + wind shielding per grid cell, outputs JSON.
- **Web App:** Single-page Leaflet map — time pills for forecast hours, impact heatmap (green/yellow/red), land cover toggle overlay, Stripe-inspired design system.
- **Data Flow:** `engine/compute_engine.py` → `data/lake_data.json` → `web/index.html`

## Design

See [DESIGN.md](./DESIGN.md) for the full design system (fonts, colors, spacing, breakpoints, impact tiers).

## Tech Stack

- Python 3.11 (stdlib only)
- Leaflet 1.9.4
- Open-Meteo API
- NLCD 2021 WMS
- Vanilla JS (no framework)
