# Design Language

Milk & Henny is intentionally "writing-first": content gets the space, the UI stays quiet, and the tone is warm rather than sterile.

This document explains the decisions behind the visual system so changes stay consistent over time.

---

## The Core Idea

**Editorial typewriter**: a blend of reading-first editorial layout and confident monospace UI chrome.

- **Prose is serif** (Lora): long-form reading feels human.
- **UI is mono** (Geist Mono): labels feel deliberate, grounded, and slightly "tool-like".
- **Color is warm stone**: no cold blue-greys; accent is amber.
- **Motion is subtle**: opacity and small transforms; nothing flashy.

---

## Color System (Warm Stone, Apple-Like Restraint)

The palette is defined as CSS variables in `app/globals.css` and switched via `[data-theme="dark"]`.

Principles:

- **No hardcoded hex in components**. Use theme variables/classes.
- **Neutral-first**: most UI should read as stone + ink, with emphasis via weight/opacity/spacing.
- **Light mode** uses cream/warm stone (paper-like).
- **Dark mode** uses deep warm brown (ink-like), not blue-black.
- **Single accent**: amber is used sparingly to signal meaning (featured/emphasis/affordance), not decoration.
- **Avoid "system blue" energy**: links/interactive states should feel quiet; prefer underline/opacity over color swaps.

### Palette (source of truth: `app/globals.css`)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--background` | `#fafaf9` | `#1c1917` | page surface |
| `--foreground` | `#1c1917` | `#e7e5e4` | primary text/icons |
| `--stone-100` | `#f5f5f4` | `#292524` | subtle surfaces |
| `--stone-200` | `#e7e5e4` | `#44403c` | hairlines/dividers (`theme-border`) |
| `--stone-300` | `#d6d3d1` | `#57534e` | stronger borders (`theme-border-strong`) |
| `--stone-400` | `#a8a29e` | `#78716c` | muted text (`theme-muted`) |
| `--stone-500` | `#78716c` | `#a8a29e` | subtle text (`theme-subtle`) |
| `--prose-body` | `#292524` | `#d6d3d1` | long-form body text |
| `--prose-heading` | `#1c1917` | `#e7e5e4` | titles/headings |
| `--prose-hashtag` | `#b45309` | `#fbbf24` | warm accent (hashtags/progress) |
| `--selection-bg` | `#fef3c7` | `#422006` | text selection background |
| `--selection-fg` | `#92400e` | `#fbbf24` | text selection foreground |

Related utilities:

- `theme-muted`, `theme-subtle`, `theme-faint`
- `theme-border`, `theme-border-strong`, `theme-border-faint`

---

## Typography (Two-World Model)

Typography expresses which "world" you're in while keeping a single brand voice.

### 1) Editorial surfaces

Routes: `/`, `/blog`, `/blog/[slug]`, `/pics`

- **Titles + body**: `font-serif` (Lora) for reading comfort.
- **Labels + metadata** (date, reading time, crumbs, share): `font-mono` (Geist Mono).
- **Prose wrapper**: `.prose-blog` sets the reading rhythm (size, line-height, spacing).

### 2) Party / utility surfaces

Routes: `/party`, `/guestlist`, `/best-dressed`, `/icebreaker`, plus tools like `/upload`, `/t/[id]`

- **UI-first**: clearer hierarchy, larger hit targets, faster scanning.
- Still uses the same warm stone palette so it feels like the same product.

---

## Layout (Single Column, Maximum Readability)

The default layout is intentionally simple:

- Single column.
- Max width: `max-w-2xl`.
- Generous vertical spacing.
- Hairline dividers using `theme-border`.

Design rule of thumb:

If you feel tempted to add a sidebar, it probably means the page content hierarchy needs work.

---

## Interaction (Quiet, Predictable)

We prefer "confidence through restraint":

- **Hover** should usually be `opacity` changes, not sudden color flips.
- **Focus** uses a consistent theme-aware outline for keyboard navigation.
- **Embeds** (like album cards) should not rely on inline styles for hover behavior.
  Keep hover effects in CSS so the cascade is predictable.

---

## Motion (Sunlight to Moonlight)

Motion exists to clarify, not decorate:

- Theme transitions use a soft 0.4s ease.
- Content animations are short and rare (e.g. slide-in modal, gentle image fade).
- Avoid defining custom CSS utilities that collide with Tailwind utilities.
  Example: never create a `.duration-300` class (Tailwind already owns that name).

---

## Where Styles Live

We intentionally keep styling in three buckets:

1. **Tailwind utilities in components** (default).
2. **Global CSS for tokens + prose + a small set of site-wide primitives** (`app/globals.css`).
3. **Rare bespoke CSS classes** for hard-to-express rules (markdown prose, embeds, keyframe-driven animations).

Tailwind v4 layering is used to keep ordering deterministic:

- `@layer base`: element defaults, a11y, global behaviors
- `@layer components`: prose + shared primitives
- `@layer utilities`: small helper classes (prefixed / non-colliding)

If a new style is feature-local, prefer co-locating it with the component (utilities first).

