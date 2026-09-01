# Event-night readiness ledger

Status: evidence snapshot completed at commit `9f42dbb7` on 1 September 2026

This file records what was demonstrated for that tree. It does not certify the current branch,
deployment, venue, devices, or staff. Re-run the affected software and physical checks before each
material event and record new evidence in a new audit rather than changing old results silently.

This ledger covers the reachable event-night product surface. It partitions inputs into
equivalence classes (valid, invalid, expired, replayed, unauthorised, concurrent, offline, and
reconnected) rather than claiming to enumerate an infinite set of literal strings, timings, and
device combinations.

## Evidence levels

- **BROWSER** — operated directly in isolated browser identities and observed the resulting UI.
- **API/DB** — exercised through the real service boundary and checked against durable state.
- **TEST** — covered by a passing focused unit, integration, or browser journey.
- **PHYSICAL** — requires a real camera, phone sensors, venue network, printer, or human judgement.
- **OPEN** — not confirmed; must not be described as ready.

For the recorded snapshot, all TEST evidence referenced here passed in the final full run: 204
files and 1,448 tests. The
serial Chromium event-night suite passed all 12 journeys. Typecheck, zero-warning lint, format,
and the production build also passed.

## Global invariants

| Invariant                              | Expected result                                                                                    | Status                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------- |
| Durable mutable truth                  | PostgreSQL/Redis remains authoritative; browser state is only a cache or recovery aid.             | API/DB + TEST           |
| Retry safety                           | Repeating the same command ID never applies a second mutation.                                     | API/DB + TEST           |
| Stale response safety                  | An older snapshot never replaces a newer confirmed revision.                                       | TEST                    |
| Realtime fast path                     | A committed score/room action reaches connected clients without waiting for normal polling.        | BROWSER + API/DB + TEST |
| Reconciliation fallback                | Missed streams, reconnects, visibility changes, and network recovery fetch authoritative state.    | BROWSER + TEST          |
| Client request bounds                  | Polling has a hard minimum gap and request deadline; 4xx responses are not retried.                | TEST                    |
| Production persistence failure         | Required persistence fails closed rather than inventing in-memory production truth.                | TEST                    |
| One active multiplayer room per device | Starting another live room returns the device to its existing room instead of splitting authority. | BROWSER + TEST          |
| Private response caching               | Tickets, locations, identities, staff credentials, and scores are not stored by shared caches.     | TEST                    |
| Accessibility recovery                 | Missing/error pages provide back/home recovery and interactive controls expose semantic names.     | BROWSER + TEST          |

## Roles and authority

| Actor                        | Allowed                                                                                                            | Must be refused                                                        | Status                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------- |
| Anonymous visitor            | View published public events, buy available tickets, join public game flows.                                       | Draft/private data, ticket-holder location, admin/staff mutations.     | TEST                    |
| Ticket viewer                | View the explicitly opened valid ticket and order navigation.                                                      | Awarding points or assuming another attendee identity.                 | BROWSER + TEST          |
| Active ticket player         | Receive game/staff points for one selected ticket per event.                                                       | Two active scoring identities for the same event/device.               | BROWSER + API/DB + TEST |
| Verified account holder      | Recover email-linked tickets, event totals, and eligible staff access.                                             | Tickets or staff grants belonging to another identity.                 | TEST                    |
| Invigilator / points marshal | Search/scan within scope, award configured points, use assigned pool, issue one-use QR.                            | Activities, events, or permissions outside the assignment.             | BROWSER + API/DB + TEST |
| Door scanner                 | Resolve signed/rotated ticket references and consume only configured allowances.                                   | Wrong-event, void, malformed, revoked, or expired credentials.         | API/DB + TEST           |
| Game host/operator           | Create/start/control only a room for which it holds host/operator authority.                                       | Stranger control, duplicate action, or leaked private player state.    | BROWSER + TEST          |
| Admin                        | Configure events, tickets, scanners, scoring, games, communications, and corrections after authentication/step-up. | Anonymous access and named-admin actions outside explicit permissions. | BROWSER + TEST          |

An invigilator may also hold and play a ticket. Staff authority is an additional scoped grant; it
does not replace or merge with the attendee participant identity.

## Ticket lifecycle and account invariants

