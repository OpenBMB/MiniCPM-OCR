# @map/ui — Design Reference

Companion reference for `packages/ui/src/theme.css` (the token source of truth) and the
`design-system` rule. This documents the _rationale_ behind the foundations and the _recommended
additions_ for the MAP evaluation platform (B2B, data-dense, dark-mode-first).

> Tokens are HSL channel values consumed via `hsl(var(--token) / <alpha-value>)` in Tailwind.
> **To change anything, edit `theme.css` only.** This file explains and recommends; it does not redefine.

## 1. Foundations (already in place — keep)

These choices fit a data-dense B2B analytics product and should not be changed casually:

| Foundation   | Current value                      | Why it fits                                                                                                   |
| ------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Primary      | `239 84% 67%` (indigo)             | Trustworthy, neutral-cool — standard for analytics/admin tooling. Keep it; do **not** swap to a generic blue. |
| Typography   | Inter                              | Excellent at small sizes and dense tables; the right default sans for admin UIs.                              |
| Theme        | Light + `.dark` via `class`        | Dark-mode-first is correct for long-session, low-light evaluation work (WCAG AAA achievable).                 |
| Density      | `text-[13px]` base, `h-8` controls | Compact B2B density maximizes information per screen.                                                         |
| Architecture | Semantic tokens + auto dark mode   | Single source of truth; no per-component `dark:` variants.                                                    |

## 2. Recommended additions

The research surfaced three real gaps. Each is additive and backward-compatible.

### 2.1 State tokens (fixes a latent bug)

`Badge` exposes `success` / `warning` variants and the `design-system` rule references `bg-success` /
`text-success`, but **`theme.css` defines no `--success` / `--warning` tokens.** Add semantic state
tokens so status colors come from the system, not ad-hoc classes:

```css
/* :root (light) */
--success: 160 84% 39%; /* emerald-500  — passed / online / healthy */
--success-foreground: 0 0% 100%;
--warning: 38 92% 50%; /* amber-500    — degraded / pending */
--warning-foreground: 38 92% 12%;
--info: 217 91% 60%; /* blue-500     — neutral notice */
--info-foreground: 0 0% 100%;

/* .dark — lightened for contrast on dark surfaces */
--success: 158 64% 52%; /* emerald-400 */
--warning: 43 96% 56%; /* amber-400 */
--info: 213 94% 68%; /* blue-400 */
```

> **Applied.** These tokens now live in `theme.css`; `tailwind.config.js` exposes `success` / `warning` /
> `info` utilities. Status `Badge` variants (`info` / `success` / `warning` / `destructive`) all use the
> same soft fill pattern: `bg-<token>/15 text-<token>`. Solid `default` is for emphasis tags only.

Amber doubles as the accent/CTA highlight the analytics palette recommends (blue data + amber emphasis),
without disturbing the indigo primary.

### 2.2 Chart palette tokens (for Leaderboard / metrics)

An evaluation platform lives on charts (model rankings, score trends, multi-metric comparisons). Define a
categorical scale so every chart pulls from the design system instead of hardcoded hex. Recharts reads
CSS variables directly.

```css
/* :root and .dark — keep series perceptually distinct and colorblind-safe */
--chart-1: 239 84% 67%; /* indigo  (primary series) */
--chart-2: 173 80% 40%; /* teal */
--chart-3: 38 92% 50%; /* amber */
--chart-4: 330 81% 60%; /* pink */
--chart-5: 217 91% 60%; /* blue */
--chart-6: 142 71% 45%; /* emerald */
```

Usage: `fill="hsl(var(--chart-1))"`, `stroke="hsl(var(--chart-2))"`.

### 2.3 Monospace font (numeric & code data)

LLM evaluation data is full of aligned numbers (scores, token counts, latency ms), JSON, and code/model
output. A tabular mono font improves scannability. Add a `mono` family and apply it to numeric table
cells and code blocks:

```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap');
```

```js
// tailwind.config.js
fontFamily: {
  sans: ['Inter', 'sans-serif'],
  mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
}
```

Apply `font-mono tabular-nums` to score/metric columns so digits align in `ProTable`.

## 3. Chart guidance (evaluation domain)

| Need                          | Chart                             | Library  | Notes                                                                 |
| ----------------------------- | --------------------------------- | -------- | --------------------------------------------------------------------- |
| Model ranking / leaderboard   | Horizontal **Bar** (sorted desc)  | Recharts | Add value labels on bars; one color per bar or grouped by category.   |
| Score / usage over time       | **Line** (or Area, 20% fill)      | Recharts | Distinct color per series; add pattern overlays for colorblind users. |
| Multi-metric model comparison | **Radar**                         | Recharts | Limit to 5–8 axes; always pair with a data table.                     |
| Pass/fail or category share   | Stacked Bar (avoid pie >5 slices) | Recharts | Prefer bars over pie for precise comparison.                          |

All charts: use `--chart-*` tokens, keep an accessible `<table>` fallback, and never rely on color alone.

## 4. Data-table UX (ProTable)

`ProTable` already covers most of this — verify when extending it:

- **Responsive**: PC table → mobile card view (built in). Wrap any custom wide table in `overflow-x-auto`.
- **Bulk actions**: provide a checkbox column + an action bar for multi-select; don't force per-row repetition.
- **Errors**: announce with `role="alert"` / `aria-live`; never indicate state by color (e.g. red border) alone.
- **Empty / loading**: use `Empty` and `Skeleton` from `@map/ui`.

## 5. Pre-delivery checklist

- [ ] Colors from tokens only (incl. new `--success`/`--warning`/`--info`/`--chart-*`); no raw hex.
- [ ] Verified in light **and** dark mode.
- [ ] SVG icons only (Lucide/Heroicons) — no emoji as icons.
- [ ] `cursor-pointer` + 150–300ms transition on every clickable element.
- [ ] Light-mode text contrast ≥ 4.5:1; focus states visible for keyboard nav.
- [ ] `prefers-reduced-motion` respected.
- [ ] Responsive at 375 / 768 / 1024 / 1440px; no horizontal scroll on mobile.
- [ ] Numeric/code data uses `font-mono tabular-nums`.

---

_Generated with the `ui-ux-pro-max` design research workflow, reconciled against the existing
`theme.css` tokens. §2 recommendations are applied (state tokens, chart palette `--chart-1..6`,
JetBrains Mono). Apply chart tokens in components via `hsl(var(--chart-N))` / the `chart-N` utilities._
