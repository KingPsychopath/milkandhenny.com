import { describe, expect, it } from "vitest";

import {
  markTicketArrivalHandoffOffered,
  shouldOfferTicketArrivalHandoff,
  ticketArrivalHandoffStorageKey,
  wasTicketArrivalHandoffOffered,
} from "@/features/tickets/ticket-arrival-handoff.client";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("ticket arrival handoff", () => {
  it("offers the automatic icebreaker only for a new live check-in", () => {
    expect(
      shouldOfferTicketArrivalHandoff({
        checkedInOnLoad: false,
        alreadyOffered: false,
        redeemedAt: "2026-08-31T18:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      shouldOfferTicketArrivalHandoff({
        checkedInOnLoad: true,
        alreadyOffered: false,
        redeemedAt: "2026-08-31T18:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      shouldOfferTicketArrivalHandoff({
        checkedInOnLoad: false,
        alreadyOffered: true,
        redeemedAt: "2026-08-31T18:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      shouldOfferTicketArrivalHandoff({
        checkedInOnLoad: false,
        alreadyOffered: false,
      }),
    ).toBe(false);
  });

  it("remembers the offer for this ticket within the browser session", () => {
    const storage = memoryStorage();
    const ticket = "ticket_ref_123";

    expect(wasTicketArrivalHandoffOffered(storage, ticket)).toBe(false);
    markTicketArrivalHandoffOffered(storage, ticket);
    expect(wasTicketArrivalHandoffOffered(storage, ticket)).toBe(true);
    expect(storage.getItem(ticketArrivalHandoffStorageKey(ticket))).toBe("1");
  });

  it("fails open when browser storage is unavailable", () => {
    const unavailable = {
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("storage blocked");
      },
    };

    expect(wasTicketArrivalHandoffOffered(unavailable, "ticket")).toBe(false);
    expect(() => markTicketArrivalHandoffOffered(unavailable, "ticket")).not.toThrow();
  });
});
