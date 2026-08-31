# Events Platform

Public events, ticketing, and door check-in for milk & henny.

This document is the spec. It replaces the ad-hoc party/guestlist surfaces built for the first birthday.

---

## Scope

| Building                                                            | Deleting                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `features/events` — event model, public pages, admin CRUD           | `features/guests` — the guestlist shim                            |
| `features/tickets` — issuance, signed QR, redemption, door UI       | `src/routes/guestlist.tsx`                                        |
| `lib/platform/email.server.ts` — provider-neutral email adapter     | `src/routes/api/guests/*`, `src/routes/api/admin/guests/*`        |
| `lib/platform/stripe.server.ts` — provider-neutral payments adapter | `src/routes/party.tsx` component (the URL survives as a redirect) |
| Hot-takes submissions + presenter view                              | `public/guests.csv` and the CSV bootstrap path                    |

Everything follows the layer ownership in [architecture.md](./architecture.md): routes own transport and coarse auth, `*.functions.ts` owns server-function boundaries, `*.server.ts` owns workflows and durable rules, `lib/platform` owns external adapters.

Visual language is [design-language.md](./design-language.md) — warm stone, mono UI chrome, serif prose, single amber accent. The old party page's zinc gradients and emoji buttons do not come across.

---

## Standing assumptions

These are decisions taken to keep momentum. Both are cheap to reverse; neither blocks anything before Phase 2.

1. **No door sales in v1.** Selling at the door turns the scanner into a point-of-sale — cash handling, on-the-spot Stripe terminal or payment link, reconciliation. Deferred.
2. **Hot takes is submission-only in v1.** No slide editor. People submit five slides; we present them. The presenter view is the valuable, reusable half and it gets built either way.

---

## Event model

| Group    | Fields                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Identity | `id`, `slug`, `title`, `tagline`, `status` (`draft` / `published` / `sold-out` / `cancelled` / `archived`)                        |
| When     | `startsAt` (UTC), `endsAt`, `doorsAt`, `lastEntry`, `timezone`                                                                    |
| Where    | `area` (public), `venueName`, `address`, `doorCode`, `threeWordHint`, `mapUrl`, `stepFreeAccess`, `transportNote`                 |
| What     | `description` (markdown), `lineup[]`, `runOfShow[]`, `dressCode`, `ageLimit`, `houseRules`                                        |
| Media    | `heroImage` (R2), `ogImage`                                                                                                       |
| Tickets  | `ticketTypes[]`: `name`, `price`, `currency`, `quantity`, `salesStart`, `salesEnd`, `perPersonLimit`, `accessCode`, `description` |
| Capacity | `capacity`, `waitlistEnabled`                                                                                                     |
| Policy   | `refundPolicy`, `transferable`, `terms`                                                                                           |
| Ops      | `checkInOpensAt`, `staffNotes` (private)                                                                                          |
| Links    | attached things (spelling bee room, hot-takes deck)                                                                               |

Times are stored UTC and rendered in the venue timezone. Everything under **Where** except `area` is gated behind ticket ownership.

### Storage

```text
Postgres
  events                event records and capacity
  ticket_types          ticket inventory and sales rules
  tickets               issued tickets and redemptions
  checkout_sessions     Stripe idempotency and payment state

Redis
  authentication, rate limits, room state, wake fan-out, and short-lived indexes
```

Postgres is authoritative for events, ticket types, tickets, redemptions, and
checkout state. Capacity and single admission are enforced by database
transactions and constraints. Redis remains the source for short-lived
sessions, rate limits, multiplayer state, and wake delivery; one key per record
remains the rule for Redis data that is still mutable and independently read.

The old guestlist put every guest in a single `guest:list` key and that shape
produced [the KV read spike](./postmortem-guestlist-kv-read-spike.md). Door
scanning is far more read-heavy than that page ever was, so the retired
collection shape must not return.

---

## Ticketing

### Issuance

Stripe's webhook issues the ticket — **not** the success redirect, because people close the tab. `checkout.session.completed`, signature-verified against the raw body, deduped on `session.id`. `charge.refunded` voids. Free events skip Stripe entirely and call the same issuance function, so there is one code path.

Comps and guestlist adds are zero-price tickets. Plus-ones hang off a parent ticket. There is no separate "guest" concept.

### QR

The payload is signed: `ticketId.eventId.hmac`.

This is a deliberate both-belts design because venue wifi is unreliable. The signature lets a scanner verify authenticity with no network. The server round-trip marks redemption, which is the only way to catch a duplicate scan. Offline, accept signature-valid tickets and queue redemptions to sync — see `features/offline`.

Reuse `hooks/useQrCode` for rendering and `features/things/icebreaker/IcebreakerQrScanner.tsx` for scanning. Both already work.

### Door UI

Scanner-first, name search as fallback. The old guestlist was search-first, which is the slow path when there's a queue. Reuse the existing `staff` auth role.

Must handle: duplicate scans, plus-ones, walk-up comps, and "resend my ticket" by email.

### Client rules carried over from the postmortem

These are load-bearing, and the door client will be more read-heavy than the page that caused the incident:

- Ref-stable callbacks, so parent re-renders can't restart polling effects.
- A minimum fetch gap as a hard floor, independent of the intended poll rate.
- Never retry 4xx. Only network errors and 5xx.

---

## Payments

Hosted Stripe Checkout. Not a custom card form — hosted Checkout surfaces Apple Pay and Google Pay automatically on mobile, which is most of the "minimal clicks" goal, and it keeps card data entirely out of this codebase.

