# Blue Lake Wave Forecast

Single-page web app that shows real-time wave-fetch wind impact on Blue Lake, Minnesota — a heatmap you can check before heading out on the kayak.

## Quick Start

```bash
# Generate static geometry (one-time, or when shoreline/NLCD data changes)
python3 engine/compute_engine.py --static

# Serve locally
cd web && python3 server.py
```

Then open http://localhost:8765 in your browser. Wind data is fetched live from Open-Meteo on every page load — no engine re-run needed.

## PWA Install (Android/Brave)

To install as a standalone app (no URL bar), you must whitelist the origin since it's served over local HTTP:

1. Open `brave://flags/#unsafely-treat-insecure-origin-as-secure` in Brave
2. Enable the flag and add `http://192.168.0.61:8765`
3. Relaunch Brave, visit the URL, then **Install App** from the menu

Or use ADB reverse: `adb reverse tcp:8765 tcp:8765` and visit `http://localhost:8765` (treated as secure).

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
| 1 | Productize: proper repo, tests | ✅ |
| 2 | PWA + Polish: installable on phone, polished mobile UX | ✅ |
| 3 | Refine: Blue Lake ground-truthed, math validated | ⬜ (needs on-water testing) |

## Architecture

- **Compute Engine:** Pure Python stdlib — parses KML shoreline, queries NLCD WMS for land cover data, computes static geometry (polygon, grid, fetch, shoreline) in `--static` mode. Full mode fetches wind and computes impact scores.
- **Web App:** Single-page Leaflet map — fetches static geometry once (cached), fetches live wind from Open-Meteo JavaScript API on every load/refresh, recomputes impact scores in-browser. Time pills for forecast hours, impact heatmap (green/yellow/red), land cover toggle overlay, Stripe-inspired design system.
- **Data Flow:** `engine/compute_engine.py --static` → `data/lake_static.json` → `web/index.html` (static) + Open-Meteo API → `web/index.html` (live wind)

## Design

See [DESIGN.md](./DESIGN.md) for the full design system (fonts, colors, spacing, breakpoints, impact tiers).

## Tech Stack

- Python 3.11 (stdlib only)
- Leaflet 1.9.4
- Open-Meteo API
- NLCD 2021 WMS
- Vanilla JS (no framework)
