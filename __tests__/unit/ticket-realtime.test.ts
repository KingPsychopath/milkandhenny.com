import { describe, expect, it } from "vitest";

import { parseTicketRealtimeEvent } from "@/features/tickets/ticket-realtime";

describe("ticket realtime event", () => {
  it("accepts a complete check-in wake and rejects malformed payloads", () => {
    expect(
      parseTicketRealtimeEvent({
        eventSlug: "arrival-night",
        ticketId: "01ARZ3NDEKTSV0001",
        kind: "checked-in",
        occurredAt: "2026-08-31T18:00:00.000Z",
      }),
    ).toMatchObject({ kind: "checked-in" });
    expect(parseTicketRealtimeEvent({ eventSlug: "arrival-night", kind: "checked-in" })).toBeNull();
    expect(
      parseTicketRealtimeEvent({
        eventSlug: "arrival-night",
        ticketId: "x",
        kind: "other",
        occurredAt: "now",
      }),
    ).toBeNull();
  });
});
