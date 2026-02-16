# Security

Authentication, protections, rate limiting, and what to do when credentials leak.

---

## Authentication

| Gate | Env var | Protects | Verified by |
|------|---------|----------|-------------|
| Staff PIN | `STAFF_PIN` | Guest list page access (door staff) | `POST /api/guests/verify-staff-pin` |
| Admin password | `ADMIN_PASSWORD` | Manage (add/remove/import, wipe best-dressed), admin tools | `POST /api/admin/verify` |
| Upload PIN | `UPLOAD_PIN` | Web upload page (`/upload`) | `POST /api/upload/verify-pin` |

All gates are env vars, never in the client bundle. Set in Vercel and `.env.local`.

Verify endpoints issue short-lived JWTs (role-based TTLs). Clients store tokens in `sessionStorage` (not raw credentials), so the browser clears them when the tab closes.

Destructive admin actions require **step-up** re-auth (`POST /api/admin/step-up`) and include `x-admin-step-up` on the request.

You can revoke:

- **One session** (single token) by `jti` (admin dashboard token sessions list)
- **All sessions for a role** by bumping the role token version (admin dashboard "revoke admin sessions" / "revoke all role sessions", or CLI)

### Token lifecycle (mental model)

Tokens are **stateless** JWTs. A deploy/rebuild does not revoke them.

What makes an existing token stop working:

- **Expiry**: once `exp` passes, the token is rejected.
- **Single-session revoke**: admin revokes a specific `jti` (writes `auth:revoked-jti:{jti}` in Redis).
- **Role-wide invalidate**: bump the role **token version** (the JWT `tv` must match `auth:token-version:{role}`).
- **Secret rotation**: change `AUTH_SECRET` (signature check fails for every previously issued token).

What does *not* revoke existing tokens:

- **Vercel deploys / rebuilds** (code changes alone).
- **Changing `ADMIN_PASSWORD`, `STAFF_PIN`, or `UPLOAD_PIN`**: this only affects *future* logins. Existing JWTs remain valid until they expire or are revoked/invalidated.

Notes:

- The admin dashboard label `signed out` corresponds to **token-version invalidation** (not "we observed the user clicked logout"). A normal sign-out is usually just clearing `sessionStorage` client-side.
- Token versions are for **session invalidation**, not API versioning. They do not create `/v1` vs `/v2` endpoints.

### Auth operations (admin-only)

These endpoints are intended for operational control and incident response.

| Operation | Endpoint | Notes |
|----------|----------|-------|
| Admin login (issue JWT) | `POST /api/admin/verify` | Returns `{ token }` on success |
| Step-up token | `POST /api/admin/step-up` | Requires `Authorization: Bearer <adminJWT>` + body `{ password }`. Returns short-lived step-up token |
| List token sessions | `GET /api/admin/tokens/sessions` | Redis-backed list of issued sessions by `jti` with status + expiry |
| Revoke one session | `DELETE /api/admin/tokens/sessions/{jti}` | Requires `x-admin-step-up` header |
| Revoke many sessions | `POST /api/admin/tokens/revoke` | Body `{ role: "admin" \| "staff" \| "upload" \| "all" }` + requires `x-admin-step-up` |

### Why revoked tokens still show up

Revoking a session does not delete the session record immediately. We keep a small Redis-backed record (`auth:session:{jti}`) until the token’s natural expiry so:

- the admin dashboard can show *what happened* (`revoked` / `signed out` / `expired`) instead of the row disappearing instantly
- you can confirm you revoked the correct session during an incident

The actual “revoked” enforcement is separate (`auth:revoked-jti:{jti}`) and is checked on every authenticated request. Both keys age out automatically around the token expiry.

Admin tokens act as the master token for normal app gates: an `admin` JWT is accepted anywhere `staff` or `upload` access is required. Dedicated `STAFF_PIN` / `UPLOAD_PIN` flows still exist for role-specific sharing and least-privilege usage.

