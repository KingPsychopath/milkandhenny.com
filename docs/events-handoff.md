# Events platform — session handoff

Working state as of 29 July 2026. Read this plus [events-platform.md](./events-platform.md) (the spec) and [architecture.md](./architecture.md) and you have everything.

Delete this file once the first event has run — it is a snapshot, not documentation.

---

## ⚠️ Production is in LIVE mode

`STRIPE_SECRET_KEY` is `sk_live_` and the webhook endpoint was created in the **live** account, so the modes match and the configuration is correct. Nothing is broken.

But it means **real cards will be charged the moment a paid event is published.** Right now nothing is at risk — `/events` is empty and there is nothing to buy — so the window to get this right is before the first event goes up.

**The gap:** every end-to-end verification so far was done in **test mode**, against a different key, a different webhook endpoint and a different signing secret. None of it proves the live path works. Stripe keeps the two environments completely separate.

**Close it with a live dress rehearsal**, which costs pennies:

1. Create the real event but add a throwaway ticket type at **£0.50**, quantity 1, marked `hidden` if you don't want it seen
2. Buy it yourself with a real card
3. Verify: ticket row appears, email arrives, QR scans at `/door`, refund works
4. Refund yourself and delete the ticket type

Stripe keeps the ~20p fee on the refund. That is the entire cost of knowing your live payment path works.

Do **not** skip this on the grounds that test mode passed. Test mode passing is what makes live failure surprising.

---

## Where things stand

Live at `milkandhenny.com`, commit `a942265`. 409 tests passing, lint clean, 0 type errors.

| Capability                                                                               | State                                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Events: model, `/events`, `/events/$slug`, admin CRUD, nav, `.ics`, JSON-LD, OG, sitemap | ✅ done                                                                  |
| Tickets: issuance, signed QR, `/ticket/$id`, resend-by-email                             | ✅ done                                                                  |
| Door: `/door`, scanner-first, offline manifest + queue                                   | ✅ done                                                                  |
| Postgres: events, tickets, redemptions, checkout sessions                                | ✅ done, migrations run on boot                                          |
| Stripe: Checkout, webhook, refunds, disputes                                             | ✅ code done, ✅ live config correct, ⚠️ live path unverified            |
| Email: provider-neutral adapter, ticket template with inline QR                          | ✅ configured, ✅ Gmail delivery rehearsed, ⚠️ iCloud/Outlook unverified |
| `/party` → `/events` redirect; guestlist deleted                                         | ✅ done                                                                  |
| Hot takes (Phase 3)                                                                      | ❌ not started                                                           |

`/api/health` currently reports **healthy** on the deployed commit.

---

## Blocked on Abel

### 1. Live dress rehearsal

See the warning above. Do this before publishing the first paid event.

### 2. Cloudflare Email DNS — configured

`tickets.milkandhenny.com` and `notify.milkandhenny.com` are enabled for Email
Sending with dedicated `cf-bounce` DKIM selectors and return-path domains. A
real ticket email reached Gmail's personal inbox with the inline QR intact on
29 July. Live channel checks also reached Gmail from
`tickets@tickets.milkandhenny.com` and `studio@notify.milkandhenny.com`.

`hello@milkandhenny.com` forwards replies to the verified
`work@owenabel.com` destination through Cloudflare Email Routing.

### 3. Cloudflare API tokens — configured

Two, with different blast radii:

| Token | Scope                                                              | Lives in                             |
| ----- | ------------------------------------------------------------------ | ------------------------------------ |
| Shell | Account → Email Sending: Edit; Zone → milkandhenny.com → DNS: Edit | `~/.zshrc` as `CLOUDFLARE_API_TOKEN` |
| App   | Account → Email Sending: Edit **only**                             | Railway as `EMAIL_API_KEY`           |

`CLOUDFLARE_ACCOUNT_ID` is already exported in `~/.zshrc` (backup at `~/.zshrc.bak-*`).

### 4. Railway email variables — configured

`EMAIL_API_KEY`, `EMAIL_TICKETS_FROM=tickets@tickets.milkandhenny.com`,
`EMAIL_STUDIO_FROM=studio@notify.milkandhenny.com`, and
`EMAIL_REPLY_TO=hello@milkandhenny.com` are set. `EMAIL_ACCOUNT_ID` falls back
to `R2_ACCOUNT_ID`.