| State/action partition              | Expected result                                                                                               | Status                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Draft/archived event                | Omitted from public event listings and sales.                                                                 | TEST                    |
| Published and on sale               | Correct ticket types, price, stock, sales window, and per-person limit are enforced.                          | TEST                    |
| Sold out/concurrent last ticket     | Exactly one final reservation succeeds; capacity cannot be oversold.                                          | API/DB + TEST           |
| Hidden ticket type/crafted quantity | Hidden types and fractional, negative, excessive, or malformed quantities are rejected.                       | TEST                    |
| Checkout hold                       | Holds count against event/type/person capacity and expire or settle consistently.                             | API/DB + TEST           |
| Paid issuance retry                 | Payment/webhook retries issue the intended tickets exactly once.                                              | API/DB + TEST           |
| Valid ticket view                   | QR, holder, event details, calendar link, score and order navigation render.                                  | BROWSER + TEST          |
| Multi-ticket order                  | Each person has a distinct link/QR; switching tickets is explicit; personal and order totals remain distinct. | BROWSER + API/DB + TEST |
| Total presentation                  | Personal balance and managed-order total update together (for example 9 and 18).                              | BROWSER + TEST          |
| Ticket QR tamper/malformed          | Wrong signature, wrong ID, junk, unknown version and foreign ticket are rejected.                             | TEST                    |
| Admission                           | First valid scan admits once; a replay reports already admitted without a second mutation.                    | API/DB + TEST           |
| Void/refunded/cancelled             | Admission, handoff, scoring selection and new claims are refused as product rules require.                    | API/DB + TEST           |
| Transfer/handoff                    | Pending and accepted transfers preserve authority versioning; rotation invalidates the old public credential. | API/DB + TEST           |
| Account recovery                    | Email access requires deliberate confirmation and only returns matching tickets/grants.                       | BROWSER + TEST          |
| Account event points                | Current tickets expose per-ticket points and event/order totals where scoring is enabled.                     | BROWSER + TEST          |
| Cancellation                        | Public state prioritises cancellation; attendee ticket operations and new handoffs stop.                      | TEST                    |

## Door, checkpoint, and scanner invariants

| Iteration                                 | Expected result                                                               | Status         |
| ----------------------------------------- | ----------------------------------------------------------------------------- | -------------- |
| Signed ticket at correct event/checkpoint | Resolve holder/order and consume exactly the requested allowed quantity.      | API/DB + TEST  |
| Simultaneous final scans                  | Database serialisation prevents over-consumption.                             | API/DB + TEST  |
| Peek (`consume=0`)                        | Returns entitlement without reducing it.                                      | API/DB + TEST  |
| Undo                                      | Restores exactly one previously consumed unit.                                | API/DB + TEST  |
| Single-scan station                       | Every request is clamped to one unit.                                         | API/DB + TEST  |
| Per-ticket-type override                  | Override wins; otherwise checkpoint default applies. Zero means not included. | API/DB + TEST  |
| Multi-ticket order scan                   | Scanner shows what the rest of the order still has.                           | API/DB + TEST  |
| Wrong event / void / malformed token      | Refused without changing usage.                                               | API/DB + TEST  |
| Rotated/revoked/expired scanner link      | Old or expired credential cannot operate; current scoped credential can.      | API/DB + TEST  |
| Camera unavailable                        | Manual ticket/code entry remains available.                                   | BROWSER + TEST |
| Physical QR/camera lighting and focus     | Real phones scan printed and screen QRs reliably at the venue.                | PHYSICAL       |

## Scoring state machine

| State/action              | Expected result                                                                | Status                  |
| ------------------------- | ------------------------------------------------------------------------------ | ----------------------- |
| Off                       | Public scoring reads as unavailable and writes are no-ops/refused.             | API/DB + TEST           |
| Ready                     | Configuration exists but normal awards are not accepted.                       | TEST                    |
| Live                      | Valid scoped staff, game, discovery and check-in awards commit.                | BROWSER + API/DB + TEST |
| Frozen                    | Incoming automatic results are held; ledger is not silently changed.           | API/DB + TEST           |
| Resume                    | Held results can be accepted once, using their original durable receipt.       | API/DB + TEST           |
| Closed                    | Normal awards stop; authorised correction is explicit/provisional and audited. | API/DB + TEST           |
| Scheduled transitions     | Offset-aware instants move states at the configured boundary.                  | API/DB + TEST           |
| Leaderboard hidden        | Personal points remain visible while public rankings are withheld.             | BROWSER + TEST          |
| Leaderboard visible/final | Rank rules are deterministic; ties use standard competition ranking.           | TEST                    |

