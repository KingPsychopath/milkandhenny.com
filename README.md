# Milk & Henny

A personal platform for party check-ins, photo galleries, a blog, and private file sharing — built with Next.js, Cloudflare R2, and Vercel KV.

## Quick Start

```bash
pnpm install
pnpm dev
# → http://localhost:3000
```

The blog, guest list, and best-dressed work with zero config (in-memory fallback). Photo galleries and transfers need env vars — see [environment variables](#environment-variables).

---

## What's in Here

| Feature | Route | Data source | What it does |
|---------|-------|-------------|-------------|
| **Blog** | `/` | Markdown files (`content/posts/`) | Writing-first blog with warm editorial design |
| **Photo gallery** | `/pics` | JSON manifests (`content/albums/`) + R2 | Album galleries with masonry grid, lightbox, download |
| **Guest list** | `/guestlist` | Vercel KV (Redis) | Real-time check-in for door staff, multi-device sync |
| **Best dressed** | `/best-dressed` | Vercel KV (Redis) | Live voting leaderboard for party guests |
| **Transfers** | `/t/{id}` | Vercel KV (Redis) + R2 | Self-destructing file sharing (your own WeTransfer) |
| **CLI** | `pnpm cli` | R2 + KV | Manage albums, photos, transfers, blog files from the terminal |

---

## Private Transfers

Self-destructing file sharing — a personal WeTransfer/MASV alternative at zero cost.

### How it works

1. **Upload** any files via CLI → images, videos, GIFs, PDFs, zips — anything
2. **Get a link** at `/t/{id}` that self-destructs after the expiry window
3. **Share the link** — recipients can preview, play, and download (individual or batch zip)
4. **Take down** from the browser (admin URL with token) or via CLI at any time

### CLI commands

```bash
pnpm cli transfers upload      # Interactive: pick folder, set title, set expiry
pnpm cli transfers list        # See all active transfers + time remaining
pnpm cli transfers info <id>   # Full details + share URL + admin URL (token recovery)
pnpm cli transfers delete <id> # Take down a transfer + delete R2 files
pnpm cli transfers nuke        # Wipe ALL transfers (R2 + Redis) — nuclear option
```

### Recovering the admin URL

Run `pnpm cli transfers info <id>` — it shows the full admin URL including the delete token. Recoverable as long as the transfer hasn't expired.

### File type support

| Type | In the gallery | Processing |
|------|---------------|------------|
| Images (JPEG, PNG, WebP, HEIC, HIF, TIFF) | Masonry grid + lightbox | Thumb (600px) + full (1600px) + original + og (1200×630 with face detection + text overlay). HEIC/HIF decode via Sharp (libheif) or, on macOS, fallback to system `sips` so uploads never fail. |
| GIFs | Grid card + animated lightbox | Static first-frame thumb + original |
| Videos (MP4, MOV, WebM, AVI, MKV) | Play icon card + video player lightbox | Uploaded as-is |
| Audio (MP3, WAV, FLAC, etc.) | Inline audio player card | Uploaded as-is |
| Documents / archives / everything else | File card + download button | Uploaded as-is |

### Security

- **Unguessable URLs**: 11-char base64url IDs (8 bytes entropy)
- **Delete tokens**: 22-char base64url (16 bytes), never exposed to recipients
- **Admin-only takedown**: only the uploader can delete (CLI or admin URL)
- **No indexing**: `robots: noindex, nofollow` on all transfer pages
- **Auto-expiry**: Redis TTL + server-side check + daily cron R2 cleanup
- **CDN caching**: Vercel edge caches transfer pages for 60s (zero KV cost on repeat visits)

---

## Guest List

Real-time check-in system for door staff at events.

- Tap to check in/out guests with optimistic UI
- Multi-device sync via polling (5s active, 30s when tab is backgrounded)
- CSV import from Partiful exports
- Search, filter, +1 relationships
- **Two gates (both in env, never in client bundle):**
  - **Staff PIN** (`STAFF_PIN`) — who can open the guestlist page. Verified by `POST /api/guests/verify-staff-pin`.
  - **Management password** (`MANAGEMENT_PASSWORD`) — who can use Manage (add/remove/import, wipe best-dressed). Verified by `POST /api/guests/verify-management`.

### Usage

1. Place your CSV at `public/guests.csv` (auto-loads on first visit), or
2. Click **Manage** → enter password → **Import CSV**

---

## Photo Gallery

Album-based photo galleries served from Cloudflare R2.

- Masonry grid with lazy-loaded thumbnails
- Lightbox with keyboard/swipe navigation
- Individual + batch ZIP download (direct from R2, no Vercel bandwidth)
- **Blog embed cards**: standalone album links in blog posts (`[Title](/pics/slug)` on its own line) render as preview cards. Two variants: **compact** (4-thumb strip, default) and **masonry** (Pinterest-style flowing tiles, up to 6 photos). Use `[Title](/pics/slug#masonry)` for masonry. Inline mentions stay as normal links.
- Managed via CLI: `pnpm cli albums upload`, `pnpm cli photos add`, `pnpm cli albums backfill-og`, `pnpm cli photos set-focal`, etc.

> **Staleness note**: Album embed cards in blog posts are resolved at build time (SSG). If you update an album (change cover, add photos) after the blog was deployed, the embed card shows stale data until the next `git commit` + Vercel rebuild. This is consistent with how all album data works — JSON manifests live in git, so any album change already requires a redeploy.

### OG images at scale

Album and photo pages have Open Graph images for social sharing. Source images are pre-processed to **1200×630 JPG** (og variant) with a **text overlay** (album title, photo ID, brand) burned in via SVG compositing, then stored in R2 at `albums/{slug}/og/{photoId}.jpg`. The `opengraph-image.tsx` routes fetch and serve these pre-built JPGs directly — no `ImageResponse`, no runtime PNG generation.

**Pipeline (upload → OG):**

1. **Face detection** — ONNX UltraFace (or Sharp saliency) finds faces, computes area-weighted centroid
2. **Crop** — Sharp crops the original to 1200×630, anchored on the detected focal point
3. **Text overlay** — SVG with gradient + brand text composited onto the cropped image
4. **Compress** — JPEG quality 70 with mozjpeg (~80–150 KB per image)
5. **Upload** — Stored in R2 at `albums/{slug}/og/{photoId}.jpg`

**Flow:**

- **New uploads:** `pnpm cli albums upload` and `photos add` automatically run face detection and create thumb, full, original, and og variants.
- **Existing albums:** Run backfill once: `pnpm cli albums backfill-og` (or `--yes` to skip confirmation).

```bash
pnpm cli albums backfill-og --yes   # Run before first deploy after adding OG support
```

Backfill skips photos that already have og variants. Use `--force` to regenerate all.

**Vercel hobby limits:** OG images are pre-built JPGs served from R2 — zero runtime serverless invocations, no `ImageResponse` overhead. Build time fetches the og URL per album/photo page (one R2 GET each), but that's a one-time cost per deploy.

**Focal points & face detection:** OG images crop to 1200×630. By default, every photo is run through **automatic face detection** during upload — the detected focal point is stored as `autoFocal` in the album JSON and used for cropping. For group photos, the focal point is the **area-weighted centroid** of all detected faces, so the crop naturally centers on the group while biasing toward whoever is closest to the camera.

Two detection strategies are available (swappable via CLI):

| Strategy | How it works | Best for |
|----------|-------------|----------|
| `onnx` (default) | UltraFace 320 neural network via ONNX Runtime (~1.2 MB model). True face detection with bounding boxes. | Portraits, group photos — any image with faces |
| `sharp` | Sharp's attention-based saliency (libvips). Detects skin tones, luminance, saturation. No ML model. | Scenes without faces, food, architecture |

You can also **manually override** with a preset — manual always takes priority over auto-detected:

```bash
pnpm cli photos set-focal <album> <photoId> --preset t    # manual override: "top"
pnpm cli photos set-focal <album> <photoId> --preset c    # reset to "center"
```

**Presets** (full name or shorthand):

| Shorthand | Full name | Position (x%, y%) | When to use |
|-----------|-----------|-------------------|-------------|
| `c` | `center` | 50, 50 | Default — most landscape shots |
| `t` | `top` | 50, 0 | Face at top edge |
| `b` | `bottom` | 50, 100 | Subject at bottom of frame |
| `l` | `left` | 0, 50 | Subject at left edge |
| `r` | `right` | 100, 50 | Subject at right edge |
| `tl` | `top left` | 0, 0 | Subject in top-left corner |
| `tr` | `top right` | 100, 0 | Subject in top-right corner |
| `bl` | `bottom left` | 0, 100 | Subject in bottom-left corner |
| `br` | `bottom right` | 100, 100 | Subject in bottom-right corner |
| `mt` | `mid top` | 50, 25 | Between top and center — upper third |
| `mb` | `mid bottom` | 50, 75 | Between bottom and center — lower third |
| `ml` | `mid left` | 25, 50 | Between left and center — left third |
| `mr` | `mid right` | 75, 50 | Between right and center — right third |

**Focal point priority:** manual preset (`focalPoint`) > auto-detected (`autoFocal`) > center (50%, 50%).

**Reset & re-detect faces:**

```bash
pnpm cli photos reset-focal <album> [photoId]              # Clear manual, re-detect, regen OG
pnpm cli photos reset-focal <album> --strategy sharp        # Use sharp saliency instead of onnx
pnpm cli photos compare-focal <album> <photoId>             # Run both strategies, compare results
```

**Batch regen all OG images:**

```bash
pnpm cli albums backfill-og --yes --force                   # Regen all with default (onnx) strategy
pnpm cli albums backfill-og --yes --force --strategy sharp  # Regen all with sharp strategy
```

All of the above are also available in the **interactive CLI** (`pnpm cli` → Photos / Albums).

**What happens when you set a focal point:**
1. Updates `focalPoint` (manual) or `autoFocal` (detected) in the album JSON (`content/albums/{slug}.json`)
2. Downloads the original from R2, re-crops to 1200×630 using the resolved position, uploads the new og variant
3. Album embed thumbnails in blog posts use the focal point as CSS `object-position`

**When to manually override:** Only when auto-detection gets it wrong. Most photos with faces won't need it. Use `photos list <album>` to see focal points (manual and auto) for each photo.

**Validate album JSON (CI / hand-edits):** Run `pnpm cli albums validate` to check that every album has valid `focalPoint` presets and `autoFocal` values (x, y in 0–100). Exits with code 1 if any errors are found. Add to CI to catch invalid hand-edits:

```bash
pnpm cli albums validate   # Use in CI: fails the build if album JSON is invalid
```

### How album data works (vs transfers)

Albums and transfers store metadata differently — each approach fits its use case:

| | Albums | Transfers |
|---|--------|-----------|
| **Manifest** | JSON file in git (`content/albums/{slug}.json`) | Redis key (`transfer:{id}`) with TTL |
| **Deployed with app** | Yes — committed, built at deploy | No — CLI writes directly to Redis |
| **Cost per page view** | **$0** (static/ISR, CDN-cached) | **~$0** (1 KV GET, but CDN-cached for 60s) |
| **Persistence** | Permanent (lives in git) | Ephemeral (auto-expires via Redis TTL) |
| **Update flow** | CLI writes JSON → git commit → Vercel rebuilds | CLI writes to Redis → instant |
| **Scalability** | Infinite reads (fully static) | Limited by KV tier (mitigated by CDN cache) |
| **Right for** | Permanent public galleries | Temporary private sharing |

Albums are the strongest pattern for permanent content — zero runtime cost, fully CDN-cached, no KV dependency. Transfers use KV because they need to self-destruct, and a git-based approach would require a redeploy to expire content.

### Blog files

Media for blog posts is stored in R2 under `blog/{post-slug}/` and referenced directly in markdown. No manifest, no metadata store — the markdown file **is** the source of truth.

- **Images**: processed to WebP (max 1600px), rendered inline with captions
- **Videos, GIFs, audio, PDFs, zips, etc.**: uploaded as-is, rendered as download links

**Workflow:**

1. `pnpm cli blog upload --slug my-first-birthday --dir ~/Desktop/blog-photos`
2. CLI processes images (WebP) and uploads other files raw
3. Prints ready-to-paste markdown snippets: `![caption](blog/slug/image.webp)` for images, `[label](blog/slug/file.pdf)` for downloads
4. Paste into your `.md` file — the `img` component resolves R2 paths automatically

**CLI commands:**

```bash
pnpm cli blog upload --slug <post-slug> --dir <path>   # Upload files (images → WebP, others raw)
pnpm cli blog list <post-slug>                          # List uploaded files + markdown snippets
pnpm cli blog delete <post-slug>                        # Delete ALL files for a post
pnpm cli blog delete <post-slug> --file <filename>      # Delete a single file
```

**How it differs from albums and transfers:**

| | Albums | Transfers | Blog files |
|---|--------|-----------|-------------|
| **R2 prefix** | `albums/{slug}/` | `transfers/{id}/` | `blog/{slug}/` |
| **Metadata** | JSON manifest in git | Redis with TTL | None (markdown is the manifest) |
| **Variants** | thumb + full + original + og | thumb + full + original | Images: WebP; others: raw |
| **Lifecycle** | Permanent | Auto-expires | Permanent (delete via CLI) |
| **Cost per view** | $0 (static/CDN) | ~$0 (1 KV GET, CDN-cached) | $0 (static/CDN) |

---

## Environment Variables

| Variable | Where needed | Required | Notes |
|----------|-------------|----------|-------|
| `KV_REST_API_URL` | Vercel + local | Yes (for persistence) | Vercel KV / Upstash Redis REST URL |
| `KV_REST_API_TOKEN` | Vercel + local | Yes (for persistence) | Vercel KV / Upstash Redis REST token |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | Vercel + local | Yes (images/files) | e.g. `https://pics.milkandhenny.com` |
| `R2_ACCOUNT_ID` | Local only | CLI + cron | Cloudflare account ID |
| `R2_ACCESS_KEY` | Local only | CLI + cron | R2 API token access key |
| `R2_SECRET_KEY` | Local only | CLI + cron | R2 API token secret key |
| `R2_BUCKET` | Local only | CLI + cron | R2 bucket name |
| `NEXT_PUBLIC_BASE_URL` | Local only | CLI only | For generating share URLs. **Not needed on Vercel.** |
| `STAFF_PIN` | Vercel + local | Yes (for guestlist) | PIN to open the guestlist page (door staff). Not in client bundle. |
| `MANAGEMENT_PASSWORD` | Vercel + local | Yes (for Manage UI) | Unlocks Manage (add/remove/import, best-dressed wipe). Not in client bundle. |
| `CRON_SECRET` | Vercel only | Optional | Secures the daily cleanup cron. Generate with `openssl rand -hex 32` or Bitwarden; store in Bitwarden, paste into Vercel. |

Vercel auto-injects `KV_URL`, `REDIS_URL`, `KV_REST_API_READ_ONLY_TOKEN` from its KV integration — our code doesn't use these. Safe to leave.

---

## Deployment

1. Push to GitHub
2. Connect to Vercel
3. Add env vars: `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `NEXT_PUBLIC_R2_PUBLIC_URL`
4. Deploy — the cron job (`vercel.json`) activates automatically

---

## Architecture

### Tech stack

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

### Hosting & routing

| What | Where | Why |
|------|-------|-----|
| App (HTML, API) | Vercel | Next.js serverless, edge |
| Images & transfer files | Cloudflare R2 | Custom domain `pics.milkandhenny.com` — zero egress |
| Guest list + best dressed + transfer metadata | Vercel KV | Redis with TTL, auto-injected credentials |

**Cost-saving routing:** All image/file requests go directly to `pics.milkandhenny.com` (R2 + Cloudflare CDN). They never touch Vercel — no bandwidth cost, no function invocations. ZIP downloads and individual file downloads also fetch directly from R2 via CORS.

### Resilience: what happens when env vars are missing

Every feature degrades gracefully — nothing crashes. The fallback strategy matches the context: local dev features get in-memory fallback, production-only features fail explicitly.

| Feature | Missing KV vars | Missing R2 API vars | Missing `NEXT_PUBLIC_R2_PUBLIC_URL` |
|---------|----------------|---------------------|--------------------------------------|
| **Blog** (`/`) | No impact (reads markdown from git) | No impact | No impact |
| **Photo gallery** (`/pics`) | No impact (reads JSON manifests from git) | No impact (images served via CDN, not API) | Images break — URLs resolve to `/{path}` instead of the CDN domain |
| **Guest list** (`/guestlist`) | In-memory fallback — works per process. Data doesn't persist across serverless cold starts. Fine for local dev. | No impact | No impact |
| **Best dressed** (`/best-dressed`) | In-memory fallback — same as guest list | No impact | No impact |
| **Transfer page** (`/t/{id}`) | `getTransfer()` returns null → shows "expired" page. No crash. | No impact (files served via CDN) | File URLs break — same as pics |
| **Transfer CLI** (`pnpm cli transfers *`) | `requireRedis()` throws with a clear error. **No silent fallback.** | `requireR2()` throws with a clear error | Share URL defaults to `https://milkandhenny.com` — no crash |
| **Album CLI** (`pnpm cli albums *`) | No impact (albums use JSON manifests) | Throws — can't upload without R2 | No impact on CLI |
| **Blog CLI** (`pnpm cli blog *`) | No impact (blog files don't use KV) | `requireR2()` throws with a clear error | Images/files in posts break — URLs resolve to `/{path}` |
| **Cron cleanup** | Returns `{ skipped: true }` — no crash | Returns `{ skipped: true }` | No impact |
| **`STAFF_PIN`** missing | — | — | Guest list page is accessible without a PIN (open gate) |
| **`MANAGEMENT_PASSWORD`** missing | — | — | Management UI rejects all passwords (locked out) |

**Design rationale:** Guest list and best-dressed use in-memory fallback because they're the most common local dev surfaces — you should be able to `pnpm dev` and test the UI immediately. Transfer CLI refuses to run without Redis because silent fallback caused real data loss (uploads to R2 with no metadata). The separation is intentional.

---

## KV Command Budget

**Vercel KV free tier: 3,000 commands/day.**

### Per-feature breakdown

#### Guest list (`/guestlist`)

| Action | KV commands | Frequency |
|--------|-------------|-----------|
| Page poll (focused tab) | 1 GET | Every 5s while tab open |
| Page poll (background tab) | 1 GET | Every 30s while tab hidden |
| Check-in/out | 3 (GET + update + SET) | Per tap |
| Bootstrap (first load) | 1 GET, then 1 SET if empty | Once |
| Manage → Add guest | 2 (GET + SET) | Manual |
| Manage → Remove guest | 2 (GET + SET) | Manual |
| Manage → Import CSV | 1 SET | Manual |

**Steady state (1 tab, focused):** ~720 commands/hr. **Backgrounded:** ~120 commands/hr.

> Previously polled at 2.5s (~1,440/hr). Now uses the Page Visibility API: 5s when focused, 30s when backgrounded. This halves active cost and drops background cost by 12x.

#### Best dressed (`/best-dressed`)

| Action | KV commands | Frequency |
|--------|-------------|-----------|
| Page load / refresh | 4 (GET votes, GET guests, GET session, SADD token) | Per view |
| Submit vote (happy path) | 6 (GET guests, SISMEMBER ×2, SREM + SADD, GET+SET votes, GET session) | Per vote |
| Leaderboard poll (after voting) | 4 (same as page load) | Every 30s, only when tab visible |
| Admin wipe | 4 (DEL votes, SET session, DEL tokens, DEL used-tokens) | Very rare |

**Light polling.** After voting, leaderboard updates every 30s and only when the tab is focused (visibility API). 20 voters with one tab open ≈ 1 load + 1 vote + ~8 polls in 4 min ≈ 40 commands per voter; no polling when tab is backgrounded.

#### Transfers (`/t/{id}`)

| Action | KV commands | Frequency |
|--------|-------------|-----------|
| Page view (cache miss) | 1 GET | First view per 60s window |
| Page view (CDN cache hit) | **0** | Repeat views within 60s |
| Upload (CLI) | 2 (SET + SADD) | Per upload |
| List (CLI) | 1 + N (SMEMBERS + pipelined GETs) | On demand |
| Info (CLI) | 1 GET | On demand |
| Delete (CLI/browser) | ~3 (GET + DEL + SREM) | On demand |
| Cron cleanup | 1 + N (SMEMBERS + pipelined EXISTS) | Daily |

**CDN-cached.** Middleware adds `CDN-Cache-Control: s-maxage=60, stale-while-revalidate=300` so Vercel's edge serves repeat visits for free. Transfer content never changes after upload.

#### Other endpoints

| Endpoint | KV commands | Trigger |
|----------|-------------|---------|
| `GET /api/stats` | 1 GET | Manual URL visit only |
| `GET /api/debug` | 1 GET | Manual URL visit only |

### Typical daily budget

| Scenario | Est. commands | % of 3,000 |
|----------|---------------|-----------|
| Guest list: 1 tab, 2 hrs focused + 6 hrs background | ~2,160 | 72% |
| Best dressed: 20 voters | ~240 | 8% |
| Transfers: 10 page views, 2 uploads | ~14 | 0.5% |
| Cron cleanup | ~10 | 0.3% |
| **Total** | **~2,424** | **81%** |

**Safe on free tier** for typical party + private sharing usage. The guest list poll is the biggest consumer. If multiple devices are on guestlist simultaneously, each adds ~720/hr focused.

---

## Cost & Limits

| Area | Free tier | When to worry |
|------|-----------|---------------|
| **Vercel (app)** | Hobby: 100 GB bandwidth, limited invocations | Bandwidth or invocation limits hit |
| **Vercel KV** | 3,000 commands/day | Multiple devices on guestlist for hours |
| **Cloudflare R2** | 10 GB storage, 1M Class B ops/month, $0 egress | Storage exceeds 10 GB or ops exceed 1M |
| **Cloudflare CDN** | Included with proxy on `pics.*` | Abuse alerts (unlikely) |
| **Transfer CDN cache** | Included in Vercel Hobby | N/A — reduces KV cost |

**For typical personal use:** everything stays within free tiers. The only real pressure point is guest list polling during long events with multiple devices.

### Transfer page caching

Transfer content never changes after upload, so the page is CDN-cached at Vercel's edge via middleware:

- `CDN-Cache-Control: s-maxage=60, stale-while-revalidate=300`
- First visitor → SSR (1 KV GET)
- Next 60s → served from edge cache ($0, 0 KV commands)
- 60s–5min → served stale while revalidating in background
- After takedown → stale page may serve for up to 60s, but R2 files are already deleted

Cost: $0 — CDN caching is included in Vercel Hobby.

### R2 lifecycle rule (recommended)

A safety net that catches any transfer files surviving Redis TTL + cron cleanup:

1. **Cloudflare Dashboard → R2 → your bucket → Settings → Object lifecycle rules**
2. Create rule: name `cleanup-expired-transfers`, prefix `transfers/`, delete after **31 days**
3. Save

The cron job handles 99% of cleanup. This catches edge cases (cron failure, Redis outage).

---

## Security

### Authentication

| Gate | Env var | Protects | Verified by |
|------|---------|----------|-------------|
| Staff PIN | `STAFF_PIN` | Guest list page access (door staff) | `POST /api/guests/verify-staff-pin` |
| Management password | `MANAGEMENT_PASSWORD` | Manage (add/remove/import, wipe best-dressed) | `POST /api/guests/verify-management` |

Both are env vars, never in the client bundle. Set in Vercel and `.env.local`.

### Best-dressed protections

| Risk | Mitigation |
|------|------------|
| Vote stuffing | One-time token per vote (GET issues, POST consumes). A device can still refresh for a new token — acceptable for low-stakes party voting. |
| Fake names | Server validates the voted name is in the guest list. Arbitrary names rejected. |
| Anyone wiping votes | `DELETE /api/best-dressed` requires management password. |

### Cloudflare WAF (rate limiting)

Images and transfer files are served from `pics.milkandhenny.com` (R2 custom domain). Every request counts as an R2 read. Rate limiting prevents abuse.

In **Cloudflare Dashboard → Security → WAF → Rate limiting rules**, create two rules:

| Rule | Match | Per IP | Threshold | Action | Duration |
|------|-------|--------|-----------|--------|----------|
| Album images | URI path `/albums/*` | Yes | 100 req / 10s | Block | 10s |
| Transfer files | URI path `/transfers/*` | Yes | 100 req / 10s | Block | 10s |

> Free plan limits: 10-second period and 10-second block duration only.

**Worst-case cost with rate limiting:**

| Attack scenario | Requests/day (sustained) | R2 cost/month |
|-----------------|--------------------------|---------------|
| 1 IP (script kiddie) | ~432,000 | ~$1 |
| 10 IPs (VPN/proxies) | ~4.3M | ~$43 |

A casual single-IP attacker costs ~$1/month. A serious multi-IP attack is extremely unlikely for a personal site. Cloudflare's automatic DDoS protection (included free) is always active.

**If under attack:** set a Cloudflare billing alert at $5, check Security → Events, block IPs via WAF Custom Rules, enable Under Attack Mode if needed, tighten rate limits temporarily.

### Pre-load guest list

Place your Partiful CSV export at `public/guests.csv` before deploying.

---

## Incident Response & Key Rotation

The app is designed for easy key rotation — every secret is an environment variable, nothing is hardcoded, and no secret is baked into the client bundle. Rotation never requires a code change.

### Rotation procedures

#### R2 credentials leaked (`R2_ACCESS_KEY` / `R2_SECRET_KEY`)

These are the highest-impact credentials — they grant read/write/delete access to your entire R2 bucket.

1. **Cloudflare Dashboard → R2 → Manage R2 API Tokens**
2. **Revoke** the compromised token immediately
3. **Create a new token** with the same permissions (Object Read & Write on your bucket)
4. Copy the new Access Key ID and Secret Access Key
5. **Update `.env.local`** with the new values
6. **Update Vercel env vars** (Settings → Environment Variables) — only needed if the cron job uses R2 (it does)
7. **Redeploy** on Vercel (Settings → Deployments → Redeploy) so the cron picks up the new token
8. Test: `pnpm cli bucket ls` — should return bucket contents

**Downtime:** Zero for the public site (images are served via Cloudflare CDN, not through Vercel). CLI operations will fail between steps 2 and 5. The cron cleanup will fail until Vercel redeploys with new vars.

#### KV / Redis credentials leaked (`KV_REST_API_URL` / `KV_REST_API_TOKEN`)

1. **Upstash Console → your database → REST API section → Reset token** (or rotate via Vercel Dashboard → Storage → KV → Settings)
2. Copy the new URL and token
3. **Update `.env.local`**
4. **Update Vercel env vars** (if you set them manually; Vercel KV auto-updates if you rotate from Vercel Dashboard)
5. **Redeploy** on Vercel
6. Test: `pnpm cli transfers list` — should connect successfully

**Downtime:** Guest list polling and transfer page views will return errors between rotation and redeploy (~30 seconds if you're quick). Existing CDN-cached transfer pages will keep serving for up to 60 seconds.

**Data at risk:** Someone with your KV token can read/write guest names, votes, and transfer metadata (not the files themselves — those are in R2). They cannot access R2 files via KV.

#### Management password or Staff PIN leaked

1. **Update Vercel env vars** → `MANAGEMENT_PASSWORD` and/or `STAFF_PIN`
2. **Redeploy** on Vercel
3. Update `.env.local` for local dev
4. Existing authenticated sessions (in `sessionStorage`) remain valid until the browser tab closes — this is acceptable since the new password takes effect immediately for new logins

**Downtime:** None. Instant rotation on redeploy.

#### CRON_SECRET leaked

1. Generate a new one: `openssl rand -hex 32`
2. **Update Vercel env var** → `CRON_SECRET`
3. **Redeploy**

**Downtime:** None. The cron job runs once daily; the next invocation will use the new secret.

### Quick-reference: where each secret lives

| Secret | `.env.local` | Vercel env vars | Cloudflare | Upstash |
|--------|:---:|:---:|:---:|:---:|
| `R2_ACCESS_KEY` / `R2_SECRET_KEY` | Yes | Only if cron needs R2 | Source of truth | — |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Yes | Auto-injected by Vercel KV | — | Source of truth |
| `STAFF_PIN` | Yes | Yes | — | — |
| `MANAGEMENT_PASSWORD` | Yes | Yes | — | — |
| `CRON_SECRET` | No | Yes | — | — |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | Yes | Yes | — | — |
| `NEXT_PUBLIC_BASE_URL` | Yes (CLI only) | No | — | — |

### General incident checklist

1. **Identify** which credential was exposed and where (chat log, commit history, screenshot, etc.)
2. **Revoke/rotate** at the source immediately (Cloudflare, Upstash, or Vercel)
3. **Update** `.env.local` + Vercel env vars with the new values
4. **Redeploy** on Vercel to pick up the new vars
5. **Verify** with a quick CLI or browser test
6. **Audit** Cloudflare Analytics and Upstash Monitor for suspicious activity during the exposure window
7. **Document** what happened for future reference

### What makes this app rotation-friendly

- **No secrets in code.** Every credential is an env var — rotation is config-only, never a code change.
- **No secrets in the client bundle.** `STAFF_PIN`, `MANAGEMENT_PASSWORD`, and all API keys are server-side only. `NEXT_PUBLIC_*` vars contain only public URLs (the R2 CDN domain and the base URL), not secrets.
- **No long-lived sessions.** Guest list auth uses `sessionStorage` (dies with the tab). No JWTs or cookies that would need invalidation.
- **Layered storage.** R2 credentials and KV credentials are independent — leaking one doesn't compromise the other.
- **CDN buffer.** Transfer pages and images are cached at Cloudflare/Vercel edge. Even during a brief rotation window, cached content continues serving.