```text
/events/$slug  ->  server fn creates Checkout Session  ->  Stripe  ->  /ticket/$id
```

`/t/$id` is already taken by transfers, so tickets live at `/ticket/$id`.

Stripe sends the payment receipt. We send only the ticket. That halves send volume and keeps receipt compliance on Stripe's side.

---

## Email

Cloudflare Email Service, behind the same platform-adapter boundary as Redis and S3. It is already on the project's DNS and R2 account and configures SPF, DKIM, and DMARC.

### Sold-out waitlists

Waitlists are verified, one-shot availability alerts rather than ticket reservations. A person
chooses either the whole event or one sold-out ticket type, enters an email address, and confirms
that address from a signed management link. One live scope is allowed per email and event.

Availability is reconciled after admin inventory edits and by the application scheduler, so
refunds, expired checkout holds, ticket-type changes, and replica/process failures converge on the
same workflow. Confirmed entries are selected FIFO and the batch is capped to newly available
places; a single returned ticket must not blast the entire list. Event capacity is treated as one
shared pool even when several ticket types could consume the same place.

The entry state transition and outbox insert share one Postgres transaction. Outbox idempotency
keys make both confirmation and availability staging safe to retry, while the normal email worker
owns provider retries, suppression, delivery feedback, retention, and operational visibility.
After one availability alert the entry leaves the active queue. The email says clearly that no
ticket is held and the person may join again if they miss it.

Two Cloudflare specifics:

- Sending to arbitrary recipients requires Workers Paid. The free tier only reaches verified addresses in your own account.
- The daily quota is undisclosed and ramps with sending history. Set the account up early and let low-volume traffic run through it before the first event.

Use a **scoped API token** for email only. Not the Global API Key, not the R2 keys.

### Domain split

|                 | Domain                     | Shape          | If it lands in spam  |
| --------------- | -------------------------- | -------------- | -------------------- |
| Ticket delivery | `tickets.milkandhenny.com` | Drips, ~10/day | Someone can't get in |
| Announcements   | anything else              | Spiky, bulk    | Mildly annoying      |

These must not share a sending domain. Bulk mail earns spam complaints, complaints tank domain reputation, and the mail that suffers is the mail that must arrive.

Ticket emails are text-first with a link to the ticket page. Image blocking is normal and Gmail clips long HTML — the QR is a convenience, the link is the ticket.

---

## Phases

| Phase | Scope                                                                                                                            | Ships for                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **0** | Event model, `/events`, `/events/$slug`, admin CRUD, nav link, `/party` redirect, `.ics`, `Event` JSON-LD, per-event OG, sitemap | —                        |
| **1** | Free ticket issuance, signed QR, scanner, door check-in, email adapter. Guestlist deleted.                                       | **DJ set**               |
| **2** | Stripe Checkout, webhook issuance, refunds, waitlist, sold-out                                                                   | Spelling bee / hot takes |
| **3** | Hot-takes submissions, presenter view + timer, live audience voting                                                              | Hot takes night          |
| **4** | Spelling bee hardening, wallet passes, post-event tooling                                                                        | Later                    |

The DJ set is deliberately the test event. Free tickets, real QRs, real door — the entire flow rehearsed at zero financial risk before Phase 2 introduces money.

---

## Hot takes

Submission form: name, hot-take title, and either five uploaded images/PDF pages or five pasted text slides. Reuses the existing upload and R2 pipeline.

Presenter view is the reusable piece: fullscreen, tap/keyboard advance, large 5–8 minute countdown, speaker queue, title card between speakers. Follow `src/routes/things.spelling-party_.$roomId_.present.tsx`.

The stretch goal is the actual game: audience votes agree/disagree before and after each take, then "did they change your mind?" The multiplayer room engine in `features/things/shared` already supports live rooms.

---

## Non-code work that blocks taking money

- Stripe business details, VAT on tickets, absorb-vs-pass-on fees
- Refund policy and T&Cs page. UK distance-selling generally exempts dated events, but the policy must exist in writing.
- Privacy policy update — now holding names, emails, payment references. Retention window and deletion path. Event photo consent.
- Duty of care — venue legal capacity vs configured cap, 18+ door ID, step-free access info. The "if someone says no, it means no" line from the old party page survives somewhere.
- Door runbook — dead batteries, two scanners at once, name changes, no-shows, what staff do on a duplicate scan.
- Post-event — photos into `/pics`, attendee export, revenue reconciliation against Stripe payouts.

---

## Best-dressed

Best-dressed voting used to validate names against the standalone guest list. That list
is gone, so it now reads ticket-holder names via `features/best-dressed/attendees.server.ts`.

It has no event of its own, so it resolves to the nearest live event — the soonest
upcoming one, falling back to the most recent past one so voting keeps working during
and just after a night. If best-dressed ever needs to run for a specific event rather
than "whatever is on", that resolution is the single place to change.

## Rehearsal checklist

Before the first event that matters:

- [x] Stripe test mode: buy, receive, scan, refund, confirm void
- [x] Ticket email lands in the Gmail personal inbox
- [ ] Ticket email lands in the inbox on iCloud and Outlook
- [ ] Scanner works with the venue wifi off, and the queued scans sync when it returns
- [x] Production redemption admits once, rejects a duplicate, and rejects a forged signature
- [ ] Cloudflare daily quota confirmed above expected volume
- [x] `/api/health` reports email as a configured capability
