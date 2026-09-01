# Security

Authentication, protections, rate limiting, and what to do when credentials leak.

---

## Authentication

| Gate           | Env var                        | Protects                                                   | Verified by                    |
| -------------- | ------------------------------ | ---------------------------------------------------------- | ------------------------------ |
| Admin password | `ADMIN_PASSWORD`               | Manage (add/remove/import, wipe best-dressed), admin tools | `POST /api/admin/verify`       |
| Upload PIN     | `UPLOAD_PIN`                   | Web upload page (`/upload`)                                | `POST /api/upload/verify-pin`  |
| Word share PIN | Per-share link (stored hashed) | Optional second factor for signed word links               | `POST /api/words/share/verify` |

All role gates are runtime environment variables and never enter the client bundle.
Words do **not** use a global reader env PIN: PIN is configured per share link and stored as a hash.

Verify endpoints issue short-lived JWTs (role-based TTLs). The app stores role JWTs in **httpOnly cookies** by default (not raw credentials), so:

- server-rendered routes and server functions can authenticate
- client code cannot read the JWT (XSS hardening)

Notes:

- API routes still accept `Authorization: Bearer <token>` for CLI/tools and explicit callers.
- The upload dashboard uses the httpOnly auth cookie for its client-driven presign/finalize calls.
- Words media upload endpoints (`/api/upload/words/*`) are admin-only; the `UPLOAD_PIN` gate is for transfers.

See also: [storage-and-auth.md](./storage-and-auth.md) for the "cookies vs localStorage" mental model and feature-by-feature mapping.

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

What does _not_ revoke existing tokens:

- **Deploys / rebuilds** (code changes alone).
- **Changing `ADMIN_PASSWORD` or `UPLOAD_PIN`**: this only affects _future_ logins. Existing JWTs remain valid until they expire or are revoked/invalidated.

Notes:

- The admin dashboard label `signed out` corresponds to **token-version invalidation** (not "we observed the user clicked logout"). A normal sign-out is usually clearing the auth cookie client-side (or it expiring).
- Token versions are for **session invalidation**, not API versioning. They do not create `/v1` vs `/v2` endpoints.

### Auth operations (admin-only)

These endpoints are intended for operational control and incident response.

| Operation               | Endpoint                                  | Notes                                                                                                                             |
| ----------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Admin login (issue JWT) | `POST /api/admin/verify`                  | Returns `{ token }` on success                                                                                                    |
| Step-up token           | `POST /api/admin/step-up`                 | Requires an admin session (cookie or `Authorization: Bearer <adminJWT>`) + body `{ password }`. Returns short-lived step-up token |
| CLI browser approval    | `POST /api/admin/cli-auth/request`        | Login requests use PKCE; step-up requests additionally require an admin bearer token and bind approval to that token's `jti`      |
| List token sessions     | `GET /api/admin/tokens/sessions`          | Redis-backed list of issued sessions by `jti` with status + expiry                                                                |
| Revoke one session      | `DELETE /api/admin/tokens/sessions/{jti}` | Requires `x-admin-step-up` header                                                                                                 |
| Revoke many sessions    | `POST /api/admin/tokens/revoke`           | Body `{ role: "admin" \| "upload" \| "all" }` + requires `x-admin-step-up`                                                        |

### CLI authentication

If your production domain redirects between hostnames (example: `milkandhenny.com` -> `www.milkandhenny.com`), Bearer auth can fail after redirect because some clients/proxies drop the `Authorization` header on redirected requests.

All auth-sensitive CLI requests resolve the canonical host first, then use that
origin. This prevents a redirect from dropping the `Authorization` header.

Recommended daily workflow:

```bash
pnpm cli auth login --base-url https://milkandhenny.com
pnpm cli auth step-up --base-url https://milkandhenny.com
pnpm cli events list --base-url https://milkandhenny.com
pnpm cli auth logout --base-url https://milkandhenny.com
```

`auth login` opens the browser and starts a five-minute, PKCE-protected approval
request. The browser asks for the admin password and approves the terminal. The
password stays in the browser; the CLI receives only a one-time code and then a
short-lived admin JWT. The JWT is stored in the operating system's protected
credential store. macOS uses Keychain, Linux uses Secret Service, and Windows
uses user-scoped DPAPI storage. Other CLI commands load that JWT automatically.
Protected CLI actions store their separate parent-bound step-up token in the same
operating-system credential facility and reuse it only until its five-minute expiry.
When it is close to expiry or the server rejects it as revoked, the CLI starts
the browser approval flow again. `auth logout` removes the local value but does
not revoke the remote session.

The browser is needed only during `auth login` or re-authentication. Normal CLI
commands call the backend API directly with the stored Bearer JWT. The browser
approval page is served by the configured base URL; the final code is returned
only to the CLI's temporary `127.0.0.1` callback.