---

## Transfer Security

- **Memorable word URLs**: 3-word hyphenated IDs (e.g. `velvet-moon-candle`), ~2.2M combos
- **Delete tokens**: 22-char base64url (16 bytes), never exposed to recipients
- **Presigned URLs**: time-limited (15 min), scoped to a single R2 key, generated server-side only for authenticated uploaders
- **Admin-only takedown**: only the uploader can delete (CLI or admin URL)
- **No indexing**: `robots: noindex, nofollow` on all transfer pages
- **Auto-expiry**: Redis TTL + server-side check + daily cron R2 cleanup
- **CDN caching**: Vercel edge caches transfer pages for 60s (zero KV cost on repeat visits)

---

## Best-Dressed Protections

| Risk | Mitigation |
|------|------------|
| Vote stuffing | Default: staff-minted one-time vote codes (single-use). Also uses a one-time vote token (GET issues, POST consumes) + a coarse per-IP rate limit as a backstop. Optional: door staff can temporarily open voting without codes for a fixed window. |
| Fake names | Server validates the voted name is in the guest list. Arbitrary names rejected. |
| Anyone wiping votes | `DELETE /api/best-dressed` requires admin token. |

Notes:

- Codes are the primary "one vote per person" mechanism. Door staff can choose how long codes last (TTL) when minting single codes or printing a batch sheet.
- QR codes are just deep links to `/best-dressed?code=BD-XXXXXXXX` to avoid typing (drunk-friendly).
- There are two distinct "gates" depending on whether voting is open:
  - Voting closed (default): requires a staff-minted one-time code (`best-dressed:code:*`). This is the "one vote per person" mechanism.
  - Voting open (time window): codes are not required; voting is limited to "one vote per device" using a browser cookie (`mah-bd-voter`) and a per-session marker (`best-dressed:voted:<session>`).
- Staff can use an "event QR" (poster/powerpoint) that links to `/best-dressed` when voting is open.
- If Redis is unavailable, best-dressed falls back to in-memory storage (local dev only). In production, configure Redis to keep votes stable.

---

## Cloudflare WAF (Rate Limiting)

Images and transfer files are served from `pics.milkandhenny.com` (R2 custom domain). Every request counts as an R2 read. Rate limiting prevents abuse.

In **Cloudflare Dashboard → Security → WAF → Rate limiting rules**, create two rules:

| Rule | Match | Per IP | Threshold | Action | Duration |
|------|-------|--------|-----------|--------|----------|
| Album images | URI path `/albums/*` | Yes | 100 req / 10s | Block | 10s |
| Transfer files | URI path `/transfers/*` | Yes | 100 req / 10s | Block | 10s |

> Free plan limits: 10-second period and 10-second block duration only.

For the step-by-step Cloudflare walkthrough, see [cloudflare-rate-limit-images.md](./cloudflare-rate-limit-images.md).

### Worst-case cost with rate limiting

| Attack scenario | Requests/day (sustained) | R2 cost/month |
|-----------------|--------------------------|---------------|
| 1 IP (script kiddie) | ~432,000 | ~$1 |
| 10 IPs (VPN/proxies) | ~4.3M | ~$43 |

A casual single-IP attacker costs ~$1/month. A serious multi-IP attack is extremely unlikely for a personal site. Cloudflare's automatic DDoS protection (included free) is always active.

**If under attack:** set a Cloudflare billing alert at $5, check Security → Events, block IPs via WAF Custom Rules, enable Under Attack Mode if needed, tighten rate limits temporarily.

---

## Incident Response & Key Rotation

The app is designed for easy key rotation — every secret is an environment variable, nothing is hardcoded, and no secret is baked into the client bundle. Rotation never requires a code change.

Postmortems:

- Guestlist KV read spike (local dev): `docs/postmortem-guestlist-kv-read-spike.md`