## Staff and invigilator scoring

| Iteration                               | Expected result                                                                              | Status                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------- |
| Search by name/alias/suffix             | Returns only event participants, with ticket and order context.                              | BROWSER + TEST          |
| Recent participant shortcut             | Re-fetches current balance/order total before reopening the card.                            | BROWSER + TEST          |
| Scan ticket                             | Selects the valid event participant; manual entry remains available without camera.          | TEST                    |
| Preset one-ticket award                 | One tap applies configured points once and shows remaining pool.                             | BROWSER + API/DB + TEST |
| Preset whole-order award                | One explicit scope choice awards every active valid ticket atomically.                       | BROWSER + API/DB + TEST |
| Custom award                            | Requires an integer positive value and a reason; large values require confirmation.          | TEST                    |
| Placement/raw/participation/fixed rules | Server converts the configured rule revision; old results do not change when rules change.   | TEST                    |
| Requires check-in                       | Award is refused until participant is checked in.                                            | API/DB + TEST           |
| Repeat/cooldown/once rules              | Same participant/activity obeys the configured repeat boundary under concurrency.            | API/DB + TEST           |
| Activity/event scope                    | Assignment cannot award another activity or event.                                           | API/DB + TEST           |
| Shared pool                             | Concurrent marshals cannot spend beyond issued points.                                       | API/DB + TEST           |
| Device revocation                       | Revoked device stops while the assignment and other devices remain valid.                    | API/DB + TEST           |
| Offline reservation                     | Fixed server budget queues signed scans, reconciles each command once, and cannot overspend. | API/DB + TEST           |
| Optional photo failure                  | Score commit remains independent; media failure does not roll back accepted points.          | API/DB + TEST           |
| Reverse award                           | One exact opposite posting is linked; repeat reversal cannot double-reverse.                 | API/DB + TEST           |
| Rapid repetition                        | Durable award still follows rules and anomaly is flagged for human review.                   | API/DB + TEST           |

## Quick-award QR

| Iteration                                     | Expected result                                                                                   | Status                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------- |
| Active player + fresh QR                      | Correct selected participant claims automatically and sees one takeover plus inline confirmation. | BROWSER + API/DB + TEST |
| Viewer with one opened ticket                 | That ticket can claim explicitly/automatically according to session state.                        | TEST                    |
| Multiple opened tickets without active player | User must deliberately choose the recipient ticket.                                               | TEST                    |
| No ticket/session                             | User is told to open an event ticket first.                                                       | BROWSER + TEST          |
| Concurrent claim                              | Exactly one claimant wins.                                                                        | API/DB + TEST           |
| Replay by same/other attendee                 | Reports already claimed; no balance changes.                                                      | BROWSER + API/DB + TEST |
| Expired QR                                    | Reports expired and cannot mutate the ledger.                                                     | API/DB + TEST           |
| Wrong event/token/malformed token             | Refused without mutation or participant disclosure.                                               | TEST                    |

## Realtime score notification

| Invariant                  | Expected result                                                                               | Status          |
| -------------------------- | --------------------------------------------------------------------------------------------- | --------------- |
| Commit ordering            | Notification is emitted only after the durable score transaction commits.                     | API/DB + TEST   |
| Ticket isolation           | Only the affected ticket session receives its participant notification.                       | TEST            |
| Single takeover            | Ticket route has exactly one complementary score-update surface, not duplicate overlays.      | BROWSER + TEST  |
| Balance and order total    | Personal balance, managed-order total, and takeover total use the same authoritative refresh. | BROWSER + TEST  |
| Reconnect/missed stream    | Five-second bounded reconciliation eventually returns the confirmed revision.                 | TEST            |
| Large notification payload | Falls back to an event-wide wake-up before PostgreSQL's notification limit.                   | TEST            |
| Redis backplane            | Production starts with the shared realtime backplane enabled.                                 | Production logs |

