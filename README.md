# Milk & Henny

A personal platform for party check-ins, photo galleries, unified long-form words, and private file sharing — built with Next.js, Cloudflare R2, and Vercel KV.

## Quick Start

```bash
pnpm install
pnpm dev
# → http://localhost:3000
```

Words, guest list, and best-dressed work with zero config (in-memory fallback). Photo galleries and transfers need env vars — copy `.env.local.example` to `.env.local` and fill in values; see [environment variables](#environment-variables).

```bash
pnpm test          # run all tests
pnpm test:watch    # re-run on file changes
```

**CLI:** Run `pnpm cli` with no arguments for an **interactive menu** — pick Albums, Photos, Transfers, Words Media, or Words and follow the prompts. All commands are also available as direct subcommands.

---

## What's in Here

| Feature | Route | Data source | What it does |
|---------|-------|-------------|-------------|
| **Blog** | `/`, `/words` | Vercel KV (metadata) + R2 | Writing-first posts (type = `blog`) inside the unified words system |
| **Photo gallery** | `/pics` | JSON manifests (`content/albums/`) + R2 | Album galleries with masonry grid, lightbox, download |
| **Party hub** | `/party` | — | Entry point for event-night features: icebreaker game, best-dressed voting, guest list (staff) |
| **Guest list** | `/guestlist` | Vercel KV (Redis) | Real-time check-in for door staff, multi-device sync |
| **Admin dashboard** | `/admin` | Vercel KV (Redis) + admin auth | Unified admin controls for guest reset, vote reset, upload/admin tools |
| **Best dressed** | `/best-dressed` | Vercel KV (Redis) | Live voting leaderboard for party guests |
| **Words** | `/words`, `/words/{slug}` | Vercel KV (metadata) + R2 | Unified blog/notes/recipes/reviews with visibility controls and signed links |
| **Transfers** | `/t/{id}` | Vercel KV (Redis) + R2 | Self-destructing file sharing (your own WeTransfer) |
| **CLI** | `pnpm cli` | R2 + KV | Manage albums, photos, transfers, words content, and media from the terminal |

---

## Code Organization

This repo uses two top-level buckets for server code and shared logic:

- `features/` — product domains (the stuff you build)
  - `features/guests/*` guest model + persistence + CSV import
  - `features/transfers/*` transfer model + persistence + upload pipeline
  - `features/media/*` albums + storage URLs + image processing
  - `features/words/*` words storage + share-link access
  - `features/auth/*` server-side auth primitives
- `lib/` — cross-cutting primitives (the toolbox)
  - `lib/platform/*` server-only infrastructure (R2, Redis/KV, logging, safe API errors)
  - `lib/shared/*` safe in both server + client (config, formatting, storage keys)
  - `lib/client/*` browser-only utilities
  - `lib/http/*`, `lib/markdown/*` general helpers

Rule of thumb: if a module describes a domain concept (guest, transfer, album), it belongs in `features/`. If it’s a primitive used across domains (logging, config, fetch retry), it belongs in `lib/`.

### Why no global utils/ folder

This repo intentionally avoids a top-level `utils/` directory. In practice, global utils folders tend to become a junk drawer: unrelated helpers pile up, naming gets vague, and the dependency graph becomes hard to reason about.

Instead:
- Feature-specific helpers live next to the feature (`features/*/utils.ts`).
- Cross-feature primitives live in `lib/shared/*` (or `lib/http/*`, `lib/markdown/*`).
- UI-only helpers live colocated under the route when they only matter for that UI.

## Features

### Guest List

Real-time check-in system for door staff at events.

- Tap to check in/out guests with optimistic UI
- Multi-device sync via polling (5s active, 30s when tab is backgrounded)
- CSV import from Partiful exports
- Search, filter, +1 relationships
- Two auth gates: **Staff PIN** (door access) and **Admin password** (management + admin actions)

**Usage:** Place your CSV at `public/guests.csv` (auto-loads on first visit), or click **Manage** → enter admin password → **Import CSV**.

### Party Hub

`/party` is the kiosk-style entry point for event-night features: **Icebreaker** (party game), **Best dressed** (voting), and **Guest list** (door staff check-in). Minimal nav, funnels back to home. See [navigation design](./docs/architecture.md#navigation--footer-design) in the architecture doc.

### Private Transfers

Self-destructing file sharing — upload any files via CLI or web, get a link at `/t/{id}` that auto-expires.

- Images, videos, GIFs, PDFs, zips — anything
- Masonry gallery with lightbox for images, video player for video, download cards for files
- Memorable 3-word URLs (e.g. `velvet-moon-candle`)
- Admin takedown via CLI or token URL
- Web upload at `/upload` (gated by `UPLOAD_PIN`) uses presigned URLs — files go direct to R2, never through Vercel
- Admin words uploads in `/upload`:
  - `content media` writes to `words/media/{slug}/...`
  - `shared assets` writes to `words/assets/{assetId}/...`

```bash
pnpm cli transfers upload      # Interactive: pick folder, set title, set expiry
pnpm cli transfers list        # See all active transfers + time remaining
pnpm cli transfers delete <id> # Take down a transfer + delete R2 files
pnpm cli auth diagnose --admin-password <password> --base-url https://milkandhenny.com
pnpm cli auth revoke --admin-password <password> --role admin --base-url https://milkandhenny.com
```

### Photo Gallery

Album-based photo galleries served from Cloudflare R2.

- Masonry grid with lazy-loaded thumbnails
- Lightbox with keyboard/swipe navigation
- Individual + batch ZIP download (direct from R2, no Vercel bandwidth)
- Blog embed cards: `[Title](/pics/slug)` renders as a preview card in blog posts
- OG images with face detection and text overlay

```bash
pnpm cli albums upload         # Upload a new album
pnpm cli photos add <album>   # Add photos to existing album
```

For the full media pipeline (OG images, face detection, focal points, image rotation), see [docs/media-pipeline.md](./docs/media-pipeline.md).

### Words + Blog

All long-form content lives in the unified **words** model (`blog`, `note`, `recipe`, `review`).

- Metadata in KV (`words:meta:{slug}` + `words:index`)
- Markdown body in R2 (`words/{type}/{slug}/content.md`)
- Visibility: `public`, `unlisted`, `private`
- Route model: public/unlisted render at `/words/[slug]`; private renders at `/vault/[slug]`
- Tags and featured flags are shared across all types
- Reading time + editorial rendering stays intact for blog-style pages

Media paths:

- Per-word media: `words/media/{slug}/...`
- Shared reusable assets: `words/assets/{assetId}/...`

Markdown references:

- Word-specific image/file:
  - `![hero](words/media/my-word-slug/hero.webp)`
- Shared reusable image/file:
  - `![logo](words/assets/brand-kit/logo.webp)`
  - `[press-kit](words/assets/brand-kit/press-kit.pdf)`

Compatibility note:

- Canonical `words/...` paths are the recommended output from upload/editor tooling.
- Existing short refs like `![hero](hero.webp)` and `![logo](assets/brand-kit/logo.webp)` are still accepted and normalized when word markdown is saved.

Why this layout:

- `words/{type}/{slug}/content.md` keeps body content canonical per word type.
- `words/media/{slug}/...` stays slug-scoped so changing a word `type` does not force media moves.
- `words/assets/{assetId}/...` avoids duplication for reusable files across multiple words.

```bash
pnpm cli media upload --slug <word-slug> --dir <path>
pnpm cli media upload --asset <asset-id> --dir <path>
pnpm cli media list --slug <word-slug>
pnpm cli media list --asset <asset-id>
pnpm cli media orphans --limit 200
pnpm cli media purge-stale
pnpm cli words migrate-legacy --purge-legacy
```

### Private + Unlisted Words

Private and unlisted words are part of the unified words system and are stored outside git:

- Metadata in KV (`words:meta:{slug}`)
- Markdown body in R2 (`words/{type}/{slug}/content.md`)
- Visibility: `public`, `unlisted`, `private`
- Signed share links with optional **per-link PIN** (no global reader PIN)
- Private share links resolve to `/vault/[slug]?share=...`

CLI:

```bash
pnpm cli words create --slug <slug> --title <title> --markdown-file <path>
pnpm cli words share create <slug> --pin-required --pin <pin>
pnpm cli words share update <slug> <share-id> --pin-required true --pin <new-pin>
```

### CLI Auth Notes

- `auth` commands (`sessions`, `revoke`, `diagnose`) call protected API routes with `Authorization: Bearer`.
- The CLI now resolves your canonical origin first to avoid auth-header loss on host redirects (for example `milkandhenny.com` -> `www.milkandhenny.com`).
- CLI admin-session caching is in-memory for the current CLI process only.
- In one interactive `pnpm cli` session, you usually do not need to re-enter password for every auth action.
- In separate direct invocations (`pnpm cli auth ...` run again later), expect to enter password again unless you pass `--admin-token`.
- If auth feels inconsistent, run:

```bash
pnpm cli auth diagnose --admin-password <password> --base-url https://milkandhenny.com
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| State (ephemeral) | Vercel KV (Upstash Redis) |
| File storage | Cloudflare R2 |
| CDN (images) | Cloudflare (custom domain, zero egress) |
| CDN (pages) | Vercel Edge Network |
| Face detection | ONNX Runtime + UltraFace 320 (~1.2 MB model) |
| CLI | `tsx` scripts with interactive prompts |

---

## Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `KV_REST_API_URL` | Yes (for persistence) | Vercel KV / Upstash Redis REST URL |
| `KV_REST_API_TOKEN` | Yes (for persistence) | Vercel KV / Upstash Redis REST token |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | Yes (images/files) | e.g. `https://pics.milkandhenny.com` |
| `R2_ACCOUNT_ID` | Yes (uploads, cron) | Cloudflare account ID |
| `R2_ACCESS_KEY` | Yes (uploads, cron) | R2 API token access key |
| `R2_SECRET_KEY` | Yes (uploads, cron) | R2 API token secret key |
| `R2_BUCKET` | Yes (uploads, cron) | R2 bucket name |
| `AUTH_SECRET` | Yes (auth) | JWT signing key. Generate: `openssl rand -hex 32` (minimum 32 chars). |
| `STAFF_PIN` | Yes (guestlist) | PIN for door staff. Not in client bundle. |
| `ADMIN_PASSWORD` | Yes (admin) | Gate for management UI and admin dashboard. Weak values show up as warnings. Not in client bundle. |
| `UPLOAD_PIN` | Yes (upload) | Dedicated PIN for `/upload` (shareable with non-admin uploaders). |
| `NEXT_PUBLIC_BASE_URL` | CLI only | For generating share URLs. Not needed on Vercel. |
| `CRON_SECRET` | Optional | Secures cleanup cron endpoints. |

Everything degrades gracefully when env vars are missing — see [resilience table](./docs/architecture.md#resilience-what-happens-when-env-vars-are-missing).

---

## Deployment

1. Push to GitHub
2. Connect to Vercel
3. Add env vars (KV, R2, auth — see table above)
4. Deploy — cron jobs in `vercel.json` activate automatically (transfer cleanup, word-share cleanup, and stale word-media orphan cleanup)

---

## Further Reading

| Document | What's in it |
|----------|-------------|
| [docs/design-language.md](./docs/design-language.md) | Design language — palette, typography, motion, interaction rules, and why the UI looks the way it does |
| [docs/architecture.md](./docs/architecture.md) | Hosting & routing, data storage patterns, caching strategy, resilience/fallbacks, navigation design, error handling & logging |
| [docs/security.md](./docs/security.md) | Authentication model, rate limiting, incident response & key rotation |
| [docs/media-pipeline.md](./docs/media-pipeline.md) | OG image generation, face detection, focal points, image rotation & HEIC handling |
| [docs/operations.md](./docs/operations.md) | KV command budget, cost & limits, R2 lifecycle rules |
| [docs/cloudflare-rate-limit-images.md](./docs/cloudflare-rate-limit-images.md) | Step-by-step Cloudflare WAF rate limiting setup |
| [docs/testing.md](./docs/testing.md) | Testing strategy — what we test, why, and where each type of test lives |

---

## License

**Proprietary. All rights reserved.** See [LICENSE](./LICENSE). No use, copy, or distribution without permission. The repo is public for reference and discussion (e.g. portfolio, interviews). If you want to use or adapt the code, contact me first.