### R2 credentials leaked (`R2_ACCESS_KEY` / `R2_SECRET_KEY`)

These are the highest-impact credentials — they grant read/write/delete access to your entire R2 bucket.

1. **Cloudflare Dashboard → R2 → Manage R2 API Tokens**
2. **Revoke** the compromised token immediately
3. **Create a new token** with the same permissions (Object Read & Write on your bucket)
4. Copy the new Access Key ID and Secret Access Key
5. **Update `.env.local`** with the new values
6. **Update Vercel env vars** (Settings → Environment Variables)
7. **Redeploy** on Vercel so the cron picks up the new token
8. Test: `pnpm cli bucket ls` — should return bucket contents

**Downtime:** Zero for the public site (images served via Cloudflare CDN). CLI operations fail between steps 2–5. Cron fails until redeploy.

### KV / Redis credentials leaked (`KV_REST_API_URL` / `KV_REST_API_TOKEN`)

1. **Upstash Console → your database → REST API section → Reset token** (or rotate via Vercel Dashboard → Storage → KV → Settings)
2. Copy the new URL and token
3. **Update `.env.local`**
4. **Update Vercel env vars** (if set manually; Vercel KV auto-updates if rotated from Vercel Dashboard)
5. **Redeploy** on Vercel
6. Test: `pnpm cli transfers list`

**Downtime:** Guest list polling and transfer pages return errors during rotation (~30s). CDN-cached transfer pages keep serving for up to 60s.

**Data at risk:** KV token grants read/write to guest names, votes, and transfer metadata (not files — those are in R2).

### Admin password, Upload PIN, or Staff PIN leaked

1. **Update Vercel env vars** → `ADMIN_PASSWORD`, `UPLOAD_PIN`, and/or `STAFF_PIN`
2. **Redeploy** on Vercel
3. Update `.env.local` for local dev

**Downtime:** None. Existing tokens remain valid until expiry, but you can also revoke sessions immediately (Admin dashboard → session security, or `pnpm cli auth revoke ...`).

### CRON_SECRET leaked

1. Generate: `openssl rand -hex 32`
2. **Update Vercel env var** → `CRON_SECRET`
3. **Redeploy**

**Downtime:** None. The cron runs daily; next invocation uses the new secret.

### Quick-reference: where each secret lives

| Secret | `.env.local` | Vercel env vars | Cloudflare | Upstash |
|--------|:---:|:---:|:---:|:---:|
| `R2_ACCESS_KEY` / `R2_SECRET_KEY` | Yes | Yes | Source of truth | — |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Yes | Auto-injected | — | Source of truth |
| `STAFF_PIN` | Yes | Yes | — | — |
| `ADMIN_PASSWORD` | Yes | Yes | — | — |
| `UPLOAD_PIN` | Yes | Yes | — | — |
| `CRON_SECRET` | No | Yes | — | — |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | Yes | Yes | — | — |
| `NEXT_PUBLIC_BASE_URL` | Yes (CLI) | No | — | — |

### General incident checklist

1. **Identify** which credential was exposed and where
2. **Revoke/rotate** at the source immediately (Cloudflare, Upstash, or Vercel)
3. **Update** `.env.local` + Vercel env vars
4. **Redeploy** on Vercel
5. **Verify** with a CLI or browser test
6. **Audit** Cloudflare Analytics and Upstash Monitor for suspicious activity
7. **Document** what happened

### What makes this app rotation-friendly

- **No secrets in code.** Every credential is an env var — rotation is config-only.
- **No secrets in the client bundle.** `NEXT_PUBLIC_*` vars contain only public URLs, not secrets.
- **Token-based auth.** Short-lived JWTs (role-based TTLs), stored in `sessionStorage`, never raw credentials.
- **Layered storage.** R2 and KV credentials are independent — leaking one doesn't compromise the other.
- **CDN buffer.** Cached content continues serving even during a rotation window.
