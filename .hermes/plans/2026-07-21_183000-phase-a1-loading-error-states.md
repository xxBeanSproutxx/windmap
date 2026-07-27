# Phase A1: Loading States & Error Handling

**Scope:** `web/index.html` only. ~30 lines of JS/CSS change.
**Tests:** `python3 -m pytest tests/ -q` must remain green.
**After:** bump SW cache version + verify with browser.

## Task 1: Add 10s timeout to `fetchLiveWind()`

Wrap the Open-Meteo `fetch()` in an `AbortController` with a 10-second timeout. If Open-Meteo hangs, the request aborts and throws a clear error instead of leaving the user staring at a loading bar forever.

```js
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000);
try {
  const resp = await fetch(url, { signal: controller.signal });
  // ... existing code ...
} finally {
  clearTimeout(timeout);
}
```

## Task 2: Contextual error messages

Replace the one-size-fits-all error in `showNoData()` with a parameter. Two cases:
- **Static data missing** (first fetch or server down): show current message with `compute_engine.py` instructions
- **Wind fetch failed** (Open-Meteo timeout/error): show "Could not fetch wind data" with "Open-Meteo may be unavailable" and a retry option

Pass the failure reason from `loadData()`'s catch block into `showNoData()`.

## Task 3: Retry button

Add a button to the error overlay that calls `loadData()` again and removes the overlay. Style it as a secondary button (outline, purple accent) matching the design system.

```html
<button onclick="document.getElementById('noDataOverlay').remove(); loadData();">Try Again</button>
```

## Task 4: More visible loading state

The thin purple loading bar at the top is hard to notice on mobile. Add a centered spinner SVG that appears over the map area during load. Keep the bar as well for desktop. The spinner should:
- Be centered in the viewport
- Use the purple accent color (#533afd)
- Fade in/out with the same timing as the loading bar
- Hide when `$loadingBar.classList.remove('visible')` fires

A simple CSS spinner (rotating ring) inline in the HTML, no external assets.

## Verification

1. `python3 -m pytest tests/ -q` → 10 passed
2. Serve with `cd web && python3 server.py`
3. Browse to `http://host.docker.internal:8765/`
4. Confirm loading spinner appears then disappears on normal load
5. Disconnect network → confirm timeout + error overlay with retry button
6. Click retry → confirm app loads when network restored
7. Bump SW cache version so PWA picks up changes

## Git commit

`feat: loading spinner, fetch timeout, contextual errors, retry button (Phase A1)`
