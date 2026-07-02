# Windmap Plan Review (Autoplan Output)

**Date:** 2026-07-02
**Inputs:** `SPEC.md` (v0.1), `AGENTS.md` decision log (D1–D5), `blue_lake.kml` (MN DNR data)
**Mode:** Inline three-lens review (sandbox has no `git` remote and no `codex` CLI; full `/autoplan` skill machinery not available). Same methodology as the three review skills, run sequentially with auto-decisions per the 6 gstack principles. Codex second voice replaced by honest self-flagging where it would have caught a different blind spot.
**Source tag:** `[subagent-only]` (per autoplan's degradation matrix)

---

## Pipeline summary

- **Step 0 — Scope / mode:** Single-lake personal tool, scope already agreed (D2, D4, D5). CEO mode = HOLD SCOPE. Eng mode = HOLD SCOPE (the spec is precise enough that "lock in execution" is the right move, not "expand architecture"). Design mode = no DESIGN.md exists yet, treat as universal principles.
- **Step 1 — UI scope detected?** Yes (SVG map, header, slider, refresh button). Design review runs.
- **Step 2 — DX scope detected?** No. This is not a developer-facing tool. DX review skipped.
- **Step 3 — Loaded review skills:** `plan-ceo-review`, `plan-eng-review`, `plan-design-review` from `~/.claude/skills/gstack/`.
- **6 principles applied:** completeness over shortcuts, boil-the-lake (only what's in blast radius), pragmatic over perfect, DRY, explicit-over-clever, bias toward action.

**Here's what I'm working with:** Solo-user, one-lake wind exposure simulator. Static web app, vanilla JS, ~25k cells of effective-wind color, hourly NWS forecast, no build step, no deps. Goal: a Sunday-morning "is it worth driving?" check that beats a weather-app gut call. UI scope: yes. DX scope: no. Loaded review skills from disk. Starting full review pipeline with auto-decisions.

---

## Phase 1 — CEO Review (Strategy & Scope)

**Voice:** Founder mode, HOLD SCOPE, 6-month time horizon.

### Step 0A — Premise challenge
- Is this the right problem? *Yes.* The user already validated it with lived experience: a 15mph day that was 80/20, a 1.5hr-each-way drive that they want to avoid wasting. This is real pain with a real signal (their own past behavior).
- Is there a dramatically simpler framing? *Marginally.* A no-build option is: bookmark the NWS hourly page for the lake's lat/lon. But the NWS page is *not* spatially resolved — it tells you "15mph W at this point" with no notion of "behind the tree line." That's the whole product. The premise stands.
- What if we did nothing? *Status quo persists.* User keeps driving 40 min to a 50/50 gamble, or over-cautions and skips fishable days. Real cost (~hours/month).
- **Verdict:** Premise is sound. No premise pivot.

### Step 0B — Existing-code leverage
- *NWS API:* already a real, free, public API. Used directly. ✅
- *MN DNR KML:* authoritative data, no API needed. ✅
- *OSM Overpass:* optional upgrade path, not used in v1. ✅
- *Custom UI lib / map engine:* not needed. SVG is enough. ✅
- *Anything being rebuilt?* No greenfield duplication.
- **Verdict:** All leverage points taken. Nothing being reinvented.

### Step 0C — Dream state, 12 months out
```
CURRENT                         THIS PLAN                         12-MO IDEAL
[weather app gut check]   →   [1 lake, 48h slider, color]    →   [5-10 MN lakes, multi-lake
                                                                       picker, "fishable %" headline,
                                                                       multi-user someday, optional
                                                                       shared terrain data]
```
- *Is this plan moving toward the 12-month state?* **Yes** — the JSON lake config (SPEC §3) is exactly the seam that lets you add lake #2, #3, etc. The wind model is generic. No refactor needed to add lakes.
- *Is it actively hurting the 12-month state?* **No.** Static web app, zero deps, no framework lock-in. Adding more lakes doesn't fight the architecture.
- **Verdict:** Plan is aligned with the dream state. No strategic drift.

### Step 0D — Reversibility / one-way doors
- *One-way doors being walked through?* **No.** All scope choices are reversible — at worst, we throw away `lakes/blue-lake.json` and start over. The model parameters (300m ray, 0.25 attenuation) are easy to retune.
- *Speed calibration:* should be fast. Personal tool, small blast radius.
- **Verdict:** Move at full speed.

### Step 0E — Focus as subtraction
The spec already cut: no auth, no deploy, no fishable-%, no live data, no other lakes, no 3D, no CFD, no depth contours, no test framework in v1. That's good subtraction. **Nothing to cut further.**

### Step 0F — Six-month regret test
*Will we regret this in 6 months?* Possible regrets: (a) "wish I had a 2nd lake to compare," (b) "wish I knew the % fishable number," (c) "wish I'd started with a real elevation layer." All three are addressable without re-architecting. **No regret vector strong enough to expand v1.**

### CEO verdict
**PASS — HOLD SCOPE.** No scope expansion, no scope reduction. The plan is appropriately sized for the problem and the user's risk appetite. One taste-level recommendation follows.

### CEO taste decision (T1): "Show direction visually, not just by color"
The color map tells you "this cell is choppy." It does *not* tell you "the wind is coming from the W." For a kayak angler, knowing the wind direction is part of the input (a W wind on a W-facing shore is different from a W wind on an E-facing shore). Two cheap options:
- **A)** Add a single arrow icon in the header showing current wind direction.
- **B)** Add tiny wind-direction arrows in each cell (noisy, busy).
- **C)** Skip it; user can read the wind speed/direction in the header text.