## Automatic game scoring

| Iteration              | Expected result                                                                 | Status                  |
| ---------------------- | ------------------------------------------------------------------------------- | ----------------------- |
| Linked official result | Active binding and linked player produce the configured award.                  | BROWSER + API/DB + TEST |
| Identical retry        | Receipt/idempotency prevents duplicate points.                                  | API/DB + TEST           |
| New result revision    | Correction applies the delta rather than stacking an unrelated award.           | BROWSER + API/DB + TEST |
| Cancellation           | Previous game award is reversed to zero exactly once.                           | BROWSER + API/DB + TEST |
| Reopen                 | New authoritative revision restores the correct award.                          | BROWSER + API/DB + TEST |
| Frozen event           | Receipt is held and can be retried/accepted after resume.                       | API/DB + TEST           |
| Unclaimed player       | Event-local placeholder is created without guessing identity from weak signals. | API/DB + TEST           |
| Player claim           | Signed claim links the official result to the correct participant.              | API/DB + TEST           |

## Games

| Game             | Directly observed journey                                                                                                            | Engine/recovery edge classes                                                                                                                      | Status                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Family Feud      | Isolated TV, MC and buzzer; answer/strike/score state stayed in sync through refresh.                                                | Host authority, team claims/caps, audio unavailable/mute, custom decks.                                                                           | BROWSER + TEST                      |
| Hot and Cold     | Mobile daily guesses, rapid input and mobile keyboard submission.                                                                    | History, judging revisions, corrupt recovery, community privacy threshold.                                                                        | BROWSER + TEST                      |
| Centre           | Solo screen, ready/give-up recovery UI.                                                                                              | Lost join response, simultaneous start, wall-cross rejection, verified finish/DNF, official result.                                               | BROWSER (partial) + API/DB + TEST   |
| Same Brain       | Three isolated roles joined, answered, refreshed and revealed together.                                                              | Score rules, room recovery and identity isolation.                                                                                                | BROWSER + TEST                      |
| Twin             | Solo wrong taps added cooldown/penalty; correct shared symbol advanced 20 to 19.                                                     | Lost join, whole-deck invariants, heat timeout, rematch, credential refusal, private hands.                                                       | BROWSER + API/DB + TEST             |
| Liars            | Five isolated players read private-role gates, selected distinct night actions, resolved attack/save, reached shared day discussion. | Role minima, parity, all role actions, ties/abstain, rematch/control transfer, reconnect and stranger refusal.                                    | BROWSER + API/DB + TEST             |
| Pitch Night      | Created, saved, published, presented and remotely controlled a deck.                                                                 | Concurrent media allowance, sealed public edition, trash/restore/history, presentation recovery.                                                  | BROWSER + API/DB + TEST             |
| Draw the Country | Solo draw screen, timer and recovery controls rendered.                                                                              | Geometry scoring, deterministic maze/shape data, room joins and authoritative scoring. Pointer-drag completion still needs physical/manual input. | BROWSER (partial) + TEST + PHYSICAL |
| Spelling Bee     | Started countdown, heard/rendered a word, marked correct and advanced to the next word.                                              | Content, closeness, input variants, audio unavailable and session recovery.                                                                       | BROWSER + TEST                      |
| Forehead         | Started countdown, marked correct, passed, score changed, and end-round confirmation protected progress.                             | Deck/options, sensor and button fallback, remote judge. Real tilt needs a phone.                                                                  | BROWSER + TEST + PHYSICAL           |
| Icebreaker       | Two isolated devices revealed colours, used camera fallback code, paired Emerald × Sapphire and saved Deep Sea.                      | Self-scan, duplicate pairing, colour stability, malformed/corrupt ledger and bounded history.                                                     | BROWSER + TEST                      |
| Spelling Party   | Two isolated clients joined, typed and locked CAT, simultaneously revealed February and both answers.                                | Lost join, private drafts, auto-lock, clue attribution, reconnect, close/grace period.                                                            | BROWSER + API/DB + TEST             |

## Admin and moderation

