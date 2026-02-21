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

Swatches are rendered with inline HTML for quick visual scanning. Some Markdown renderers sanitize inline styles; if you don't see swatches, treat the hex codes as the source of truth.

| Token | Light | Light swatch | Dark | Dark swatch | Use |
| --- | --- | --- | --- | --- | --- |
| `--background` | `#fafaf9` | <span title="#fafaf9" style="display:inline-block;width:0.95em;height:0.95em;background:#fafaf9;border:1px solid #e7e5e4;border-radius:0.2em;vertical-align:middle;"></span> | `#1c1917` | <span title="#1c1917" style="display:inline-block;width:0.95em;height:0.95em;background:#1c1917;border:1px solid #44403c;border-radius:0.2em;vertical-align:middle;"></span> | page surface |
| `--foreground` | `#1c1917` | <span title="#1c1917" style="display:inline-block;width:0.95em;height:0.95em;background:#1c1917;border:1px solid #e7e5e4;border-radius:0.2em;vertical-align:middle;"></span> | `#e7e5e4` | <span title="#e7e5e4" style="display:inline-block;width:0.95em;height:0.95em;background:#e7e5e4;border:1px solid #44403c;border-radius:0.2em;vertical-align:middle;"></span> | primary text/icons |
| `--stone-100` | `#f5f5f4` | <span title="#f5f5f4" style="display:inline-block;width:0.95em;height:0.95em;background:#f5f5f4;border:1px solid #e7e5e4;border-radius:0.2em;vertical-align:middle;"></span> | `#292524` | <span title="#292524" style="display:inline-block;width:0.95em;height:0.95em;background:#292524;border:1px solid #44403c;border-radius:0.2em;vertical-align:middle;"></span> | subtle surfaces |
| `--stone-200` | `#e7e5e4` | <span title="#e7e5e4" style="display:inline-block;width:0.95em;height:0.95em;background:#e7e5e4;border:1px solid #d6d3d1;border-radius:0.2em;vertical-align:middle;"></span> | `#44403c` | <span title="#44403c" style="display:inline-block;width:0.95em;height:0.95em;background:#44403c;border:1px solid #57534e;border-radius:0.2em;vertical-align:middle;"></span> | hairlines/dividers (`theme-border`) |
| `--stone-300` | `#d6d3d1` | <span title="#d6d3d1" style="display:inline-block;width:0.95em;height:0.95em;background:#d6d3d1;border:1px solid #a8a29e;border-radius:0.2em;vertical-align:middle;"></span> | `#57534e` | <span title="#57534e" style="display:inline-block;width:0.95em;height:0.95em;background:#57534e;border:1px solid #78716c;border-radius:0.2em;vertical-align:middle;"></span> | stronger borders (`theme-border-strong`) |
| `--stone-400` | `#a8a29e` | <span title="#a8a29e" style="display:inline-block;width:0.95em;height:0.95em;background:#a8a29e;border:1px solid #78716c;border-radius:0.2em;vertical-align:middle;"></span> | `#78716c` | <span title="#78716c" style="display:inline-block;width:0.95em;height:0.95em;background:#78716c;border:1px solid #a8a29e;border-radius:0.2em;vertical-align:middle;"></span> | muted text (`theme-muted`) |
| `--stone-500` | `#78716c` | <span title="#78716c" style="display:inline-block;width:0.95em;height:0.95em;background:#78716c;border:1px solid #a8a29e;border-radius:0.2em;vertical-align:middle;"></span> | `#a8a29e` | <span title="#a8a29e" style="display:inline-block;width:0.95em;height:0.95em;background:#a8a29e;border:1px solid #78716c;border-radius:0.2em;vertical-align:middle;"></span> | subtle text (`theme-subtle`) |
| `--prose-body` | `#292524` | <span title="#292524" style="display:inline-block;width:0.95em;height:0.95em;background:#292524;border:1px solid #e7e5e4;border-radius:0.2em;vertical-align:middle;"></span> | `#d6d3d1` | <span title="#d6d3d1" style="display:inline-block;width:0.95em;height:0.95em;background:#d6d3d1;border:1px solid #57534e;border-radius:0.2em;vertical-align:middle;"></span> | long-form body text |
| `--prose-heading` | `#1c1917` | <span title="#1c1917" style="display:inline-block;width:0.95em;height:0.95em;background:#1c1917;border:1px solid #e7e5e4;border-radius:0.2em;vertical-align:middle;"></span> | `#e7e5e4` | <span title="#e7e5e4" style="display:inline-block;width:0.95em;height:0.95em;background:#e7e5e4;border:1px solid #44403c;border-radius:0.2em;vertical-align:middle;"></span> | titles/headings |
| `--prose-hashtag` | `#b45309` | <span title="#b45309" style="display:inline-block;width:0.95em;height:0.95em;background:#b45309;border:1px solid #92400e;border-radius:0.2em;vertical-align:middle;"></span> | `#fbbf24` | <span title="#fbbf24" style="display:inline-block;width:0.95em;height:0.95em;background:#fbbf24;border:1px solid #92400e;border-radius:0.2em;vertical-align:middle;"></span> | warm accent (hashtags/progress) |
| `--selection-bg` | `#fef3c7` | <span title="#fef3c7" style="display:inline-block;width:0.95em;height:0.95em;background:#fef3c7;border:1px solid #fbbf24;border-radius:0.2em;vertical-align:middle;"></span> | `#422006` | <span title="#422006" style="display:inline-block;width:0.95em;height:0.95em;background:#422006;border:1px solid #92400e;border-radius:0.2em;vertical-align:middle;"></span> | text selection background |
| `--selection-fg` | `#92400e` | <span title="#92400e" style="display:inline-block;width:0.95em;height:0.95em;background:#92400e;border:1px solid #fef3c7;border-radius:0.2em;vertical-align:middle;"></span> | `#fbbf24` | <span title="#fbbf24" style="display:inline-block;width:0.95em;height:0.95em;background:#fbbf24;border:1px solid #92400e;border-radius:0.2em;vertical-align:middle;"></span> | text selection foreground |

