# Blue Lake Wave Forecast — Design System

Compiled Tailwind v4 design system (CSS-first, no `tailwind.config.js`).
Input `web/css/input.css` → output `web/tailwind.css` (committed, minified).
Build: `npm run build:css`.

Class-based dark mode: `<html class="dark">`. Tokens are CSS variables, so the
`.dark { --color-* }` overrides flip every utility automatically. The compiled
`web/tailwind.css` is committed — GitHub Pages keeps serving static `web/` with
zero pipeline changes.

## Typography

| Token | Value |
|-------|-------|
| Body / Headings | `Fira Sans`, system-ui, sans-serif |
| Data / Numbers | `Fira Code`, monospace |
| Body weights | 300 (light), 400 (regular), 500 (medium), 600 (semibold), 700 (bold) |

Sourced from Google Fonts:
```html
<link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

## Colors — Light (default)

| Token | Value | Usage |
|-------|-------|-------|
| `--color-primary` | `#0284C7` | Sky blue — buttons, links, active |
| `--color-secondary` | `#0EA5E9` | Sky lighter |
| `--color-accent` | `#F59E0B` | Amber/sun — CTA, highlights |
| `--color-bg` | `#F0F9FF` | Page background |
| `--color-card` | `#FFFFFF` | Surfaces |
| `--color-ink` | `#0F172A` | Headings/body |
| `--color-muted` | `#64748B` | Secondary text |
| `--color-muted-bg` | `#EFF7FB` | Subtle fills |
| `--color-border` | `#E0F0F8` | Hairlines |
| `--color-destructive` | `#DC2626` | Errors |
| `--color-ring` | `#0284C7` | Focus rings |

## Colors — Dark (`.dark`)

| Token | Value | Usage |
|-------|-------|-------|
| `--color-primary` | `#38BDF8` | Brighter sky for dark contrast |
| `--color-secondary` | `#7DD3FC` | |
| `--color-accent` | `#FBBF24` | Brighter amber |
| `--color-bg` | `#0F172A` | Deep navy |
| `--color-card` | `#1E293B` | |
| `--color-ink` | `#F8FAFC` | |
| `--color-muted` | `#94A3B8` | |
| `--color-muted-bg` | `#1E293B` | |
| `--color-border` | `#334155` | |
| `--color-destructive` | `#F87171` | |
| `--color-ring` | `#38BDF8` | |

## Impact Tiers (Wave Hazard)

Unchanged in both themes — identical values in light and dark.

| Token | Value | Condition | Meaning |
|-------|-------|-----------|---------|
| `--color-impact-high` | `#ea2261` | Impact score > 0.40 | Rough — avoid or use extreme caution |
| `--color-impact-medium` | `#f59e0b` | Impact score 0.15–0.40 | Choosy — manage risk |
| `--color-impact-low` | `#15be53` | Impact score < 0.15 | Calm — good kayaking/fishing |

Impact chips use translucent tier fills: `bg-impact-low/15 text-impact-low` style.
The heatmap 5-anchor gradient (green/yellow/orange/red/magenta) in `web/js/colors.js` is untouched.

## Theme Toggle

- `web/js/theme.js` wires the `#theme-toggle` button (44×44px min, sun + moon SVGs).
- Inline no-flash snippet in both HTML `<head>`s reads `localStorage['blw-theme']`
  and falls back to `prefers-color-scheme`.
- Basemap follows the theme: light → CARTO `light_all`, dark → CARTO `dark_matter`
  (MutationObserver in `lake.html` swaps the Leaflet tile layer).

## Spacing & Layout

| Token | Value | Usage |
|-------|-------|-------|
| `rounded-sm/md/xl` | `4px / 6px / 12px` | Pills, standard, cards/modals |
| `shadow-sm` | `0 1px 3px` | Subtle lift |
| `shadow-md` | `0 4px 6px` | Cards, buttons |
| `shadow-lg` | `0 10px 15px` | Modals, dropdowns |

## Breakpoints

| Width | Target |
|-------|--------|
| `sm` (≥ 640px) | Lake card grid 1→2 cols, compact header controls |
| `lg` (≥ 1024px) | Lake card grid 2→3 cols |
| ≤ 420px | Ultra-compact, `max-[420px]:` variants for text truncation |

## Principles

1. **High contrast, low clutter** — Token-based, adaptive light/dark. No decorative noise.
2. **Data-first** — The heatmap is the hero. Chrome recedes until needed.
3. **Touch-friendly** — Minimum 44px touch targets. No hover-dependent interactions.
4. **Mobile-native** — Designed for single-hand phone use on the water. Desktop is secondary.
5. **Accessible** — Visible `focus-visible` rings (`ring-ring`), `prefers-reduced-motion`
   respected via `motion-safe:` variants, no emoji as icons (SVG only).
