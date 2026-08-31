export const TICKET_REALTIME_CHANNEL = "ticket_check_in_realtime";

export type TicketRealtimeEvent = {
  eventSlug: string;
  ticketId: string;
  kind: "checked-in" | "unchecked-in";
  occurredAt: string;
};

export function parseTicketRealtimeEvent(value: unknown): TicketRealtimeEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.eventSlug !== "string" ||
    typeof record.ticketId !== "string" ||
    (record.kind !== "checked-in" && record.kind !== "unchecked-in") ||
    typeof record.occurredAt !== "string"
  ) {
    return null;
  }
  return record as TicketRealtimeEvent;
}
