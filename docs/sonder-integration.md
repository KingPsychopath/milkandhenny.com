# Sonder event integration

Sonder owns sales, refunds, admission tickets and door scanning for an explicitly mapped event.
Milk & Henny mirrors orders, purchaser contacts and ticket/check-in counts, keeps every booking
on one team, and sends a separate team/colour email to its purchaser. The purchaser shares that
message with their group. Other events retain native checkout, tickets and staff tools.

## Activation, once Mehedi confirms setup

This implementation is prepared locally; production deployment and the real purchase test are
separate steps. Confirm Sonder activation, the agreed fee, event date, hangout UUID and public
booking URL with Mehedi. The guide offers no hangout discovery endpoint.

Deploy migration `0123_sonder_event_integration` and the application together. Confirm the migration's
actual name in `lib/platform/migrations.server.ts` before using deployment tooling. In the event
operations panel, map a fresh occurrence to its Sonder UUID, booking URL and explicit mode matching the deployment. An
occurrence with native ticket, checkout or waitlist history cannot switch providers. Hangout and
mode are immutable once mapped; deletion requires an explicit future handover migration.

The proposed production receiving URL is `https://milkandhenny.com/api/sonder/webhook`. It is only
available after deployment. The owner connects it in Sonder and stores the resulting credentials
without putting their values in chat or source control. The guide only provides the read key when
connecting/replacing the receiving URL; it does not document API-key-only setup.

| Environment variable            | Purpose                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `SONDER_MODE`                   | Explicit `test` or `live`; unset disables the receiver and reads                                |
| `SONDER_WEBHOOK_SIGNING_SECRET` | Complete secret, including `whsec_`, for raw-body signature verification                        |
| `SONDER_WEBHOOK_API_KEY`        | Separate read-only host integration API key                                                     |
| `SONDER_TEAM_EMAILS_ENABLED`    | Must be exactly `true` to allow live guest email queuing and delivery; leave off until verified |

Use Bitwarden's project/environment collection. Suggested provider/item names are
`milkandhenny-prod-railway-sonder-signatures-read` and
`milkandhenny-prod-railway-sonder-orders-read`, corresponding to the two secret variables above.
Give production credentials an expiry of at most one year, review usage and revoke after this
one-off integration is retired. Agents do not issue or retrieve production credentials.

Verify Sonder's test delivery, then run a full order sync. Verify a real authorised purchase in the
live portal against order, quantity and purchaser details in our panel. Check Sonder admission
updates, refunds, cancellation, group allocation, the exact email preview and one authorised
email delivery before enabling wider sends. Automated fixtures do not prove the live contract.

## Operator workflow

The Sonder panel replaces native ticket operations for the mapped occurrence. It displays the
last successful full sync, freshness/errors, active and checked-in counts, purchaser bookings,
per-currency gross/refund amounts and team sizes. These amounts are order totals, not payouts.

1. Sync the current orders. The scheduler also reconciles due events every minute, with normal
   full reads about every five minutes. A failed read preserves the last known figures visibly.
2. Choose two, three or four coloured teams and allocate whole bookings. New bookings go to the
   smallest team; previous assignments stay put. Uneven teams are possible because groups remain
   intact. Manual moves affect the entire booking, never one ticket.
3. Preview the exact purchaser emails and queue the approved preview. Team/email content changes
   need a new preview. Check-in changes alone do not resend identical messages. Delivery rechecks
   current booking eligibility, team details, event details and freshness. Suppressed purchasers
   are skipped without blocking other groups; queued/accepted/cancelled/failed counts are visible
   in the panel. After a cancellation, sync and preview again to requeue eligible unsent messages.

CLI parity uses the same authenticated application API:

```sh
pnpm cli events sonder show <event-slug>
pnpm cli events sonder sync <event-slug>
```

Other actions use `POST /api/admin/events/<event-slug>/sonder` with `action` equal to `configure`,
`allocate`, `assign`, `review`, `preview` or `send`. The UI applies the same permissions: event
management for setup/allocation; communications management for preview/send; operations access
for all reads. Responses containing contacts are private and non-cacheable.

## Consistency and recovery

The receiver verifies the timestamp and HMAC over exact raw bytes before parsing. It checks mode,
version and matching event IDs, durably deduplicates metadata, and makes the mapped event due for
reconciliation. Persistence failures return non-2xx; duplicates return 2xx. QR credentials and raw
webhook bodies are never stored. Unknown signed event types are retained as metadata only.

Orders are read from the documented paginated `/v1/host-integration/hangouts/<uuid>/orders` API.
All pages must succeed before an atomic local update. A fenced lease prevents stale workers from
committing; webhook revisions keep a read dirtied during pagination due for another sync. There
is no provider freeze/snapshot guarantee. Missing orders, ticket ownership conflicts and unsafe
status reversals are held for review, rather than silently reassigned or counted as eligible.
A resolved ownership/status conflict can be explicitly acknowledged against its current revision.
Missing orders and provider review states need a subsequent resolved Sonder snapshot.

Valid and checked-in tickets count as active. Partial refunds/review states deactivate the entire
booking as the guide specifies; the app does not infer individual refunded tickets. Cancellation
is sticky and suppresses eligibility and email delivery. The mirror never issues a native entry QR
or modifies Sonder admission/refunds. Staff are directed to Sonder's scanner for entry.

A 401 pauses automatic reads and exposes the error. A 429 schedules backoff. After reconnecting,
run a full sync: Sonder reconnects discard queued deliveries and deliver future events only. A
manual sync can recover a paused mapping once the owner restores access. Never treat webhook
arrival order as payment/refund truth.

## Retention

Thirty days after the event's end (or start when no end is set), the scheduler removes purchaser
names/emails from order snapshots, pauses the mirror and cancels unsent team messages. Counts,
team assignments and non-contact provider identifiers remain. Webhook metadata expires after
30 days. Accepted communication history follows the existing email outbox retention policy;
this integration does not promise to erase a message already delivered to a provider or recipient.

## Local verification before activation

- `pnpm check` and `pnpm build` pass on the pinned toolchain.
- Focused real-Postgres/unit verification covers signatures, pagination, cancellation and review,
  ticket moves/omissions, whole-booking allocation, archived-team recovery, suppressed recipients,
  stale previews and delivery guards, contact retention, provider-switch races and native ticketing.
- Playwright verifies the purchaser/count/team preview panel, disabled sends, public Sonder CTA,
  native ticket tools and the existing hydrated event/invitation journeys.
- Claude reviewed the implementation and its recovery corrections. Review findings were checked
  against the supplied guide and owning code, rather than accepted as proof of behaviour.
- A production migration/deployment, real provider credentials and the live purchase/check-in/email
  proof remain unperformed. Keep guest sending disabled until those checks succeed.

The final local full suite ran 2,256 tests: 2,222 passed and 34 failed. All 34 failure names
match an unchanged HEAD baseline run of the four transfer suites; their expired fixtures are
outside this integration. The focused integration/native-ticketing/permissions/scheduler run
passed 72 tests, and the three selected Playwright journeys passed. CI and the live provider
proof remain separate from these local results.
