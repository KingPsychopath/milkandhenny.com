# Party Guest List Check-in App

A real-time, mobile-first web application for door staff to check in party guests. Built with Next.js, TypeScript, and Vercel KV for shared state across multiple devices.

## Features

- ✅ Real-time check-in/check-out with shared state across devices
- 🔍 Search and filter guests by name, status, or check-in state
- 👥 Manage guest relationships (main guests and +1's)
- 📊 Live statistics showing checked-in counts
- 📱 Mobile-first design with touch-friendly interface
- 📤 CSV import for bulk guest loading
- ➕ Add/remove guests on the fly

## Setup

### Prerequisites

- Node.js 18+ and pnpm
- Vercel account (for production hosting and KV database)

### Local Development (No KV Required)

The app includes **in-memory storage fallback** for local development. You can test everything without setting up Vercel KV:

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev
```

Then open [http://localhost:3000/guestlist](http://localhost:3000/guestlist)

**Note:** In local mode, data is stored in memory and will reset when you restart the server. This is perfect for testing!

### Production Setup (With Vercel KV)

For persistent storage across devices:

1. Go to your Vercel project dashboard
2. Create a new KV database (Storage → Create → KV)
3. Copy the credentials and add to `.env.local`:

```bash
KV_REST_API_URL=your_url_here
KV_REST_API_TOKEN=your_token_here
```

4. Restart the dev server - it will now use Vercel KV

## Usage

### Auto-Loading Guest List (Recommended)

Place your CSV file at `public/guests.csv` and the app will auto-load it on first visit.

### Manual CSV Import

1. Click **Manage** (bottom right)
2. Enter the password: `party2026`
3. Go to **Import CSV** tab
4. Upload your Partiful CSV export

### CSV Format

The app expects Partiful's export format:
- `Name`, `Status`, `RSVP date`, `Did you enter your full name?`, `Is Plus One Of`
- Guest relationships (+1s) are automatically parsed

### Checking In Guests

- Tap the checkbox to check someone in
- Tap the arrow to expand and see their guests (+1s)
- Check-in timestamps are recorded automatically

### Managing Guests (Password Protected)

- Tap **Manage** (bottom right) → Enter password `party2026`
- **Add Guest**: Add new guests or +1s (typeahead search for linking)
- **Remove**: Search and remove guests
- **Import CSV**: Upload new guest lists

### Search and Filters

- Search by name across all guests
- Filter: All, Invites, Guests (+1s), Inside (checked in), Waiting
- Results show match counts

## Deployment

1. Push to GitHub
2. Connect your repository to Vercel
3. Add environment variables in Vercel dashboard:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
4. Deploy and configure your domain (e.g., `milkandhenny.com/guestlist`)

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State Storage**: Vercel KV (Redis) or in-memory fallback
- **CSV Parsing**: PapaParse

## Architecture

- **Polling**: Client-side polling every 2.5 seconds for sync
- **Optimistic Updates**: Instant UI feedback
- **Mobile-First**: Large touch targets, responsive design
- **Password Protected**: Management features behind `party2026`
- **Auto-Bootstrap**: Loads `public/guests.csv` on first visit

## Scalability & cost

### Hosting and routing

| What | Where | Why |
|------|--------|-----|
| **App (HTML/API)** | Vercel | Next.js app, serverless functions, edge. Domain: `milkandhenny.com` (and `www`). |
| **Images (blog, gallery)** | Cloudflare R2 | Stored in R2; served via **custom domain** `pics.milkandhenny.com` through Cloudflare (proxied). |
| **Guest list state** | Vercel KV | Shared check-in state; only needed for `/guestlist` and party flows. |

**Cost-saving routing:** Image requests never hit Vercel. The browser loads thumbnails and full-size images directly from `pics.milkandhenny.com` (R2 + Cloudflare). That keeps bandwidth and function invocations off Vercel and avoids R2 egress fees (Cloudflare custom domain = zero egress). Zip downloads and single-photo downloads also fetch directly from R2 (CORS enabled on the bucket).

**Caching:** `pics.milkandhenny.com` is behind Cloudflare’s CDN (R2 custom domain with proxy on). Images are cached at the edge. The main site is cached by Vercel (static/SSG where used). RSS feed uses `Cache-Control: s-maxage=3600, stale-while-revalidate`.

---

### When does KV run? (limiting usage)

KV is **only** used when these API routes are called. Nothing in the root layout or blog/pics pages touches KV.

| Route | When it runs |
|-------|----------------|
| `/api/guests` | Only when someone is on **`/guestlist`** — the page polls every 2.5s while open. |
| `/api/guests/bootstrap` | Once when `/guestlist` loads (if empty), or when Manage → Import/Clear is used. |
| `/api/guests/add`, `remove`, `import` | Only when someone uses **Manage** on `/guestlist` (password-protected). |
| `/api/best-dressed` | Only when someone visits **`/best-dressed`** or uses best-dressed actions in Manage. |
| `/api/stats` | Not used by the app; only if someone calls it directly (e.g. script or bookmark). |
| `/api/debug` | Only if someone visits the URL directly (for diagnostics). |

**So:** Homepage, blog, `/pics`, `/party` (without opening guestlist or best-dressed) = **no KV calls**. KV runs only on guest list and best-dressed flows.

**How to limit issues:**

- Don’t link to `/api/debug` or `/api/stats` from the site; use them only when debugging.
- If KV usage grows (many devices on guestlist), increase the poll interval in `hooks/useGuests.ts` (e.g. 2.5s → 5s) or only poll when the tab is focused.
- Keep the guest list and best-dressed links only where intended (e.g. party hub); no need to put them on the blog or gallery.

---

### Scalability plan (brief)

1. **Blog / gallery (read-heavy)**  
   - Content is static or SSG; images from R2 + CDN. Scale is largely limited by Cloudflare/Vercel free tiers.
2. **Guest list / party (write + real-time)**  
   - Single Vercel KV store; polling every 2.5s. For many concurrent door devices or very large lists, watch KV read/write usage and consider moving to a dedicated Redis or real-time backend if you outgrow KV.
3. **Images**  
   - Add albums via CLI; metadata in repo (JSON). If the number of albums or JSON size becomes unwieldy, consider moving album index to a small DB or R2-backed manifest; the current design is fine for many albums at personal scale.

---

### Cost appraisal — when to look at what

| Area | Free tier / behaviour | ⚠️ When to worry | What to do |
|------|------------------------|-------------------|------------|
| **Vercel (app)** | Hobby: 100 GB bandwidth, limited serverless invocations & duration. | Bandwidth or invocation limits hit; build minutes exceeded. | Check Vercel dashboard Usage. Upgrade to Pro if I need more bandwidth or higher limits. |
| **Vercel KV** | Free tier has read/write caps. | Many devices polling or lots of guest list updates; KV limits in dashboard. | Reduce poll interval for read-heavy cases, or move to paid KV / external Redis. |
| **Cloudflare R2** | 10 GB storage, 1M Class B (e.g. list) ops/month free. Egress **$0** when using custom domain (Cloudflare proxy). | Storage or Class B ops exceed free tier. | Dashboard: R2 usage. Add more storage/ops or move rarely used albums to cold storage. |
| **Cloudflare (CDN)** | Caching and proxy on `pics.*` are part of normal CF usage. | Only if you get rate limits or abuse alerts (unlikely at personal traffic). | Review CF analytics; adjust cache or security rules if needed. |

**Summary:** For typical personal/blog + occasional party usage, stay on free tiers. Revisit when Vercel or KV usage spikes (e.g. many concurrent users on guest list) or when R2 storage/ops grow past the free bucket limits.

---

### Image CDN security (Cloudflare WAF)

Images are served from `pics.milkandhenny.com` (Cloudflare R2, custom domain, proxied). Every request to this domain counts as an R2 read. To prevent abuse:

**Rate limiting rule (Cloudflare WAF → Rate limiting rules):**

| Setting | Value |
|---------|-------|
| **Match** | URI Path wildcard `/albums/*` |
| **Counting** | Per source IP |
| **Threshold** | 100 requests per 10 seconds |
| **Action** | Block |
| **Block duration** | 10 seconds |

> Free plan limits: 10-second period and 10-second block duration only.

**Why `/albums/*`?**  
All image URLs follow the pattern `pics.milkandhenny.com/albums/{album}/{thumb\|full\|original}/{id}.{ext}`. This single rule covers thumbnails, full-size, and original downloads. Requests to `milkandhenny.com` (Vercel) don't touch R2, so they don't need this protection.

**Worst-case cost with this rate limit in place:**

| Attack scenario | Requests/day (sustained) | R2 cost/month |
|-----------------|--------------------------|---------------|
| 1 IP (script kiddie) | ~432,000 | **~$1** |
| 10 IPs (VPN/proxies) | ~4.3M | **~$43** |
| 50 IPs (dedicated proxies) | ~21.6M | **~$230** |

> Math: 100 req per 10s → blocked 10s → repeat = 100 requests per 20 seconds sustained per IP. R2 Class B reads: 10M free/month, then $0.36/million.

A casual single-IP attacker costs ~$1/month. A serious multi-IP attack is extremely unlikely for a personal site.

**Incident response plan:**

1. **Billing alert triggers** (set Cloudflare billing notification at $5).
2. **Check Security → Events** in Cloudflare dashboard. Filter by "Rate limit" / "Blocked". Identify the offending IPs.
3. **Block specific IPs:** Security → WAF → Custom rules or Tools → IP Access Rules → Block those IPs permanently.
4. **Block a country:** If many IPs come from one country you don't expect traffic from, block the country in WAF.
5. **Enable Under Attack Mode:** Security → Settings → toggle on. Adds a browser challenge (5-second interstitial) that stops bots. Turn off when the attack stops.
6. **Tighten the rate limit:** Lower threshold to 50 requests per 10 seconds temporarily.
7. **Contact Cloudflare support** if the attack persists or is large-scale (DDoS).

> Cloudflare's automatic DDoS protection (included on Free) also helps with volumetric attacks — the rate limit is an additional layer for per-IP abuse.

---

### Best-dressed abuse & protections

| Risk | Mitigation |
|------|------------|
| **Vote stuffing** | Each vote consumes a one-time token (GET issues one, POST consumes it). Someone can still refresh the page and get a new token, so **one device can vote many times**. Acceptable for a low-stakes party; if you need strict one-vote-per-person, you’d add e.g. magic links or a cap per IP/session. |
| **Fake names on leaderboard** | Server now validates that the voted name is in the guest list; arbitrary names are rejected. |
| **Anyone wiping votes** | `DELETE /api/best-dressed` now requires the management password (header `X-Management-Password` or body `{ "password": "..." }`). Only the Manage UI (after unlock) can clear votes. Set `MANAGEMENT_PASSWORD` on Vercel if you use a different server-side secret. |

---

## Customization

### Change the Management Password

Edit `components/guestlist/GuestManagement.tsx`:
```typescript
const MANAGEMENT_PASSWORD = 'your-password-here';
```

### Pre-load Guest List

Copy your Partiful CSV export to `public/guests.csv` before deploying.