### 5. Finish rotating the leaked secrets

`ADMIN_PASSWORD`, `STAFF_PIN`, `UPLOAD_PIN`, `AUTH_SECRET`, `R2_SECRET_KEY`, `REDIS_REST_TOKEN` and `CRON_SECRET` were printed into a chat transcript on 29 July by a `railway variables` call that returned values, not just names. Nothing hostile happened; rotate the short human-memorable ones at minimum.

`AUTH_SECRET` was rotated across web and media-worker before any real event
tickets were issued. The other listed secrets still need rotation.

---

## Decisions already made — don't re-litigate

| Decision                                                                             | Reasoning                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No user accounts.** Email is the identity.                                         | 80–100 people. Accounts are friction and a GDPR liability. "Enter your email, we resend your tickets" _is_ the auth.                                                  |
| **Don't collect phone numbers.**                                                     | Extra PII, no SMS planned, Stripe collects what payment needs.                                                                                                        |
| **Postgres for events/tickets, Redis for the rest.**                                 | Refunds need one transaction; capacity needs a row lock; redemption needs a real constraint. Redis keeps sessions, rate limits, room state, wake fan-out.             |
| **Stripe over a ticketing platform.**                                                | At £15–20, self-hosted is ~2.8% vs Eventbrite/DICE/Skiddle at 10–12%. More importantly the games in `/things` are the differentiator, and no platform can host those. |
| **Separate Stripe account** (`acct_1TyaNFCsZcQabsWS`) from Out of Office Collective. | Stripe policy requires it for independent projects; statement descriptor confusion causes disputes.                                                                   |
| **No Connect.**                                                                      | Connect is for routing money to third parties. Own tickets, own money.                                                                                                |
| **Hosted Checkout, not a custom card form.**                                         | Apple/Google Pay free, zero PCI surface.                                                                                                                              |
| **The webhook issues tickets, not the redirect.**                                    | People close the tab.                                                                                                                                                 |
| **No door sales in v1.**                                                             | Turns the scanner into a POS. Comps at the door still work.                                                                                                           |
| **Hot takes is submission-only in v1.**                                              | No slide editor. The presenter view is the valuable half.                                                                                                             |
| **Effect at service boundaries only.**                                               | Engines stay plain async; `Context.Service` adds timeout, tagged errors, spans. Matches `features/things/shared`.                                                     |
| **Refund cutoff: self-serve until doors open.**                                      | Refused once anyone on the order has scanned in. Not yet confirmed by Abel.                                                                                           |

---

## Traps this codebase has already sprung

Each of these cost real debugging time. Do not rediscover them.

**`oxfmt --write .` reformats ~85 unrelated files**, including 78,000 lines of `countries.generated.json`. The repo is not formatter-clean at the pinned oxfmt version — `components/BackToTop.tsx` fails `--check` on a pristine checkout. **Format only your own paths.** A repo-wide format deserves its own commit.

**`docker exec` without `-i` silently discards stdin.** A heredoc into `psql` runs nothing and exits 0. Always `docker exec -i`.

**Route changes need `routeTree.gen.ts` regenerated** before they typecheck. Run `vite dev` briefly, then stop it.

**The CSRF middleware blocks server-to-server POSTs.** `allowRequestsWithoutOriginCheck: false` means anything without a same-origin `Origin` gets 403 — which silently broke every Stripe webhook. Exempt paths are in `ORIGIN_CHECK_EXEMPT_PATHS` in `src/start.ts`, guarded by `__tests__/unit/csrf-webhook-exemption.test.ts`. **Any future webhook needs the same exemption.**

**`stripe config --list` prints keys for _all_ profiles.** Parse only the `[default]` section, or you'll grab the wrong account's key. Ask for `--project-name default` explicitly.

**The Stripe CLI's key expires** (`test_mode_key_expires_at`). Fine for local dev, wrong for Railway.

---

## Local development

```bash
docker run -d --name mah-test-pg -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=mah_test -p 55432:5432 postgres:18-alpine
```

Postgres 18 deliberately — it matches what Railway provisions (18.4). Postgres 19 does not exist.