Linux requires the `secret-tool` command from the system's Secret Service
package. Windows uses the user's PowerShell DPAPI scope. Headless machines and
CI should use `--admin-token` from a protected environment variable instead, or
use `auth login --admin-password` when a private prompt is not possible.

`auth revoke` performs the destructive flow for the current CLI session: it
prompts for step-up re-authentication, revokes that exact `jti` through the API,
and then removes the local credential. Use `auth revoke --role admin` or
`--role all` for role-wide invalidation.

The CLI still accepts explicit credentials for one-off or non-interactive use:

```bash
pnpm cli events list \
  --base-url https://milkandhenny.com \
  --admin-token "$MILK_HENNY_ADMIN_TOKEN"
```

`--admin-password` remains available, but can expose the password in shell
history. Prefer `auth login` or a protected environment variable.

Why auth commands are API-backed (not direct Redis/R2 writes):

- R2 is not the source of truth for auth sessions/revocation.
- Direct Redis writes from CLI would bypass app-level auth semantics (step-up requirement, token-version invalidation rules, and session policy checks).
- Keeping auth commands on app endpoints preserves one source of truth for session behavior and avoids CLI/server drift.

CLI sessions are stored in the same Redis-backed session index as browser
sessions. The admin panel labels them `CLI · terminal session`; browser logins
are labelled `browser session`. Both are one-hour admin JWTs and can be revoked
individually or by role.

Operational check:

```bash
pnpm cli auth diagnose --admin-password <password> --base-url https://milkandhenny.com
```

If `verify` succeeds but protected probes return `401`, check:

1. Cross-environment `AUTH_SECRET` mismatch.
2. Proxy/CDN behavior that strips `Authorization`.

### Why revoked tokens still show up

Revoking a session does not delete the session record immediately. We keep a small Redis-backed record (`auth:session:{jti}`) until the token’s natural expiry so:

- the admin dashboard can show _what happened_ (`revoked` / `signed out` / `expired`) instead of the row disappearing instantly
- you can confirm you revoked the correct session during an incident

The actual “revoked” enforcement is separate (`auth:revoked-jti:{jti}`) and is checked on every authenticated request. Both keys age out automatically around the token expiry.

Admin tokens act as the master token for normal app gates: an `admin` JWT is accepted anywhere upload access is required. The dedicated `UPLOAD_PIN` flow remains for least-privilege transfer uploads. Event workers use revocable scanner links instead of a shared PIN.

---

## Transfer Security

- **View IDs**: 22-char base64url values generated from 128 random bits
- **Delete tokens**: 22-char base64url (16 bytes), never exposed to recipients
- **Presigned URLs**: time-limited, scoped to a single R2 key and operation, and issued only after
  the application authorizes the workflow. Upload and protected-read windows are configured
  separately.
- **Takedown authority**: the uploader's private delete capability or an authenticated admin action
- **No indexing**: `robots: noindex, nofollow` on all transfer pages
- **Auto-expiry**: Redis TTL + server-side check + daily cron R2 cleanup
- **Cache isolation**: transfer pages and protected media are always `private, no-store`; only intentionally published public media is cacheable

---

## Best-Dressed Protections

| Risk                | Mitigation                                                                                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vote stuffing       | Default: admin-minted one-time vote codes (single-use). Also uses a one-time vote token (GET issues, POST consumes) + a coarse per-IP rate limit as a backstop. The admin can temporarily open voting without codes for a fixed window. |
| Fake names          | Server validates the voted name against live ticket holders. Arbitrary names are rejected.                                                                                                                                              |
| Anyone wiping votes | `DELETE /api/best-dressed` requires admin token.                                                                                                                                                                                        |

Notes:

- Codes are the primary "one vote per person" mechanism. The admin chooses how long codes last when creating a batch.
- QR codes are just deep links to `/best-dressed?code=BD-XXXXXXXX` to avoid typing (drunk-friendly).
- There are two distinct "gates" depending on whether voting is open:
  - Voting closed (default): requires an admin-minted one-time code (`best-dressed:code:*`). This is the "one vote per person" mechanism.
  - Voting open (time window): codes are not required; voting is limited to "one vote per device" using a browser cookie (`mah-bd-voter`) and a per-session marker (`best-dressed:voted:<session>`).
- The organiser can use a poster or slide QR that links to `/best-dressed` when voting is open.
- If Redis is unavailable, best-dressed falls back to in-memory storage (local dev only). In production, configure Redis to keep votes stable.

---

## Cloudflare WAF

