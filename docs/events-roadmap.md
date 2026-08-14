# Events platform roadmap

The platform should stay a small, dependable event operation rather than grow into a generic
ticketing marketplace. This roadmap orders work by what can lose money or hold up a door first.

## Phase 1 — sell and admit safely

- One bundled delivery email per order, with an inline first QR and a link to every ticket.
- Every ticket page can move through the other tickets in its order.
- Whole-order refunds invalidate every QR and send a separate confirmation email.
- Self-serve refunds stop when doors open or when anyone on the order has checked in.
- The scanner recognises an order and offers `check in all` or the scanned ticket only.
- Event capacity is enforced across all ticket types in the final database transaction.
- Paid checkout requires explicit acceptance; the accepted terms and refund-policy snapshot are
  stored with the Checkout session and copied into the delivery email.
- Event operations in admin show capacity, remaining tickets, check-in, net sales, refunds,
  attendee names, emails, references, and ticket links.
- Event admin can edit hero/social images, the full schedule, access and transport details, house
  rules, refund policy, and ticket terms.

## Phase 2 — operator controls

- Add or resend a comp from admin, with a deliberate and audited capacity override.
- Admin refund flow with step-up authentication, amount preview, and a clear block after check-in.
- Undo an accidental check-in from the attendee row.
- Configurable location visibility: `holders only` by default, or `public`, applied consistently to
  the page, calendar file, email, metadata, and maps.
- Durable transactional-email outbox with retries and provider-acceptance state. Completed.
- CSV export for door backup, reconciliation, and attendee support.

## Phase 3 — discovery and ownership

- Event search/typeahead once the index is large enough to need it.
- Named plus-ones, ticket transfer, and buyer-managed attendee names without changing the order
  owner or payment record.
- Waitlist promotion with expiring, capacity-safe offers.
- Apple Wallet and Google Wallet passes. These are signed pass products, not email attachments.
- Optional Stripe receipt link in the order view while Stripe remains the financial receipt owner.

## Phase 4 — the event as a first-class media object

- Pick hero and social images from the existing media library rather than pasting URLs.
- Attach a gallery before or after an event, then promote selected event photos into `/pics`.
- Event-specific social cards, post-event recap, no-show and arrival curves, and payout
  reconciliation.
- Door runbook mode: device readiness, offline status, last sync, second-scanner coordination, and
  an end-of-night closeout.

## Product boundaries

- A dated-event ticket normally does not get the general online-shopping cooling-off period, but
  customer-facing terms, refund rules, business/contact details, and a privacy notice still need to
  be clear. Obtain legal review before relying on the default copy for a material event.
- A scan is evidence that the service was used. A refund request after any admission becomes a
  human review; it does not automatically create a Stripe dispute.
- The exact address stays private unless the event explicitly opts into public location.
- PDF tickets are not the default. Links work across devices, the inline QR works with image
  blocking, and screenshots remain a door fallback.