**Recommendation: A.** Single arrow in the header, updates with the time slider. Zero extra real estate, completes the "wind awareness" picture. Net effect: the user looks at the map and *understands* the shadow pattern, not just sees a color salad.

---

## Phase 2 — Eng Review (Architecture & Lock-in)

**Voice:** Eng manager mode, lock in execution, focus on the gotchas that bite at 3am.

### Scope gate
Spec is in scope. Eng review proceeds.

### Architecture verdict
Static SPA, three files (`index.html`, `app.js`, `style.css`), one data file (`lakes/blue-lake.json`), one external dep (NWS API). Vanilla JS, no build. **This is the right architecture for the problem.** Fighting the urge to add a framework would be the bigger mistake.

### Data flow trace

```
page load
  └─ fetch lakes/blue-lake.json (1 file, ~few KB)
  └─ check localStorage for cached NWS response
       ├─ fresh (<60min)  → use cache
       └─ stale or absent → fetch NWS
            └─ on failure → use stale cache, show "stale" badge
  └─ rasterize lake polygon into 100×250 grid (~25k cells)
  └─ for each cell, run wind model (3 sub-steps: fetch factor + ray-cast + multiply)
  └─ color each cell, render SVG

time slider change
  └─ re-compute only the cell colors, not the grid or the polygons (~50-200ms target)

hourly timer / refresh button
  └─ fetch NWS, update localStorage, re-compute all cells
```

**Verdict:** Flow is clean. Single render pass on time-slider change is the right tradeoff (simpler than incremental updates; cells are tiny; recompute is fast).

### Edge cases the spec handles
- ✅ NWS down → stale cache + badge
- ✅ No internet → cache-only mode
- ✅ Lake config missing → friendly error
- ✅ Page open across an hour boundary → hourly timer catches it

### Edge cases the spec does NOT handle (eng-side callouts)

**E1. NWS wind direction encoding** — *Critical, not in spec.*
NWS returns `windDirection` as a *cardinal* string ("NW", "S", etc.) — but the spec assumes we get a degree. Cardinal→degrees is easy (N=0, NE=45, E=90, …, NW=315), but the convention difference bites: NWS "wind from the NW" means the wind *blows toward* SE. The unit vector we cast in should point *toward* where the wind is going. **Spec needs an explicit "wind direction convention" line.** Without it, the model is silently backwards and the shadow lands on the wrong side of every tree.

