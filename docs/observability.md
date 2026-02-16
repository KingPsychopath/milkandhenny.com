# Observability & Alerts

What to monitor, where to monitor it (given our infra), and which alerts are worth setting up so we find outages/cost spikes *before* they matter.

---

## Infra map (where failures show up)

| Surface | Provider | Primary failure modes | Where you’ll notice first |
|---|---|---|---|
| App HTML + API routes | Vercel | 5xx errors, cold starts/timeouts, deploy misconfig | Vercel logs + function metrics |
| Guestlist + best dressed + transfer metadata | Vercel KV (Upstash Redis) | latency spikes, auth/rate-limit bugs, command budget exhaustion | Upstash metrics, Vercel logs, user-reported “loading” |
| Media (images + transfer files) | Cloudflare R2 + CDN | R2 read/write failures, lifecycle/cleanup gaps, abuse driving ops | Cloudflare analytics + billing/usage |
| Rate limiting | Cloudflare WAF | rule not applied, false positives, attack traffic | Cloudflare Security → Events |
| Cleanup cron | Vercel Cron → `/api/cron/cleanup-transfers` | cron not running, auth/secret broken, R2 or KV unavailable | Vercel logs + a dedicated “cron didn’t run” alert |

---

## What we already have (good baseline)

- **Structured server logs** via `lib/logger.ts` (JSON lines in prod; easy filtering by `scope`).
- **Safe 500s** via `lib/api-error.ts` (`apiErrorFromRequest()` logs the real error server-side, returns a user-safe message).
- **Request correlation**: every `/api/*` response includes `x-request-id` (added in `proxy.ts`).
- **Debug/health snapshot** at `GET /api/debug` (admin-only; includes Redis reachability + latency).
- **Known cost pressure point**: guestlist polling / KV commands (see `docs/operations.md` + postmortem).

This means the *minimum viable observability* is mostly “wire alerts to the logs/usage you already have”.

---

## Alerts to set up (recommended)

### Vercel (app)

- **Deploy failures**: enable email notifications for failed production deploys.
- **Server errors (5xx)**:
  - Alert on spikes in 500 responses (especially routes used on event night: `/api/guests`, `/api/best-dressed`).
  - If you add a log drain (Axiom/Datadog/etc.), alert on `{"level":"error"}` or on specific scopes.
- **Usage/billing thresholds** (Hobby tier is easy to hit accidentally):
  - Bandwidth usage approaching limit
  - Function invocations/timeouts (especially if an upload/finalize endpoint starts failing)
- **Cron did not run**:
  - Vercel Cron can fail silently if `CRON_SECRET` is missing/rotated or the route errors.
  - Add an alert that fires if no successful cron log appears within 36 hours.

### Vercel KV / Upstash (Redis)

- **Daily command usage**:
  - Warn at ~70–80% of the free budget.
  - Alert at ~90% (this is where you want to intervene before the guestlist becomes flaky).
- **Latency / timeouts**:
  - Alert on sustained latency increases (user-facing symptoms: “stuck loading”, slow check-in, votes failing).
- **Errors**:
  - Alert on `ECONNRESET`, `ETIMEDOUT`, and 5xx responses from the REST endpoint (if you’re draining logs).

### Cloudflare (R2 + CDN + WAF)

- **Billing/usage alerts**:
  - Set a low billing alert (you already call out `$5` as a good “something is wrong” tripwire in `docs/security.md`).
  - Track R2 Class B ops and storage (unexpected growth usually means a cleanup gap or abuse).
- **WAF rate limit events**:
  - Verify rate limit rules are actually triggering during abuse.
  - Watch for false positives (legit guests blocked) on event night.
- **Edge 5xx spikes** on `pics.*`:
  - If media starts 5xx’ing, the app may still look “up” but experience is broken.

---

## Uptime checks (external)

Provider dashboards are great, but they don’t replace “someone hit the site from the outside”.

- **Public page check**: monitor `/party` (or `/`) for a 200.
- **API check**: monitor `GET /api/health` every 5 minutes.

Notes:
- `GET /api/debug` is **admin-only** and returns environment detail. It’s not suitable for a third-party uptime probe.
- `GET /api/health` intentionally avoids Redis/R2 checks so frequent monitoring doesn’t create KV commands (and it doesn’t leak infra details).
- Health checks still create Vercel **function invocations**. On Hobby, prefer a 5-minute interval unless you have a reason to be more aggressive.

---

## Log drain (optional, but the “alerts” unlock)

If you want real alerts without building your own monitoring system, set up a Vercel **log drain** to a service that supports queries + alerting (Axiom, Datadog, Better Stack, etc.).

Recommended alert queries (conceptual):

- **Any server error**: `level=error` grouped by `scope`
- **Spike in guestlist failures**: `scope="guests.*"` + error count threshold
- **Cron failures**: `scope="cron.cleanup-transfers"` + error OR missing-success window
- **Auth anomalies**: repeated failures on `admin.verify`, `guests.verify-staff-pin`, `upload.verify-pin`

Because logs are structured, you can alert on *exact scopes* instead of brittle string matches.

---

## “Event night” checklist (quick)

- Vercel KV usage: confirm you have budget headroom for the expected number of guestlist devices.
- Cloudflare WAF: rate limit rules enabled for `pics.*` (and you know where to view events).
- Vercel logs: you can filter by scope quickly (`guests.*`, `best-dressed.*`).
- Cron: not critical for event night, but confirm it’s running daily in the days after (transfer cleanup).

---

## Gaps / follow-ups (small, high leverage)

- Add a log drain + alerts (Axiom/Datadog/Better Stack) so you can alert on `scope` + `level=error`.
- Consider adding lightweight route timing for the busiest endpoints (`/api/guests`, `/api/best-dressed`) if you want latency alerts without full tracing.

