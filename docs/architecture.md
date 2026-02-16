# Architecture

How the app is built, where things run, how data flows, and the conventions that hold it together.

---

## Hosting & Routing

| What | Where | Why |
|------|-------|-----|
| App (HTML, API) | Vercel | Next.js serverless, edge |
| Images & transfer files | Cloudflare R2 | Custom domain `pics.milkandhenny.com` — zero egress |
| Guest list + best dressed + transfer metadata | Vercel KV | Redis with TTL, auto-injected credentials |

**Cost-saving routing:** All image/file requests go directly to `pics.milkandhenny.com` (R2 + Cloudflare CDN). They never touch Vercel — no bandwidth cost, no function invocations. ZIP downloads and individual file downloads also fetch directly from R2 via CORS.

---

## Data Storage Patterns

Three features store media in R2, but their metadata lives in different places — each approach fits its use case.

| | Albums | Transfers | Blog files |
|---|--------|-----------|-------------|
| **R2 prefix** | `albums/{slug}/` | `transfers/{id}/` | `blog/{slug}/` |
| **Metadata** | JSON manifest in git (`content/albums/`) | Redis key with TTL | None (markdown is the manifest) |
| **Variants** | thumb + full + original + og | thumb + full + original | Images: WebP; others: raw |
| **Lifecycle** | Permanent (lives in git) | Auto-expires via Redis TTL | Permanent (delete via CLI) |
| **Cost per view** | $0 (fully static/CDN) | ~$0 (1 KV GET, CDN-cached 60s) | $0 (fully static/CDN) |
| **Update flow** | CLI writes JSON → git commit → Vercel rebuild | CLI writes to Redis → instant | CLI uploads to R2, paste markdown |

Albums are the strongest pattern for permanent content — zero runtime cost, fully CDN-cached, no KV dependency. Transfers use KV because they need to self-destruct (a git-based approach would require a redeploy to expire content). Blog files have no metadata store at all — the markdown file is the source of truth.

---

## Caching Strategy

Three layers of caching keep the site fast and cheap: static generation at build, CDN edge caching at runtime, and Cloudflare CDN for media.

### Static pages (built once, served from CDN)

| Page | How | Why static works |
|------|-----|-----------------|
| `/`, `/blog`, `/pics` | Rendered at build from local markdown/JSON | Content only changes on deploy |
| `/blog/[slug]` | `generateStaticParams` from all slugs | Posts are markdown files in git |
| `/pics/[album]`, `/pics/[album]/[photo]` | `generateStaticParams` from album JSON | Albums are JSON manifests in git |
| All OG images for above | `generateStaticParams` + `s-maxage=86400` | Images don't change post-deploy |

### Dynamic pages (server-rendered with CDN edge cache)

| Page | Rendering | Cache | Rationale |
|------|-----------|-------|-----------|
| `/t/[id]` (transfers) | `force-dynamic` (reads Redis) | CDN: 60s, stale-while-revalidate: 5min. Browser: no-cache. | Saves KV reads. After takedown, stale may serve up to 60s but R2 files are already deleted. |
| `/t/[id]/opengraph-image` | `force-dynamic` | 24h (`s-maxage=86400`) | One serverless run per new shared link, then cached. |
| `/api/cron/cleanup-transfers` | `force-dynamic` | None | Daily cron, no caching needed. |

### API routes

All API routes (`/api/guests`, `/api/best-dressed`, `/api/transfers/[id]`) return real-time data. No caching — stale data here would cause UX bugs (wrong check-in state, stale votes).

### RSS feed

`s-maxage=3600, stale-while-revalidate=3600` — CDN caches 1 hour. Blog only changes on deploy, so aggressive caching is safe.

### Media (Cloudflare R2 + CDN)

Images and transfer files are served from `pics.milkandhenny.com` (R2 custom domain). Cloudflare's CDN caches static assets by default. Rate limiting is configured at the Cloudflare level (see [cloudflare-rate-limit-images.md](./cloudflare-rate-limit-images.md)). These requests never touch Vercel.

### Transfer page CDN caching (proxy.ts)

`proxy.ts` adds CDN edge headers to `/t/*` routes:

- **CDN edge**: 60s cache, stale up to 5min while revalidating
- **Browser**: `no-cache` — countdown timer needs fresh data on hard refresh
- **Trade-off**: After takedown, CDN may serve stale page for up to 60s. R2 files are deleted immediately, so downloads 404. Acceptable for a private sharing tool.

### Client-side fetch caching

`fetchImageForCanvas` in `lib/media/download.ts` uses `cache: "no-store"` to bypass the browser cache. This prevents the tainted canvas problem where a non-CORS cached response would block Canvas pixel access.

---

## Resilience: What Happens When Env Vars Are Missing

Every feature degrades gracefully — nothing crashes. The fallback strategy matches the context: local dev features get in-memory fallback, production-only features fail explicitly.