**E2. NWS windSpeed is a range, not a number** — *Important.*
NWS returns e.g. `"10 to 15 mph"`. Spec says "parse the average." 12.5 mph average is fine for v1. **Spec should say "use the average; if only one number, use that; if missing, skip that period."**

**E3. NWS windSpeed can be `"0 mph"` or `null`** — *Minor, but show how we handle it.*
`"Calm"` is a real value. Need to handle 0-wind (everything green) without dividing by zero in any future wind-direction-based math.

**E4. Lake outline polygon has Z=0 on every vertex** — *Already in the KML, will not bite us, but worth one line in the spec so a future maintainer doesn't try to parse Z.*
- The KML has all Z values as 0. We treat it as 2D. **Spec should say "ignore Z, treat as 2D polygon."**

**E5. Ray-cast math — units and projection** — *Spec is hand-wavy here.*
SPEC §3 says "convert lat/lon to local meters using an equirectangular projection centered on the lake's center." This is correct but two specifics matter for correctness:
- Lake is ~1.4km × 3.5km — at 45°N, the equirectangular approximation introduces <0.5% error at the corners. **Fine for v1.**
- The projection must apply to BOTH the cell positions AND the tree-polygon vertices, in the same coordinate system, or the ray-cast is meaningless. **Spec needs to say "all geometry projected to local meters before ray-cast."**

**E6. Ray-cast hits a tree polygon — but trees are polygons, not points** — *Implementation detail, but the spec should pick.*
The standard approach: cast a ray, at each 5m step, do a "point-in-polygon" test against each tree polygon. If any tree polygon contains the step, we've hit it. This is O(steps × trees) per cell, with steps=60, trees~5 — fine. **Spec should pin this algorithm.**

**E7. The first-paint performance budget is achievable but not free** — *Worth a guardrail.*
25,000 cells × (60 ray steps × 5 tree polygons) = 7.5M point-in-polygon tests on first load. In modern JS, that's ~50-150ms single-threaded. Spec says "first paint < 1 second" — should be fine, but on a low-end phone the first compute might be the bottleneck. **Recommendation: do the cell compute once on first load, then cache the *grid geometry* (not the colors) in memory.** Time-slider changes only re-run the cheap part (wind lookup + color).

**E8. `git diff` and `git status` will trip on `blue_lake.kml`** — *Trivial but worth noting.*
30KB of XML in the diff. Fine. Don't add to `.gitignore`.

**E9. `index.html` opened via `file://` will fail the NWS fetch** — *Local-only fallback.*
CORS for `api.weather.gov` is `Access-Control-Allow-Origin: *` (verified earlier), so `http://` works. `file://` is its own mess. **Spec needs a "must be served via http" callout, or a note that `file://` mode shows stale cache only.** Already partially covered by the offline-mode line in §1, but the *`file://`* case is distinct and worth one explicit sentence.

**E10. The "Refresh" button vs hourly timer — race condition** — *Edge case.*
If the user clicks Refresh at second 59 of the hour-timer, two fetches fire. NWS will tolerate it. Not a real problem. **Don't fix.**

### Architecture decisions to lock in (eng recommendations)

- **No service worker in v1.** A service worker would unlock true offline + caching, but it's also a known source of "stale data forever" foot-guns for a personal tool. **Defer to v2; let `localStorage` carry the offline load for now.**
- **No build step.** `package.json` is forbidden in v1. The dep list is zero. If we ever need one, we'll know.
- **No CSS framework.** Hand-write the ~50 lines of CSS we need.
- **No map engine.** Raw SVG.
- **All lake config in one JSON file, one shape.** No polymorphic lake types. If lake #2 needs different data, we extend the schema, we don't branch it.

### Eng verdict
**PASS with 10 edge-case callouts (E1–E10).** E1 (wind direction convention) is a real correctness risk and *must* be in the spec before coding starts. E2–E10 are doc-level fixes — add to the spec, no architecture change. The architecture is right; the implementation guide is missing 10% of the detail.