Practical usage notes:

- If you need a new color, add a token in `app/globals.css` (light + dark) rather than introducing a one-off hex.
- For interactive states, prefer underline/opacity/weight changes before adding new hues.

Related utilities:

- `theme-muted`, `theme-subtle`, `theme-faint`
- `theme-border`, `theme-border-strong`, `theme-border-faint`

---

## Typography (Two-World Model)

Typography expresses which "world" you're in while keeping a single brand voice.

### 1) Editorial surfaces

Routes: `/`, `/words`, `/words/[slug]`, `/pics`

- **Titles + body**: `font-serif` (Lora) for reading comfort.
- **Labels + metadata** (date, reading time, crumbs, share): `font-mono` (Geist Mono).
- **Prose wrapper**: `.prose-blog` sets the reading rhythm (size, line-height, spacing).

### 2) Non-editorial / utility surfaces (not the focus here)

Some routes are intentionally more "app-like". This doc is primarily about the editorial site; keep non-editorial UI consistent by reusing the same tokens (color, focus, borders) without forcing serif-prose rules everywhere.

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

## Spacing + Rhythm (Breathing Room)

The editorial site should feel calm and deliberate.

- **Max width** stays `max-w-2xl` (reading measure > density).
- **Horizontal padding** stays consistent (`px-6`) so pages align.
- **Vertical spacing** should come from a small repeatable set (avoid one-off `mt-[23px]`-style tweaks).
- **Dividers** are hairlines (`theme-border`) used to separate sections, not to create boxes.

---

## Editorial Components (Patterns To Repeat)

Keep these consistent so new pages feel like they belong immediately:

- **Header / nav**: mono, lowercase, tight tracking; minimal links; no icons unless necessary.
- **Post list items**: title-first; metadata is quiet (`theme-muted`), never competing with the title.
- **Post pages**: generous top padding; reading progress bar is a 2px accent, not a decoration.
- **Footer**: mono, faint; one or two lines max; no link grids.

---

## Imagery (Quiet, Captioned, Intentional)

Images should feel like editorial inserts, not UI decorations.

- Prefer **one strong image** over multiple small ones.
- If an image has meaning, it should have **alt text** and render with a **caption** (figure-like treatment).
- Avoid heavy shadows, borders, or saturated overlays; let the warm stone surfaces do the work.

---

## Content + Voice (Milk & Henny Tone)

- **UI labels** are short, lowercase, and mono (tool-like, calm).
- **Headlines** can be more expressive (serif), but avoid gimmicks (no emoji, no excessive punctuation).
- Prefer **clarity over cleverness** in navigation and metadata.

---

## Interaction (Quiet, Predictable)

We prefer "confidence through restraint":

- **Hover** should usually be `opacity` changes, not sudden color flips.
- **Focus** uses a consistent theme-aware outline for keyboard navigation.
- **Embeds** (like album cards) should not rely on inline styles for hover behavior.
  Keep hover effects in CSS so the cascade is predictable.

---

## Accessibility (Baseline Rules)

- Don’t remove focus rings; use the existing theme-aware focus outline.
- Keep contrast high for body text; use muted tokens for metadata, not for primary content.
- Interactive text should still read as interactive (underline is fine; loud colors are not required).

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
