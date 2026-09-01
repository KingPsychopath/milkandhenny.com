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

The palette is defined as CSS variables in `src/styles/globals.css` and switched via `[data-theme="dark"]`.

Principles:

- **No hardcoded hex in components**. Use theme variables/classes.
- **Neutral-first**: most UI should read as stone + ink, with emphasis via weight/opacity/spacing.
- **Light mode** uses cream/warm stone (paper-like).
- **Dark mode** uses deep warm brown (ink-like), not blue-black.
- **Single accent**: amber is used sparingly to signal meaning (featured/emphasis/affordance), not decoration.
- **Admin semantic colour**: operational state may use restrained green (healthy/success), amber
  (waiting/attention), and red (failed/blocked). Keep surrounding surfaces neutral, always pair colour
  with a written label, and leave inactive or historical states grey.
- **Avoid "system blue" energy**: links/interactive states should feel quiet; prefer underline/opacity over color swaps.

### Palette (source of truth: `src/styles/globals.css`)

Do not duplicate the color values in documentation; the implementation uses OKLCH tokens and may
be tuned. Preserve these roles:

| Token group                                                  | Role                                  |
| ------------------------------------------------------------ | ------------------------------------- |
| `--background`, `--foreground`                               | Primary paper and ink                 |
| `--stone-100` through `--stone-500`                          | Surfaces, borders, and text hierarchy |
| `--prose-body`, `--prose-heading`                            | Editorial reading hierarchy           |
| `--prose-hashtag`                                            | Restrained warm accent                |
| `--selection-bg`, `--selection-fg`                           | Text selection                        |
| `--status-positive`, `--status-attention`, `--status-danger` | Operational status semantics          |

Practical usage notes:

- If you need a new color, add a token in `src/styles/globals.css` (light + dark) rather than introducing a one-off hex.
- For interactive states, prefer underline/opacity/weight changes before adding new hues.

Related utilities:

- `theme-muted`, `theme-subtle`, `theme-faint`
- `theme-border`, `theme-border-strong`, `theme-border-faint`

---

## Typography (Two-World Model)

Typography expresses which "world" you're in while keeping a single brand voice.

### 1) Editorial surfaces

Routes: `/`, `/words`, `/words/[slug]`, `/vault/[slug]`, `/pics`

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
- **Press** uses the shared one-pixel/scale response. Feature-local buttons do
  not invent their own timing.
- **Embeds** (like album cards) should not rely on inline styles for hover behavior.
  Keep hover effects in CSS so the cascade is predictable.

### Action hierarchy

Use the `mh-action` primitive so the same hierarchy reads consistently across
public, attendee, staff, and admin surfaces:

- `mh-action--primary`: the one clearest next step; filled ink on paper.
- `mh-action--secondary`: a visible alternative; transparent with a hairline.
- `mh-action--quiet`: low-emphasis utility action; a restrained underline.
- `mh-action--danger`: destructive or difficult-to-reverse; amber outline and text.
- `mh-action--icon`: a 44px square supplement for an icon-only control. It still
  requires an accessible name.

The base class owns target size, mono typography, spacing, and reaction timing.
All ordinary buttons also inherit the site-wide hover/press transition, so
older feature-local controls do not snap while they are migrated to a named
variant.

### Navigation is contextual

The site is a sequence of rooms, not a dashboard with the same navigation on
every page. The home page presents the main destinations. Deep public pages
may add breadcrumbs and a contextual journey rail, while Things, live games,
the studio, admin, health, and transactional surfaces keep their own controls.

Keep a contextual back link and the brand separate with a real responsive gap;
the brand is already the quiet route home. Do not add a second global home
control beside it just to fill the header. A full footer is for public
editorial, legal, contact, and subscription surfaces, not a compulsory element
of every product screen. See [navigation.md](./navigation.md) for the browser
history and URL-state rule.

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
2. **Global CSS for tokens + prose + a small set of site-wide primitives** (`src/styles/globals.css`).
3. **Rare bespoke CSS classes** for hard-to-express rules (markdown prose, embeds, keyframe-driven animations).

Tailwind v4 layering is used to keep ordering deterministic:

- `@layer base`: element defaults, a11y, global behaviors
- `@layer components`: prose + shared primitives
- `@layer utilities`: small helper classes (prefixed / non-colliding)

If a new style is feature-local, prefer co-locating it with the component (utilities first).
