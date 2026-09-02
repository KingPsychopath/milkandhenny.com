import { describe, expect, it } from "vitest";

import { searchDoorTickets } from "@/features/tickets/door-search";
import type { DoorTicketView } from "@/features/tickets/types";

function ticket(id: string, holderName: string, redeemedAt?: string): DoorTicketView {
  return {
    id,
    orderId: id,
    holderName,
    ticketTypeName: "Entry",
    kind: "paid",
    status: "valid",
    redeemedAt,
    isPlusOne: false,
  };
}

const tickets = [
  ticket("0123456789ABCDEF", "Owen Amenze"),
  ticket("1111111111111111", "Amara Okafor"),
  ticket("2222222222222222", "Amari Jones", "2026-09-01T19:00:00.000Z"),
];

describe("door ticket search", () => {
  it("finds names despite accents, spacing, and a one-character typo", () => {
    expect(searchDoorTickets(tickets, "owne")[0]?.holderName).toBe("Owen Amenze");
    expect(searchDoorTickets([ticket("3333333333333333", "José Silva")], "jose")).toHaveLength(1);
  });

  it("finds a ticket by a reference prefix", () => {
    expect(searchDoorTickets(tickets, "012345")[0]?.holderName).toBe("Owen Amenze");
  });

  it("puts an unredeemed close match before an already-admitted one", () => {
    expect(searchDoorTickets(tickets, "amara").map((entry) => entry.holderName)).toEqual([
      "Amara Okafor",
      "Amari Jones",
    ]);
  });
});
