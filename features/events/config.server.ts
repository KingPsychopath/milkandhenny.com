/**
 * Redis key layout for events and tickets.
 *
 * One key per record. The legacy guest list kept every guest in a single
 * key, which is what produced the KV read spike documented in
 * `docs/postmortem-guestlist-kv-read-spike.md`. Door scanning is far more
 * read-heavy than that page ever was, so that shape is not repeated here.
 */

const EVENT_META_PREFIX = "events:meta:";
const EVENT_INDEX_KEY = "events:index";

const TICKET_META_PREFIX = "tickets:meta:";
const TICKET_EVENT_INDEX_PREFIX = "events:tickets:";
const TICKET_REDEEMED_PREFIX = "tickets:redeemed:";
const TICKET_EMAIL_INDEX_PREFIX = "events:tickets-by-email:";
const TICKET_TYPE_SOLD_PREFIX = "events:sold:";
const TICKET_RESEND_RL_PREFIX = "tickets:resend-rl:";
const TICKET_CLAIM_RL_PREFIX = "tickets:claim-rl:";

/** Tickets outlive the event; they are receipts. Nothing here is ever TTL'd. */
function eventMetaKey(slug: string): string {
  return `${EVENT_META_PREFIX}${slug}`;
}

function ticketMetaKey(id: string): string {
  return `${TICKET_META_PREFIX}${id}`;
}

function ticketEventIndexKey(slug: string): string {
  return `${TICKET_EVENT_INDEX_PREFIX}${slug}`;
}

/** Atomic single-use guard. Presence means redeemed. */
function ticketRedeemedKey(id: string): string {
  return `${TICKET_REDEEMED_PREFIX}${id}`;
}

/** Keyed by a hash of the email, never the address itself. */
function ticketEmailIndexKey(slug: string, emailHash: string): string {
  return `${TICKET_EMAIL_INDEX_PREFIX}${slug}:${emailHash}`;
}

/** Counter per ticket type so quantity checks do not scan the ticket set. */
function ticketTypeSoldKey(slug: string): string {
  return `${TICKET_TYPE_SOLD_PREFIX}${slug}`;
}

function ticketResendRateLimitKey(emailHash: string): string {
  return `${TICKET_RESEND_RL_PREFIX}${emailHash}`;
}

function ticketClaimRateLimitKey(ip: string): string {
  return `${TICKET_CLAIM_RL_PREFIX}${ip}`;
}

const RESEND_RATELIMIT_WINDOW_SECONDS = 15 * 60;
const RESEND_RATELIMIT_MAX = 5;
const CLAIM_RATELIMIT_WINDOW_SECONDS = 60 * 60;
const CLAIM_RATELIMIT_MAX = 20;

export {
  EVENT_INDEX_KEY,
  eventMetaKey,
  ticketMetaKey,
  ticketEventIndexKey,
  ticketRedeemedKey,
  ticketEmailIndexKey,
  ticketTypeSoldKey,
  ticketResendRateLimitKey,
  ticketClaimRateLimitKey,
  RESEND_RATELIMIT_WINDOW_SECONDS,
  RESEND_RATELIMIT_MAX,
  CLAIM_RATELIMIT_WINDOW_SECONDS,
  CLAIM_RATELIMIT_MAX,
};
