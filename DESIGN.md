# Blue Lake Wave Forecast — Design System

Inspired by [Stripe](https://stripe.com)'s design language. Reference: `popular-web-designs` skill (Stripe).

## Typography

| Token | Value |
|-------|-------|
| Body / Headings | `Source Sans 3`, system-ui, -apple-system, sans-serif |
| Mono / Data | `Source Code Pro`, SF Mono, monospace |
| Weights | 300 (light), 400 (regular), 600 (semibold) |

Sourced from Google Fonts:
```html
<link href="https://fonts.googleapis.com/css2?family=Source+Code+Pro:wght@400;500&family=Source+Sans+3:wght@300;400;600&display=swap" rel="stylesheet">
```

## Colors

### Brand

| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#533afd` | Primary purple — buttons, links, active states |
| `--accent-light` | `#7c6fff` | Hover / subtle accent variants |
| `--heading` | `#061b31` | Dark navy — headings, labels |
| `--body` | `#64748d` | Slate — body text, secondary information |
| `--border` | `#e5edf5` | Light blue-gray — card borders, dividers |

### Impact Tiers (Wave Hazard)

| Tier | Color | Condition | Meaning |
|------|-------|-----------|---------|
| High | `#ea2261` | Impact score > 0.40 | Rough — avoid or use extreme caution |
| Medium | `#f59e0b` | Impact score 0.15–0.40 | Choosy — manage risk |
| Low | `#15be53` | Impact score < 0.15 | Calm — good kayaking/fishing |

## CSS Custom Properties

```css
:root {
  --bg: #ffffff;
  --heading: #061b31;
  --accent: #533afd;
  --accent-light: #7c6fff;
  --body: #64748d;
  --border: #e5edf5;
  --card-shadow: 0 2px 12px rgba(50,50,93,0.15), 0 1px 2px rgba(0,0,0,0.04);
  --card-shadow-lg: 0 8px 30px rgba(50,50,93,0.25), 0 2px 8px rgba(0,0,0,0.06);
  --radius-sm: 4px;
  --radius: 6px;
  --radius-lg: 10px;
  --font: 'Source Sans 3', system-ui, -apple-system, sans-serif;
  --font-mono: 'Source Code Pro', 'SF Mono', monospace;
  --impact-high: #ea2261;
  --impact-medium: #f59e0b;
  --impact-low: #15be53;
}
```

## Spacing

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `4px` | Small elements (pills, badges) |
| `--radius` | `6px` | Standard — cards, inputs, buttons |
| `--radius-lg` | `10px` | Large — modals, panels |

Card shadows use a subtle dual-layer approach (small offset + large blur) for depth without heavy borders.

## Breakpoints

| Width | Target |
|-------|--------|
| ≤ 1024px | Tablet — collapse sidebar, reduce padding |
| ≤ 640px | Large phone — single column, larger touch targets |
| ≤ 420px | Small phone — ultra-compact, `data-short` attributes for text truncation |

## Land Cover Toggle

The land cover toggle button uses a `data-short="🌲"` attribute for ultra-compact display on screens ≤ 420px wide, where the full text label would overflow.

## Principles

1. **High contrast, low clutter** — Dark navy headings on white, slate body text. No decorative noise.
2. **Data-first** — The heatmap is the hero. Chrome recedes until needed.
3. **Touch-friendly** — Minimum 44px touch targets. No hover-dependent interactions.
4. **Mobile-native** — Designed for single-hand phone use on the water. Desktop is secondary.
