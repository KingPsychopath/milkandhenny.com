# Milk & Henny

A personal platform for party check-ins, photo galleries, a blog, and private file sharing — built with Next.js, Cloudflare R2, and Vercel KV.

## Quick Start

```bash
pnpm install
pnpm dev
# → http://localhost:3000
```

The blog, guest list, and best-dressed work with zero config (in-memory fallback). Photo galleries and transfers need env vars — copy `.env.local.example` to `.env.local` and fill in values; see [environment variables](#environment-variables).

```bash
pnpm test          # run all tests
pnpm test:watch    # re-run on file changes
```

**CLI:** Run `pnpm cli` with no arguments for an **interactive menu** — pick Albums, Photos, Transfers, or Blog and follow the prompts. All the commands below are also available as direct subcommands (e.g. `pnpm cli transfers upload`).

---

## What's in Here

| Feature | Route | Data source | What it does |
|---------|-------|-------------|-------------|
| **Blog** | `/` | Markdown files (`content/posts/`) | Writing-first blog with warm editorial design |
| **Photo gallery** | `/pics` | JSON manifests (`content/albums/`) + R2 | Album galleries with masonry grid, lightbox, download |
| **Party hub** | `/party` | — | Entry point for event-night features: icebreaker game, best-dressed voting, guest list (staff) |
| **Guest list** | `/guestlist` | Vercel KV (Redis) | Real-time check-in for door staff, multi-device sync |
| **Admin dashboard** | `/admin` | Vercel KV (Redis) + admin auth | Unified admin controls for guest reset, vote reset, upload/admin tools |
| **Best dressed** | `/best-dressed` | Vercel KV (Redis) | Live voting leaderboard for party guests |
| **Transfers** | `/t/{id}` | Vercel KV (Redis) + R2 | Self-destructing file sharing (your own WeTransfer) |
| **CLI** | `pnpm cli` | R2 + KV | Manage albums, photos, transfers, blog files from the terminal |

---

## Code Organization

This repo uses two top-level buckets for server code and shared logic:

- `features/` — product domains (the stuff you build)
  - `features/guests/*` guest model + persistence + CSV import
  - `features/transfers/*` transfer model + persistence + upload pipeline
  - `features/media/*` albums + storage URLs + image processing
  - `features/blog/*` blog reader + blog upload helpers
  - `features/auth/*` server-side auth primitives
- `lib/` — cross-cutting primitives (the toolbox)
  - `lib/platform/*` server-only infrastructure (R2, Redis/KV, logging, safe API errors)
  - `lib/shared/*` safe in both server + client (config, formatting, storage keys)
  - `lib/client/*` browser-only utilities
  - `lib/http/*`, `lib/markdown/*` general helpers

Rule of thumb: if a module describes a domain concept (guest, transfer, album), it belongs in `features/`. If it’s a primitive used across domains (logging, config, fetch retry), it belongs in `lib/`.

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

```bash
pnpm cli transfers upload      # Interactive: pick folder, set title, set expiry
pnpm cli transfers list        # See all active transfers + time remaining
pnpm cli transfers delete <id> # Take down a transfer + delete R2 files
pnpm cli auth revoke --admin-token <jwt> --admin-password <password> --role admin
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

### Blog

Markdown files in `content/posts/`. Filename = slug.

- Frontmatter: title, date, subtitle (optional), image (optional)
- Reading time at 230 WPM
- `#hashtag` styling inline (warm colour shift, no chip)
- Blog file uploads via CLI: images processed to WebP, others uploaded raw

```bash
pnpm cli blog upload --slug <post-slug> --dir <path>   # Upload media for a post
pnpm cli blog list <post-slug>                          # List uploaded files
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
| `CRON_SECRET` | Optional | Secures daily cleanup cron. |

Everything degrades gracefully when env vars are missing — see [resilience table](./docs/architecture.md#resilience-what-happens-when-env-vars-are-missing).

---

## Deployment

1. Push to GitHub
2. Connect to Vercel
3. Add env vars (KV, R2, auth — see table above)
4. Deploy — the cron job (`vercel.json`) activates automatically

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