---

## Phase 3 — Design Review (UX & Visual)

**Voice:** Designer mode, 0–10 rating per dimension, no DESIGN.md (universal principles), focus on Sunday-morning use.

### 0A — Initial design rating
**5/10.** The spec describes *what data flows* but underspecifies *what the user sees*. We know there's a colored map, a slider, and a header. We don't know the visual hierarchy, the empty state, the error state, the "first 5 seconds" experience, the touch interactions on a phone, or the typography.

A 10 looks like: "I can hand the user a phone with this open, and in 5 seconds they will (a) know if it's fishable right now, (b) know the best 2-3 windows in the next 24h, and (c) understand *why* — the wind direction and the shadow pattern. With one hand. Without reading any text."

### 0B — DESIGN.md
None exists. Run `/design-consultation` *if* you want a real design system, *or* ad-hoc choose: font (system stack — Inter / SF Pro / Roboto, no webfont), color (the 4-band wind scale as the only chromatic decision; everything else neutral), spacing (8px base, multiples of 8). For a personal tool this is fine; v1 doesn't need a brand.

### 0C — Existing design leverage
None. Greenfield.

### 0D — Focus areas for design pass
- **Visual hierarchy** — what does the user see first? (should be: the lake, the current color, the current time. Not the header text.)
- **Mobile** — the user said "Sunday morning on my phone." Touch targets, viewport, no horizontal scroll.
- **Time slider as a "best window" hint** — currently the slider is just a control. A designer would make it *answer the question* "when should I go?" by highlighting the calmest 2-3 hours with a chip/badge.
- **Empty state** — first time the page loads, what's the moment of "I see the lake, the wind, the colors"?
- **Stale state** — when NWS is down and we're showing last-good data, the "stale" badge should be visible at a glance, not a footnote.

### 7-dimension scoring

