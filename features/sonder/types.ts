export const SONDER_MODES = ["live", "test"] as const;
export type SonderMode = (typeof SONDER_MODES)[number];
export type SonderTicket = {
  id: string;
  ordinal: number;
  status: "valid" | "checked_in" | "inactive";
  checked_in_at: string | null;
};
export type SonderOrder = {
  hangout_id: string;
  order_id: string;
  status: string;
  purchaser: { name: string | null; email: string };
  ticket_type: { id: string; name: string };
  quantity: number;
  currency: string;
  amount_total_minor: number;
  amount_refunded_minor: number;
  paid_at: string | null;
  refunded_at: string | null;
  review_required: boolean;
  tickets: SonderTicket[];
};
export type SonderEvent = {
  id: string;
  version: 1;
  type: string;
  mode: SonderMode;
  occurred_at: string;
  hangoutId: string | null;
  cancelledAt: string | null;
};
export type SonderMapping = {
  hangoutId: string;
  mode: SonderMode;
  bookingUrl: string;
  cancelledAt: string | null;
};
export function isSonderMode(value: unknown): value is SonderMode {
  return value === "live" || value === "test";
}
export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
function invalid(): never {
  throw new Error("Invalid Sonder payload");
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) return invalid();
  return value;
}
function uuid(value: unknown): string {
  return isUuid(value) ? value.toLowerCase() : invalid();
}
function integer(value: unknown, minimum = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
    ? value
    : invalid();
}
export function nullableInstant(value: unknown): string | null {
  if (value === null) return null;
  const candidate = text(value, 60);
  return /^\d{4}-\d\d-\d\dT/.test(candidate) && Number.isFinite(Date.parse(candidate))
    ? new Date(candidate).toISOString()
    : invalid();
}
export function parseSonderOrder(value: unknown): SonderOrder {
  const row = object(value),
    buyer = object(row.purchaser),
    type = object(row.ticket_type);
  if (typeof row.review_required !== "boolean" || !Array.isArray(row.tickets)) return invalid();
  const tickets = row.tickets.map((value): SonderTicket => {
    const ticket = object(value);
    if (ticket.status !== "valid" && ticket.status !== "checked_in" && ticket.status !== "inactive")
      return invalid();
    // Admission QR credentials are deliberately omitted from the stored mirror.
    return {
      id: uuid(ticket.id),
      ordinal: integer(ticket.ordinal, 1),
      status: ticket.status,
      checked_in_at: nullableInstant(ticket.checked_in_at),
    };
  });
  const quantity = integer(row.quantity, 1);
  if (
    tickets.length !== quantity ||
    new Set(tickets.map((t) => t.id)).size !== quantity ||
    new Set(tickets.map((t) => t.ordinal)).size !== quantity
  )
    return invalid();
  const email = text(buyer.email, 254).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid();
  const currency = text(row.currency, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return invalid();
  return {
    hangout_id: uuid(row.hangout_id),
    order_id: uuid(row.order_id),
    status: text(row.status, 80),
    purchaser: { name: buyer.name === null ? null : text(buyer.name), email },
    ticket_type: { id: uuid(type.id), name: text(type.name) },
    quantity,
    currency,
    amount_total_minor: integer(row.amount_total_minor),
    amount_refunded_minor: integer(row.amount_refunded_minor),
    paid_at: nullableInstant(row.paid_at),
    refunded_at: nullableInstant(row.refunded_at),
    review_required: row.review_required,
    tickets,
  };
}
const ORDER_EVENTS = new Set([
  "order.paid",
  "order.refunded",
  "order.updated",
  "ticket.checked_in",
]);
export function parseSonderEvent(value: unknown, eventId: string, mode: SonderMode): SonderEvent {
  const row = object(value);
  if (row.version !== 1 || row.mode !== mode || uuid(row.id) !== uuid(eventId)) return invalid();
  const type = text(row.type, 100),
    occurred = nullableInstant(row.occurred_at);
  if (!occurred) return invalid();
  let hangoutId: string | null = null,
    cancelledAt: string | null = null;
  if (ORDER_EVENTS.has(type)) {
    const order = parseSonderOrder(row.data);
    hangoutId = order.hangout_id;
    if (
      type === "ticket.checked_in" &&
      !order.tickets.some((t) => t.id === uuid(object(row.data).ticket_id))
    )
      return invalid();
  } else if (type === "hangout.cancelled") {
    const data = object(row.data);
    hangoutId = uuid(data.hangout_id);
    cancelledAt = nullableInstant(data.cancelled_at);
    if (!cancelledAt) return invalid();
  } else if (type === "webhook.test") {
    if (typeof object(row.data).message !== "string") return invalid();
  } else if (row.data && typeof row.data === "object" && !Array.isArray(row.data)) {
    const data = object(row.data);
    if (isUuid(data.hangout_id)) hangoutId = uuid(data.hangout_id);
  }
  return {
    id: uuid(row.id),
    version: 1,
    mode,
    type,
    occurred_at: occurred,
    hangoutId,
    cancelledAt,
  };
}
export function activeSonderTicket(
  order: Pick<SonderOrder, "review_required" | "status">,
  ticket: SonderTicket,
  cancelled = false,
): boolean {
  return (
    !cancelled &&
    !order.review_required &&
    order.status !== "needs_review" &&
    (ticket.status === "valid" || ticket.status === "checked_in")
  );
}
/** Assign a whole booking to the smallest team. Existing bookings never move implicitly. */
export function chooseBookingTeam(teams: readonly { id: string; size: number }[]): string | null {
  return [...teams].sort((a, b) => a.size - b.size || a.id.localeCompare(b.id))[0]?.id ?? null;
}
export function validSonderBookingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "findsonder.app" || url.hostname.endsWith(".findsonder.app"))
    );
  } catch {
    return false;
  }
}