| Feature | Missing KV vars | Missing R2 API vars | Missing `NEXT_PUBLIC_R2_PUBLIC_URL` |
|---------|----------------|---------------------|--------------------------------------|
| **Blog** (`/`) | No impact | No impact | No impact |
| **Photo gallery** (`/pics`) | No impact | No impact | Images break — URLs resolve to `/{path}` |
| **Guest list** (`/guestlist`) | In-memory fallback — works per process, doesn't persist across cold starts | No impact | No impact |
| **Best dressed** (`/best-dressed`) | In-memory fallback — same as guest list | No impact | No impact |
| **Admin dashboard** (`/admin`) | Rejects auth (fails closed; requires KV for rate limiting + revocation) | No impact | No impact |
| **Transfer page** (`/t/{id}`) | Shows "expired" page (no crash) | No impact (files via CDN) | File URLs break |
| **Transfer CLI** | `requireRedis()` throws — no silent fallback | `requireR2()` throws | Share URL defaults to `https://milkandhenny.com` |
| **Album CLI** | No impact | Throws — can't upload without R2 | No impact |
| **Blog CLI** | No impact | `requireR2()` throws | Images in posts break |
| **Cron cleanup** | Returns `{ skipped: true }` | Returns `{ skipped: true }` | No impact |
| **`STAFF_PIN`** missing | — | — | Guest list accessible without PIN (open gate) |
| **`ADMIN_PASSWORD`** missing | — | — | Admin-only surfaces reject auth (locked out) |
| **`UPLOAD_PIN`** missing | — | — | Upload page rejects all PINs (locked out) |

**Design rationale:** Guest list and best-dressed use in-memory fallback because they're the most common local dev surfaces — `pnpm dev` should work immediately. Transfer CLI refuses to run without Redis because silent fallback caused real data loss (uploads to R2 with no metadata). The separation is intentional.

---

## Navigation & Footer Design

The site has **two distinct navigation worlds** that coexist through shared tone (lowercase, warm, honest) while differing in visual language.

### Two-world model

| World | Pages | Navigation style | Audience |
|-------|-------|-----------------|----------|
| **Editorial** | `/`, `/blog`, `/blog/[slug]`, `/pics`, `/pics/[album]`, `/pics/[album]/[photo]` | Header with `← contextual back` + `milk & henny` brand link + Breadcrumbs | Blog readers, photo viewers |
| **Party** | `/party`, `/icebreaker`, `/best-dressed`, `/guestlist` | Minimal, kiosk-style — funnels back to `/party`, then `/` | Event-night guests, door staff |

**Standalone pages** (`/exam`, `/t/[id]`) have their own minimal navigation.

### Footer tiers

| Tier | Left side | Right side | Used on |
|------|-----------|------------|---------|
| **Editorial** | `← contextual back` (e.g. "← home", "← all albums") | `© year milk & henny` | Blog, pics, albums, photos |
| **Party** | `← back to party` (or `← back to home` from hub) | `© year Milk & Henny` | Party hub, icebreaker, best dressed, guest list |

Page-specific personality lives **above** the footer line: icebreaker's consent note, transfer's self-destruct date, exam's "end of questions."

### Accessibility landmarks

- `role="banner"` on headers, `role="contentinfo"` on footers
- `id="main"` on primary content (targeted by global skip link)
- `aria-label="Breadcrumb"` on breadcrumb navs
- Skip link: `<a href="#main">Skip to main content</a>` on every page

### Shared global elements (root layout)

- **LampToggle**: Theme toggle (lamp pull-cord), hidden on party/game pages
- **BackToTop**: Scroll-to-top button, hidden on same routes as LampToggle

### Design decisions

- **No global nav bar.** Single-column, minimal chrome. The masthead on `/` is the hub; inner pages use contextual back links + breadcrumbs.
- **Party pages don't cross-link to editorial.** A party guest doesn't need to find the blog. The two worlds connect only through the home page.
- **Every page has a way home.** Even standalone and expired pages include a brand link or "← home."
- **Photo pages auto-enable dark mode** for optimal viewing.
- **Batch download cap.** Album gallery warns before downloading 20+ full-res photos.

---

## Error Handling & Logging

Two shared utilities for server-side errors and logs.

**Mental model:** In a route handler catch block and need to return a 500? → **`apiErrorFromRequest()`**. Server-side but only need to record something? → **`log`**. On the client? → Show `data.error` from the API.

### When to use what

| Situation | Use | Where |
|-----------|-----|--------|
| API route catches an error, must return a response | `apiErrorFromRequest()` | `app/api/**/*.ts` |
| Server code needs to log something (no response) | `log.info` / `log.warn` / `log.error` | API routes, `lib/`, scripts |
| Client shows a message to the user | Existing UI state (e.g. `setError(data.error)`) | Components, hooks |

### API routes — safe 500s

```ts
import { apiErrorFromRequest } from '@/lib/api-error';

export async function POST(request: NextRequest) {
  try {
    // ... do work ...
    return NextResponse.json({ success: true });
  } catch (e) {
    return apiErrorFromRequest(request, 'myroute.action', 'Short user-facing message.', e, { id: someId });
  }
}
```

- **Scope** (first arg): dot-separated, e.g. `upload.transfer`, `guests.bootstrap`. Filter logs by scope in Vercel.
- **Message** (second arg): what the client sees. No internal details.
- **Context** (fourth arg, optional): ids, slugs, etc. — log entry only.
- `apiErrorFromRequest()` automatically includes `requestId` (from `x-request-id`) and `path` in the log context.

Use `NextResponse.json({ error: '...' }, { status: 400 })` for validation failures. Use `apiErrorFromRequest` for unexpected failures (R2, Redis, etc.).

### Logging without a response

```ts
import { log } from '@/lib/logger';

log.info('cron.cleanup', 'Cleanup finished', { deletedCount: 5 });
log.warn('cron.cleanup', 'R2 not configured — skipping file deletion');
log.error('lib.r2', 'ListObjects failed', { prefix: 'transfers/' }, err);
```

### Scopes

Keep scopes short and consistent: `upload.transfer`, `guests.add`, `best-dressed.vote`, `cron.cleanup`, `lib.r2`. Production logs are JSON lines with `level`, `scope`, `message`, `context`, `error`, `ts`.

### Client-side

Don't use `log` or `apiError` in React components (server-only). On the client, show `data.error` from the API.