Public images are served from `pics.milkandhenny.com` (the public R2 bucket's custom domain). Transfer files live in a separate private R2 bucket and are reached through short-lived signed redirects from the application. Every successful object request counts as an R2 read.

Use narrowly scoped per-IP rules for the public media hostname and protected transfer media route.
Do not copy plan limits, prices, or dashboard labels into the security contract: they change outside
the repository. Record the deployed expression and threshold in the operator's Cloudflare
configuration, verify normal gallery bursts remain below it, and review provider usage alerts.

The repository-side intent and verification steps are in
[cloudflare-rate-limit-images.md](./cloudflare-rate-limit-images.md).

---

## Incident Response & Key Rotation

The app is designed for easy key rotation — every secret is an environment variable, nothing is hardcoded, and no secret is baked into the client bundle. Rotation never requires a code change.

Postmortems:

- Guestlist KV read spike (local dev): `docs/postmortem-guestlist-kv-read-spike.md`

### R2 credentials leaked

Each credential pair grants read, write, and delete access to one R2 bucket. Treat a private-bucket credential leak as a possible disclosure of protected media.

1. **Cloudflare Dashboard → R2 → Manage R2 API Tokens**
2. **Revoke** the compromised token immediately
3. **Create a new token** with Object Read & Write for only the affected bucket
4. Copy the new Access Key ID and Secret Access Key
5. **Update `.env.local`** with the new values
6. **Update the production host's secret variables**
7. **Redeploy** so the app and maintenance runner use the new token
8. Test: `pnpm cli bucket ls` — should return bucket contents

Cached public derivatives may continue to serve during rotation. Private storage operations and
maintenance can fail until every workload receives the replacement credential.

### Redis credentials leaked (`REDIS_REST_URL` / `REDIS_REST_TOKEN`)

1. **Redis provider console → REST API section → Reset token**
2. Copy the new URL and token
3. **Update `.env.local`**
4. **Update the production host's secret variables**
5. **Redeploy**
6. Test: `pnpm cli transfers list`

Transfer, authentication, rate-limit, and room operations can fail during rotation. Their
`private, no-store` policy prevents a shared cache from substituting a stale capability response.

**Data at risk:** The Redis token grants read/write to vote and transfer metadata (not files — those are in R2).

### Admin password or Upload PIN leaked

1. **Update production secrets** → `ADMIN_PASSWORD` and/or `UPLOAD_PIN`
2. **Redeploy**
3. Update `.env.local` for local dev

**Downtime:** None. Existing tokens remain valid until expiry, but you can also revoke sessions immediately (Admin dashboard → session security, or `pnpm cli auth revoke ...`).

### CRON_SECRET leaked

1. Generate: `openssl rand -hex 32`
2. **Update the production `CRON_SECRET`**
3. **Redeploy**

**Downtime:** None. The cron runs daily; next invocation uses the new secret.

### Quick-reference: where each secret lives

| Secret/config                                                      | Local development | Production host | Source of truth         |
| ------------------------------------------------------------------ | :---------------: | :-------------: | ----------------------- |
| `AUTH_SECRET`, `ADMIN_PASSWORD`, `UPLOAD_PIN`, `CRON_SECRET`       |        Yes        |       Yes       | Secret manager          |
| `DATABASE_URL`                                                     |        Yes        |       Yes       | PostgreSQL provider     |
| `REDIS_REST_URL` / `REDIS_REST_TOKEN`; optional direct `REDIS_URL` |        Yes        |       Yes       | Redis provider          |
| `R2_PUBLIC_ACCESS_KEY` / `R2_PUBLIC_SECRET_KEY`                    |        Yes        |       Yes       | Public-bucket R2 token  |
| `R2_PRIVATE_ACCESS_KEY` / `R2_PRIVATE_SECRET_KEY`                  |        Yes        |       Yes       | Private-bucket R2 token |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`                      |     Optional      |  When selling   | Stripe                  |
| `EMAIL_API_KEY` / `EMAIL_EVENT_SECRET`                             |     Optional      | When delivering | Email provider/relay    |
| `VITE_MEDIA_PUBLIC_URL` / `VITE_BASE_URL`                          |        Yes        |   Build-time    | Deployment config       |

### General incident checklist

1. **Identify** which credential was exposed and where
2. **Revoke/rotate** at the source immediately
3. **Update** local and production secret stores
4. **Redeploy**
5. **Verify** with a CLI or browser test
6. **Audit** host, Cloudflare, database, Redis, Stripe, and email-provider logs as relevant
7. **Document** what happened

### What makes this app rotation-friendly

- **No secrets in code.** Every credential is an env var — rotation is config-only.
- **No secrets in the client bundle.** `VITE_*` vars contain only public URLs and client configuration, never secrets.
- **Token-based auth.** Short-lived JWTs (role-based TTLs), stored in httpOnly cookies by default, never raw credentials.
- **Layered storage.** Database, Redis, and per-bucket R2 credentials have separate blast radii.
- **CDN buffer.** Cached content continues serving even during a rotation window.