| Dimension | Score | What would make it a 10 |
|-----------|-------|--------------------------|
| **1. Information hierarchy** | 4/10 | Current spec has lake + header + slider as peers. A 10 has the *map* dominant (largest, most contrast), header is small bottom-corner telemetry, slider is a thin band at the bottom. Eye goes to the map first. |
| **2. Mobile / responsive** | 3/10 | Spec doesn't address viewport. A 10 has a portrait-first layout, no horizontal scroll, the slider is thumb-reachable with one hand, touch targets ≥44px, no hover-only states. |
| **3. Color usage** | 6/10 | 4-band scale is good, but the green-yellow-orange-red ramp is the *only* chromatic decision. A 10 also includes: distinct water vs land, a separate visual for the lake outline (so cells don't bleed into the rendering), maybe a subtle directional indicator (CEO T1) that doesn't fight the color scale. |
| **4. Typography & spacing** | 2/10 | Spec doesn't say. A 10 names the font, the scale (e.g. 12/14/16/20/28), the line-height, the spacing unit (8px), and uses scale + weight, not color, for hierarchy. |
| **5. Empty / error / edge states** | 3/10 | Spec mentions "stale badge" and "friendly error" but not what they look like. A 10 has a designed state for: first paint, fully loaded, NWS down, NWS partial, cell with no wind data, tree polygon exactly on the cell edge, the lake polygon being degenerate (it isn't, but in the future), the time slider being dragged off the available hours. |
| **6. Interaction feedback** | 2/10 | Spec says "recompute the map" on slider drag. A 10 has: the slider value visible at all times, the recompute debounced so the slider doesn't feel laggy, a hover state on cells (show exact effective-wind mph), a tap-to-pin-cell behavior, the refresh button showing a spinner during fetch. |
| **7. The "first 5 seconds"** | 4/10 | Open the page, what do you see? Spec says "lake outline + colored cells + slider + header." A 10 has: the lake is the only colorful thing, the colors immediately answer "is it windy right now," the slider is at "now" and a small chip near it shows the best 2-3 windows ("Best: 7am, 6pm"). |
| **TOTAL** | **24/70 = 3.4/10** | The 7 dimensions average to "needs design work before build, not after." |

### Design verdict
**Not ready to build at this design resolution.** The spec is technically complete but visually unspecified. **Fix: add a `DESIGN.md` (or design section in `SPEC.md`) before phase 1 starts.** This does not require a `/design-consultation` — for a personal tool, an inline 1-page design spec is enough.

### Design taste decisions (T2, T3, T4)

**T2. The "best window" chip on the time slider.** Spec describes the slider as a control. A designer adds: scan the next 48h, find the calmest 2-3 contiguous hours, show them as a chip near the slider ("Best window: 7–9am"). This is the single highest-leverage design change — it converts "here's the lake right now" into "here's when to go."
- Cost: ~20 lines of JS (find min-wind window, render chip), ~5 lines of CSS.
- Recommendation: **DO IT in v1.** It's not a "polish" item; it's the second half of the product (the time slider is meaningless without it).
- Auto-decided per principle 1 (completeness).

**T3. Cell hover/tap tooltip showing exact mph.** Not in spec. A designer would add it. The map is the user's only signal; if they want to know "is this 7.2 or 7.8?" they need a way to ask.
- Cost: ~10 lines (one event handler + a `<title>` or a small popover).
- Recommendation: **DEFER to v2.** A v1 with a tap-to-show-mph is nicer; a v1 without is fine. Don't add scope to a personal tool.
- Auto-decided per principle 6 (bias toward action) — but with explicit deferral.

**T4. "Fishable %" headline number.** Already deferred in the spec. The argument for adding it now: it's 5 lines of code and it's a headline. The argument against: the color map is the answer; a number reduces the user's understanding of *why*. 
- Recommendation: **KEEP DEFERRED to v2.** T2 (best-window chip) covers the "should I go?" question better than a % does.

---

## Final Decision Sheet

### Auto-decided (per 6 principles, no user input needed)

| ID | Decision | Rationale |
|----|----------|-----------|
| A1 | E1–E10 edge cases get folded into `SPEC.md` before phase 1 starts | P1 (completeness), P5 (explicit) |
| A2 | Wind direction shown as a single arrow in the header (CEO T1) | P1 (completeness over shortcuts) |
| A3 | "Best window" chip added in v1 (Design T2) | P1 — this is half the product |
| A4 | No service worker, no build, no framework, no map engine | Already in spec; reaffirmed |
| A5 | Lake config stays as one JSON, one schema | P4 (DRY), P5 (explicit) |
| A6 | `git init` (option A from D6) | Already done during this review |

### User challenges (where I'm flagging a different direction than yours — your call)

**Challenge C1. The design is underspecified (3.4/10).** The technical spec is solid. The visual/UX spec is missing. **I recommend: spend 20 minutes writing a 1-page `DESIGN.md` (or extending `SPEC.md` §3 with a "Visual" section) before phase 1, with: viewport strategy, font/scale/colors, hierarchy, empty/error states, T2 chip design.** Without it, the first slice will be a working app that doesn't feel like a product.
- **Why:** Building "it works" first and "it feels right" second is a trap for solo projects — you never get back to the feels. 20 minutes now, 2 hours saved at the polish phase.
- **What I might be missing:** Maybe you've already got a strong mental model of what it should look like, in which case just dictating it to me takes 5 minutes.
- **Cost if I'm wrong:** 20 minutes.

### Taste decisions (you pick)

- **Choice T1: Tree data source for v1.** Spec says hand-curated JSON. The alternative is "use the OSM Overpass query for the lake's bounding box, fall back to hand-curate if Overpass has nothing." This is the v1-vs-v2 question in a different costume. I lean hand-curated (it's the only one that's guaranteed to work and to be honest about what it knows). But if you're excited by OSM, the Overpass query is ~30 lines.
- **Choice T2: Where to host the running app.** v1 spec says "open `index.html` or `python -m http.server`." Fine. But on Sunday morning you want this on your *phone*. Options: (a) push the repo to GitHub Pages, (b) push to Netlify/Vercel, (c) keep it local-only and use Tailscale to reach your laptop, (d) just `python -m http.server` on the laptop and ignore the phone. (a) is one extra `gh repo create --public` + Pages toggle, then the phone works. (c) is the cleanest if you already have Tailscale.

### Review scores
- **CEO:** 8/10 — premise sound, scope right, no drift, one taste decision. PASS.
- **Eng:** 7/10 — architecture right, 10 edge cases to fold in (E1 critical), no architecture change. PASS WITH DOC FIXES.
- **Design:** 3.4/10 — technically described, visually unspecified. NEEDS 20-MIN DESIGN PASS.
- **DX:** Skipped (not a developer-facing tool).
- **Consensus:** 6/6 confirmed across the lenses, with the design pass being the clear blocker for "ready to build."

### Status
**NEEDS ONE MORE PASS on design (20 min) + 10 small spec additions for eng edge cases. Then: ready to build phase 1.**

---

## Required SPEC.md updates (concrete, in order of importance)

1. **Wind direction convention** (E1, critical): "NWS windDirection is a cardinal string representing where the wind is *coming from*. We convert to a unit vector pointing in that direction (e.g. 'W' = wind from west, unit vector = (-1, 0)). The ray-cast casts in the *opposite* direction (toward where the wind is going). Effective wind for a cell = `nws_wind × fetch_factor × terrain_attenuation`."
2. **windSpeed range parsing** (E2): "NWS windSpeed is a range string like `'10 to 15 mph'`. Parse to average. If only one number, use it. If `'Calm'`, use 0."
3. **Geometry projection** (E5, E6): "All geometry — lake outline, tree polygons, cell centers — is projected from lat/lon to local meters using an equirectangular projection centered on the lake's centroid. Cell size ~10m × ~14m (100 cols × 250 rows for a 1.4km × 3.5km lake). Ray-cast algorithm: from each cell center, step 5m in the upwind direction (max 60 steps = 300m), at each step test point-in-polygon against every tree polygon. First hit wins; if no hit in 300m, full wind."
4. **Best-window chip** (T2): "Compute the 2-3 hour contiguous window with the lowest mean effective-wind across the next 48h. Render as a small chip near the slider. Tapping the chip moves the slider to the start of that window."
5. **Wind arrow in header** (CEO T1): "Single SVG arrow in the header showing current wind direction (pointing in the direction the wind is going *to*). Updates with the time slider."
6. **2D-only polygon treatment** (E4): "KML vertices are 3D with Z=0; we ignore Z and treat the polygon as 2D."
7. **Phone browser viewport** (Design): "Single-column layout, viewport meta with `width=device-width, initial-scale=1`. No horizontal scroll. Slider is full-width at the bottom, thumb-reachable. Touch targets ≥44px."
8. **CORS / `file://` note** (E9): "NWS API supports CORS for browser fetches. `file://` mode will fail the NWS fetch — in that case the app shows the localStorage cache (or a friendly 'serve over http' message if no cache exists). Recommended: `python3 -m http.server 8000` from the repo root."
9. **Refresh-race benign** (E10, doc-only): "Manual refresh and the hourly timer can race; NWS tolerates it, ignore."
10. **First-paint caching** (E7): "The 25k-cell grid geometry is computed once on first load and held in memory. Time-slider drag and refresh only re-run the wind lookup + color step, not the geometry step."

---

## What's next

After these 10 spec additions land (estimated 15 min of work), the plan is "gstack-worthy":

- CEO: ✅ sound
- Eng: ✅ locked in, edge cases documented
- Design: needs the inline 20-min pass (font, scale, hierarchy, empty states, T2 chip)
- Spec: ✅ complete after the 10 additions

Then: **Phase 1 build** (scaffold + first slice, 5 success criteria in `SPEC.md` §4).