| Iteration                            | Expected result                                                                                         | Status         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------- |
| Anonymous admin access               | Password/local-dev gate is shown; workspace data is not rendered.                                       | BROWSER + TEST |
| Authenticated workspace              | Events, scoring, games, people/support, communications, system and policy areas load.                   | BROWSER + TEST |
| Named admin least privilege          | Effective grants merge safely; content-only/admin-specific actions remain scoped.                       | TEST           |
| Destructive step-up                  | Sensitive mutations require a fresh named-admin/passkey step-up.                                        | TEST           |
| Event validation                     | Invalid times, timezone, capacities, ticket types, URLs and publish prerequisites are rejected.         | TEST           |
| Capacity edits                       | Admin cannot lower capacity below active tickets and checkout/exchange commitments.                     | API/DB + TEST  |
| Scoring control                      | Event slug must be selected; state, activities, staff, pools, corrections and audit stay event-scoped.  | BROWSER + TEST |
| Corrections/merge/split/pseudonymise | Immutable postings remain auditable while projections/identity change deliberately.                     | API/DB + TEST  |
| Guest requests                       | Pending requests are bounded; one concurrent decision wins; decline issues nothing.                     | API/DB + TEST  |
| Communications                       | Delivery plans/outbox remain idempotent and scheduler-backed; event targeting does not leak recipients. | TEST           |
| Operational alerts                   | Queue depth, scoring anomalies and thresholds are deterministic and visible privately.                  | API/DB + TEST  |

## Endpoint register

Every route below is covered by its feature-level authority and state invariants above. A route
being listed does not mean every literal payload is valid; invalid shape, auth, state, expiry,
replay, conflict and server-failure partitions are the required boundary classes.

### Admin event endpoints — TEST

- `/api/admin/events`
- `/api/admin/events/:slug`
- `/api/admin/events/:slug/tickets`
- `/api/admin/events/:slug/checkpoints`
- `/api/admin/events/:slug/scanner-links`
- `/api/admin/events/:slug/scoring`
- `/api/admin/events/:slug/guest-requests`
- `/api/admin/events/:slug/waitlist`
- `/api/admin/events/:slug/email`
- `/api/admin/events/:slug/drop`

### Ticket and attendee endpoints — BROWSER + API/DB + TEST

- `/ticket/:id`
- `/api/tickets/:id/session`
- `/api/tickets/:id/identity`
- `/api/tickets/:id/ics`
- `/api/tickets/:id/score`
- `/api/tickets/:id/score/profile`
- `/api/tickets/:id/score/events`
- `/api/tickets/:id/score/notifications`
- `/api/attendee/ticket-operations`

### Public event/scoring endpoints — BROWSER + API/DB + TEST

- `/events/:slug`
- `/events/:slug/bought`
- `/events/:slug/score`
- `/events/:slug/staff/:token`
- `/events/:slug/award/:token`
- `/events/:slug/discoveries`
- `/events/:slug/discoveries/:discoveryId`
- `/events/:slug/game-result-claim`
- `/api/events/:slug/score`
- `/api/events/:slug/award-claims/:token`
- `/api/events/:slug/discoveries/:discoveryId`
- `/api/events/:slug/discoveries/:discoveryId/claim`
- `/api/events/:slug/discoveries/claim`
- `/api/events/:slug/game-results/claim`
- `/api/events/:slug/game-results/group-claims`
- `/api/events/:slug/ics`

### Scanner endpoints — API/DB + TEST; camera path PHYSICAL

- `/scan`
- `/scan/:token`
- `/play/:token`

## Remaining physical rehearsal checklist

These items are deliberately not marked confirmed by simulated browsers:

- Scan every production QR format from both a printed page and another phone under venue light.
- Confirm camera permission denial, later permission grant, front/back camera choice, focus and
  low-battery behaviour on representative iOS and Android devices.
- Complete Centre and Draw the Country with real touch paths; test accidental palm contact,
  orientation change and screen-edge gestures.
- Confirm Forehead and Spelling Bee tilt gestures on devices with and without motion permission;
  verify button fallbacks remain usable.
- Run the venue Wi-Fi rehearsal with one device dropping offline during an award and reconnecting.
- Print and scan the actual event's ticket/checkpoint/discovery pack.
- Rehearse the human runbook: lost phone, wrong guest selected, reversal reason, depleted pool,
  frozen scoring, staff device revocation and escalation to an admin.

No software-only audit can truthfully convert these physical/human items into confirmed results.
