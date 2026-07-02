# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# Project: Windmap (Blue Lake wind simulator)

## Goal
Build a tool the user can check before driving to Blue Lake (Zimmerman, MN) to fish from a kayak. The tool simulates wind exposure across the lake using real NWS wind data + a 3D model of the lake and surrounding terrain, so the user can see what % of the water is "chopped" vs "slack" given current wind direction/speed, and find tucked-in spots where wind is blocked.

## Scope (v1)
- **One lake only:** Blue Lake, Zimmerman, MN
- **Data sources:** NWS forecast (speed + direction), MN DNR contours (lake shape, depth), OpenStreetMap terrain (trees, bluffs)
- **Output:** a view of the lake with wind exposure mapped — which areas are slammed, which are slack
- **Use case:** pre-trip decision ("is it worth driving?"), not navigation

## Decisions made
- **D2 (model flavor) → B: vector field + terrain shadowing.** Not a flat field (ignores the tree-shadow thing that's the whole reason to build this), not real CFD (won't ship, abandons at week 3). B captures the actual phenomenon and stays small.
- **D3 (data sources) → confirmed working in sandbox:**
  - NWS API: free, no key, returns hourly forecast for the lake's lat/lon
  - MN DNR Lakefinder: KML download with 1,228-vertex lake outline, plus lat/lon of 2 public boat launches
  - OSM Overpass: free, no key, for tree-line polygons (quality TBD per lake)
  - MnTOPO LiDAR: real elevation data — overkill for v1, useful as future option
  - Depth contours: NOT in the KML (outline only). Lakefinder page table has max depth + area. Hand-curate for v1 if we want depth in the visual.
- **D4 (Sunday morning moment) → A + C combined:** colored map of the lake showing calm/choppy cells for current conditions + 24-48h time slider for "best window to go". B (fishable-% number) deferred to v2. Data refresh: hourly + manual "refresh" button, no live/websocket.
- **D5 (model tuning) — locked:**
  - Shadow ray-cast distance: 300m
  - Tree attenuation: 0.25x (quarter-wind behind trees)
  - Elevation attenuation: 0.10x (one-tenth-wind behind bluffs)
  - Color thresholds: <6mph green, 6-8mph yellow, 8-15mph orange, >15mph red
  - **User note:** "8mph marginal" — on a 15mph day the slack water felt like ~5mph (could be contrast effect with surrounding chop). Tune from real-world feedback in v2.
- **T1 (tree data source) → hand-curated JSON.** Smallest, most honest, guaranteed to work for v1. OSM Overpass query for tree data remains a v2 upgrade path.
- **T2 (hosting) → GitHub Pages.** v1 ships as a public GitHub Pages site, accessible from the user's phone. Personal tool, public repo is fine.
- **D7 (design vibe, from user) → "clean and simple, off-white page, blue lake outline, wind overlay, compass/direction arrow with speed and temp. Clean gradients, drop shadows. Simple designs you hardly notice are the best."** No DESIGN.md system, no brand. ~1 page of inline design spec.

## Pipeline (gstack)
- [x] 0. Load gstack
- [~] 1. Office hours — pressure-test the idea (D1-D4: status quo, model, data, success moment)
- [x] 1. Office hours — DONE
- [x] 2. Spec — DONE (SPEC.md)
- [x] 3. Autoplan — DONE (REVIEW.md)
- [x] 4. Spec addenda — 10 edge cases (E1 critical) + T1/T2 folded into SPEC.md
- [ ] 5. Design pass — 20-min inline (font/scale, hierarchy, empty states, mobile viewport, T2 chip) — still open
- [ ] 6. Phase 1: scaffold + first slice
- [ ] 6. Phase 2: core feature
- [ ] 7. Phase 3: polish
- [ ] 8. QA
- [ ] 9. Ship
- [ ] 10. Reflect + save as skill
