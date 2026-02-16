# Operations

KV command budgets, cost analysis, and R2 lifecycle rules.

---

## KV Command Budget

**Vercel KV free tier: 3,000 commands/day.**

### Guest list (`/guestlist`)

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

> Uses the Page Visibility API: 5s when focused, 30s when backgrounded. This halves active cost and drops background cost by 12x.

### Best dressed (`/best-dressed`)

| Action | KV commands | Frequency |
|--------|-------------|-----------|
| Page load / refresh | 4 | Per view |
| Submit vote (happy path) | 6 | Per vote |
| Leaderboard poll (after voting) | 4 | Every 30s, only when tab visible |
| Admin wipe | 4 | Very rare |

After voting, leaderboard updates every 30s and only when the tab is focused. 20 voters ≈ 40 commands per voter.

### Transfers (`/t/{id}`)

| Action | KV commands | Frequency |
|--------|-------------|-----------|
| Page view (cache miss) | 1 GET | First view per 60s window |
| Page view (CDN cache hit) | **0** | Repeat views within 60s |
| Upload (CLI) | 2 (SET + SADD) | Per upload |
| List (CLI) | 1 + N (SMEMBERS + pipelined GETs) | On demand |
| Delete (CLI/browser) | ~3 (GET + DEL + SREM) | On demand |
| Cron cleanup | 1 + N (SMEMBERS + pipelined EXISTS) | Daily |

CDN caching means repeat visits cost zero KV commands.

### Other endpoints

| Endpoint | KV commands | Trigger |
|----------|-------------|---------|
| `GET /api/debug` | ~1 GET | Manual only (health-only: checks config + lightweight Redis reachability) |

### Typical daily budget

| Scenario | Est. commands | % of 3,000 |
|----------|---------------|-----------|
| Guest list: 1 tab, 2 hrs focused + 6 hrs background | ~2,160 | 72% |
| Best dressed: 20 voters | ~240 | 8% |
| Transfers: 10 page views, 2 uploads | ~14 | 0.5% |
| Cron cleanup | ~10 | 0.3% |
| **Total** | **~2,424** | **81%** |

**Safe on free tier** for typical party + private sharing usage. The guest list poll is the biggest consumer. Multiple simultaneous devices on guestlist each add ~720/hr focused.

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

### Transfer page caching impact

Transfer content never changes after upload, so the page is CDN-cached at Vercel's edge:

- First visitor → SSR (1 KV GET)
- Next 60s → served from edge cache ($0, 0 KV commands)
- 60s–5min → served stale while revalidating in background
- After takedown → stale page up to 60s, but R2 files already deleted

Cost: $0 — CDN caching is included in Vercel Hobby.

---

## R2 Lifecycle Rule (Recommended)

A safety net that catches any transfer files surviving Redis TTL + cron cleanup:

1. **Cloudflare Dashboard → R2 → your bucket → Settings → Object lifecycle rules**
2. Create rule: name `cleanup-expired-transfers`, prefix `transfers/`, delete after **31 days**
3. Save

The cron job handles 99% of cleanup. This catches edge cases (cron failure, Redis outage).