`.env.local` (gitignored) needs `DATABASE_URL`, `AUTH_SECRET`, `ADMIN_PASSWORD`, `STAFF_PIN`, `UPLOAD_PIN`, and a `STRIPE_SECRET_KEY`.

Database-backed test suites **skip** when no Postgres is reachable — check the run output rather than assuming green means everything ran.

To exercise webhooks locally:

```bash
stripe listen --project-name default \
  --forward-to localhost:3000/api/stripe/webhook
```

Put the printed `whsec_` in `.env.local` and restart the dev server.

---

## Verification criteria — the definition of done

Nothing counts until each of these has been observed, not reasoned about.

- [x] Test-mode purchase issues tickets end to end
- [ ] **Live-mode** purchase issues tickets end to end (different keys, endpoint and secret — test mode proves nothing here)
- [x] The same webhook event delivered 3× still issues exactly one set
- [x] `charge.refunded` voids tickets and returns the seats
- [x] A **partial** refund voids only the tickets it covers _(integration test, not a live payload)_
- [ ] `charge.dispute.closed` with status `won` restores tickets _(untested against a real payload)_
- [ ] `checkout.session.expired` closes the pending session _(untested against a real payload)_
- [ ] `radar.early_fraud_warning.created` logs _(untested against a real payload)_
- [x] Ticket email arrives in the **Gmail** personal inbox, not spam
- [ ] Ticket email arrives in **iCloud and Outlook** inboxes, not spam
- [x] The delivered email contains its inline QR, and the ticket link works independently
- [x] The production redemption path admits, rejects a second scan, and rejects a forged signature
- [ ] Door works with wifi **off**, and queued scans sync on reconnect
- [x] `/api/health` fully green

Payment items ticked above were verified in **test mode**. Gmail delivery,
ticket-page access, QR redemption, and health were rehearsed against production
on 29 July. The three marked Stripe events are covered by tests but have never
seen a real Stripe payload — close those with `stripe trigger`. A live purchase
and refund remain unverified.

---

## Remaining work

**Phase 3 — hot takes.** Submission form (name, title, 5 slides via the existing R2 upload pipeline), presenter view with a 5–8 minute countdown and speaker queue, and the stretch goal that makes it a game: live audience voting before and after each take, then "did they change your mind?" The multiplayer engine in `features/things/shared` already does live rooms. Follow `things.spelling-party_.$roomId_.present.tsx`.

**Effect migration** (task #8). Events and tickets are the reference implementation. Remaining: words, media, transfers, reports, best-dressed, downloads, system. **Auth last and separately** — it is the security-critical path. Weigh the risk first: `effect` is pinned to `4.0.0-beta.99`, and spreading a prerelease across every module widens the blast radius of a breaking bump.

**E2E tests.** [testing.md](./testing.md) says these become necessary once events are paid. They now are. Nothing exercises a real camera, a real offline transition, or a real payment redirect. Known gap, not a considered decision.

**No door sales, no waitlist, no wallet passes.** All deliberate deferrals.

---

## Event economics — the number that decides the night

London Caribbean/African catering is **£16–30 per head** with **£900–1,800 minimum spends**. At 70 people that is £1,120 at the floor, against roughly £1,365 net from 70 × £20 tickets. **An all-in £20 ticket with catering loses money.** Break-even is £25–33.

The fix is structural, not a discount: **sell food as a separate ticket type** — £15 entry, £15 entry-plus-plate. It turns catering from a fixed cost into a variable one and removes the risk of catering 80 when 55 turn up. Costs nothing to build — it is a second ticket type, and the admin panel already reports sold-count per type, which is the number you read to the caterer.

Modelled: £15 + £15 add-on at ~60% attachment ≈ **+£278**. Flat £20 all-in ≈ **−£440**.

---

## Open questions

1. **Refund cutoff** — default is self-serve until doors open. Not confirmed.
2. **Events index layout** — currently a chronological list. A month grid was rejected as mostly-empty on mobile at one event a month.
3. **Door sales** — deferred, but revisit before the first paid night.
4. **Slide editor for hot takes** — submission-only assumed.
5. **`docs/secrets.md`** — offered, not written. Referenced by a comment in `~/.zshrc`.
