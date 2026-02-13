# Milk & Henny

A personal platform for party check-ins, photo galleries, a blog, and private file sharing — built with Next.js, Cloudflare R2, and Vercel KV.

## Quick Start

```bash
pnpm install
pnpm dev
# → http://localhost:3000
```

No environment variables needed for local dev. Everything falls back to in-memory storage.

For production, set up [environment variables](#environment-variables) and deploy to Vercel.

---

## What's in Here

| Feature | Route | Data source | What it does |
|---------|-------|-------------|-------------|
| **Blog** | `/` | Markdown files (`content/posts/`) | Writing-first blog with warm editorial design |
| **Photo gallery** | `/pics` | JSON manifests (`content/albums/`) + R2 | Album galleries with masonry grid, lightbox, download |
| **Guest list** | `/guestlist` | Vercel KV (Redis) | Real-time check-in for door staff, multi-device sync |
| **Best dressed** | `/best-dressed` | Vercel KV (Redis) | Live voting leaderboard for party guests |
| **Transfers** | `/t/{id}` | Vercel KV (Redis) + R2 | Self-destructing file sharing (your own WeTransfer) |
| **CLI** | `pnpm cli` | R2 + KV | Manage albums, photos, transfers from the terminal |

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
```

### Recovering the admin URL

Run `pnpm cli transfers info <id>` — it shows the full admin URL including the delete token. Recoverable as long as the transfer hasn't expired.

### File type support

| Type | In the gallery | Processing |
|------|---------------|------------|
| Images (JPEG, PNG, WebP, HEIC, TIFF) | Masonry grid + lightbox | Thumb (600px) + full (1600px) + original |
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
- Password-protected management (`party2026`)

### Usage

1. Place your CSV at `public/guests.csv` (auto-loads on first visit), or
2. Click **Manage** → enter password → **Import CSV**

---

## Photo Gallery

Album-based photo galleries served from Cloudflare R2.

- Masonry grid with lazy-loaded thumbnails
- Lightbox with keyboard/swipe navigation
- Individual + batch ZIP download (direct from R2, no Vercel bandwidth)
- Managed via CLI: `pnpm cli albums upload`, `pnpm cli photos add`, etc.

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
| `CRON_SECRET` | Vercel only | Optional | Secures the daily cleanup cron endpoint |

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
| CLI | `tsx` scripts with interactive prompts |

### Hosting & routing

| What | Where | Why |
|------|-------|-----|
| App (HTML, API) | Vercel | Next.js serverless, edge |
| Images & transfer files | Cloudflare R2 | Custom domain `pics.milkandhenny.com` — zero egress |
| Guest list + best dressed + transfer metadata | Vercel KV | Redis with TTL, auto-injected credentials |

**Cost-saving routing:** All image/file requests go directly to `pics.milkandhenny.com` (R2 + Cloudflare CDN). They never touch Vercel — no bandwidth cost, no function invocations. ZIP downloads and individual file downloads also fetch directly from R2 via CORS.

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
| Admin wipe | 4 (DEL votes, SET session, DEL tokens, DEL used-tokens) | Very rare |

**No polling.** Only fires on explicit page loads and votes. 20 voters = ~240 commands.

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

## Cloudflare WAF (Rate Limiting)

Images and transfer files are served from `pics.milkandhenny.com` (R2, custom domain, proxied). Every request counts as an R2 read. Rate limiting prevents abuse.

### Rules to configure

In **Cloudflare Dashboard → Security → WAF → Rate limiting rules**, create two rules:

| Rule | Match | Per IP | Threshold | Action | Duration |
|------|-------|--------|-----------|--------|----------|
| Album images | URI path `/albums/*` | Yes | 100 req / 10s | Block | 10s |
| Transfer files | URI path `/transfers/*` | Yes | 100 req / 10s | Block | 10s |

> Free plan limits: 10-second period and 10-second block duration only.

### Worst-case cost with rate limiting

| Attack scenario | Requests/day (sustained) | R2 cost/month |
|-----------------|--------------------------|---------------|
| 1 IP (script kiddie) | ~432,000 | ~$1 |
| 10 IPs (VPN/proxies) | ~4.3M | ~$43 |
| 50 IPs (dedicated) | ~21.6M | ~$230 |

A casual single-IP attacker costs ~$1/month. A serious multi-IP attack is extremely unlikely for a personal site.

### If something goes wrong

1. Set a **Cloudflare billing alert** at $5
2. Check **Security → Events** — filter by "Rate limit" / "Blocked"
3. **Block IPs**: WAF → Custom rules or IP Access Rules
4. **Block a country** if many IPs originate from one unexpected region
5. **Under Attack Mode**: adds a 5-second browser challenge to stop bots
6. **Tighten rate limit** temporarily (e.g. 50 req / 10s)
7. **Contact Cloudflare** if the attack persists or is DDoS-scale

Cloudflare's automatic DDoS protection (included free) is always active as an additional layer.

---

## R2 Lifecycle Rule (Recommended)

Set up an R2 lifecycle rule to auto-delete transfer objects after 31 days. This is a safety net that catches any files surviving Redis TTL + cron cleanup:

1. **Cloudflare Dashboard → R2 → your bucket → Settings → Object lifecycle rules**
2. Create rule:
   - **Name:** `cleanup-expired-transfers`
   - **Prefix filter:** `transfers/`
   - **Action:** Delete objects after **31 days**
3. Save

The cron job handles 99% of cleanup. This catches edge cases (cron failure, Redis outage).

---

## Transfer Page Caching

Transfer content never changes after upload, so the page is CDN-cached at Vercel's edge via middleware:

- `CDN-Cache-Control: s-maxage=60, stale-while-revalidate=300`
- First visitor → SSR (1 KV GET)
- Next 60s → served from edge cache ($0, 0 KV commands)
- 60s–5min → served stale while revalidating in background
- After takedown → stale page may serve for up to 60s, but R2 files are already deleted

**Cost:** $0. CDN caching is included in Vercel Hobby. This is not browser caching — hard refresh always gets a fresh page.

---

## Cost Summary

| Area | Free tier | When to worry |
|------|-----------|---------------|
| **Vercel (app)** | Hobby: 100 GB bandwidth, limited invocations | Bandwidth or invocation limits hit |
| **Vercel KV** | 3,000 commands/day | Multiple devices on guestlist for hours |
| **Cloudflare R2** | 10 GB storage, 1M Class B ops/month, $0 egress | Storage exceeds 10 GB or ops exceed 1M |
| **Cloudflare CDN** | Included with proxy on `pics.*` | Abuse alerts (unlikely) |
| **Transfer CDN cache** | Included in Vercel Hobby | N/A — reduces KV cost |

**For typical personal use:** everything stays within free tiers. The only real pressure point is guest list polling during long events with multiple devices.

---

## Best-Dressed Protections

| Risk | Mitigation |
|------|------------|
| Vote stuffing | One-time token per vote (GET issues, POST consumes). A device can still refresh for a new token — acceptable for low-stakes party voting. |
| Fake names | Server validates the voted name is in the guest list. Arbitrary names rejected. |
| Anyone wiping votes | `DELETE /api/best-dressed` requires management password. |

---

## Customization

### Management password

Edit `components/guestlist/GuestManagement.tsx`:

```typescript
const MANAGEMENT_PASSWORD = 'your-password-here';
```

Or set `MANAGEMENT_PASSWORD` as a Vercel environment variable.

### Pre-load guest list

Place your Partiful CSV export at `public/guests.csv` before deploying.
