import { describe, expect, it } from "vitest";

import {
  __waitlistTesting,
  waitlistInventorySnapshot,
} from "@/features/event-waitlist/waitlist.server";
import type { EventRecord } from "@/features/events/types";
import type { TicketCapacitySnapshot } from "@/features/tickets/capacity.server";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  const now = new Date();
  return {
    slug: "waitlist-night",
    title: "Waitlist Night",
    status: "published",
    startsAt: new Date(now.getTime() + 86_400_000).toISOString(),
    timezone: "Europe/London",
    lineup: [],
    ticketTypes: [
      {
        id: "entry",
        name: "Entry",
        priceMinor: 0,
        currency: "GBP",
        quantity: 10,
        perPersonLimit: 4,
        hidden: false,
      },
      {
        id: "vip",
        name: "VIP",
        priceMinor: 0,
        currency: "GBP",
        quantity: 10,
        perPersonLimit: 4,
        hidden: false,
      },
    ],
    capacity: 10,
    waitlistEnabled: true,
    transferable: false,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

const emptyCapacity = (): TicketCapacitySnapshot => ({
  sold: {},
  checkoutReserved: {},
  exchangeReserved: {},
});

function candidate(
  id: string,
  ticketTypeId: string | null,
  confirmedAt: Date,
): Parameters<typeof __waitlistTesting.selectNotifications>[0]["candidates"][number] {
  return {
    id,
    event_slug: "waitlist-night",
    scope_kind: ticketTypeId ? "ticket-type" : "event",
    ticket_type_id: ticketTypeId,
    scope_label: ticketTypeId === "entry" ? "Entry" : ticketTypeId === "vip" ? "VIP" : null,
    ticket_type_name: ticketTypeId === "entry" ? "Entry" : ticketTypeId === "vip" ? "VIP" : null,
    email: `${id}@example.com`,
    email_hash: "a".repeat(64),
    status: "active",
    confirmation_version: 1,
    confirmed_at: confirmedAt,
    notified_at: null,
    left_at: null,
    created_at: confirmedAt,
    updated_at: confirmedAt,
  };
}

describe("event waitlist inventory", () => {
  it("treats event capacity as one shared pool across ticket types", () => {
    const capacity = emptyCapacity();
    capacity.sold = { entry: 5, vip: 4 };
    const inventory = waitlistInventorySnapshot(event(), capacity);

    expect(inventory.eventAvailable).toBe(1);
    expect(inventory.byType).toEqual({ entry: 1, vip: 1 });
    expect(inventory.sharedCapacityBinding).toBe(true);
  });

  it("exposes independent ticket allocations when no event cap binds them", () => {
    const inventory = waitlistInventorySnapshot(event({ capacity: undefined }), emptyCapacity());

    expect(inventory.eventAvailable).toBe(20);
    expect(inventory.byType).toEqual({ entry: 10, vip: 10 });
    expect(inventory.sharedCapacityBinding).toBe(false);
  });

  it("does not alert while sales are manually sold out or the waitlist is disabled", () => {
    expect(
      waitlistInventorySnapshot(event({ status: "sold-out" }), emptyCapacity()).eventAvailable,
    ).toBe(0);
    expect(
      waitlistInventorySnapshot(event({ waitlistEnabled: false }), emptyCapacity()).eventAvailable,
    ).toBe(0);
  });
});

describe("event waitlist notification planning", () => {
  it("uses FIFO and sends only one alert when one shared place opens", () => {
    const now = Date.now();
    const candidates = [
      candidate("00000000-0000-4000-8000-000000000001", "entry", new Date(now - 3_000)),
      candidate("00000000-0000-4000-8000-000000000002", null, new Date(now - 2_000)),
      candidate("00000000-0000-4000-8000-000000000003", "vip", new Date(now - 1_000)),
    ];
    const selected = __waitlistTesting.selectNotifications({
      event: event(),
      inventory: {
        eventAvailable: 1,
        byType: { entry: 1, vip: 1 },
        sharedCapacityBinding: true,
      },
      previous: { event: 0, "ticket:entry": 0, "ticket:vip": 0 },
      candidates,
    });

    expect(selected.map((selection) => selection.row.id)).toEqual([candidates[0]!.id]);
  });

  it("can alert one person per independently replenished ticket type", () => {
    const now = Date.now();
    const candidates = [
      candidate("00000000-0000-4000-8000-000000000011", "entry", new Date(now - 2_000)),
      candidate("00000000-0000-4000-8000-000000000012", "vip", new Date(now - 1_000)),
    ];
    const selected = __waitlistTesting.selectNotifications({
      event: event({ capacity: undefined }),
      inventory: {
        eventAvailable: 2,
        byType: { entry: 1, vip: 1 },
        sharedCapacityBinding: false,
      },
      previous: { event: 0, "ticket:entry": 0, "ticket:vip": 0 },
      candidates,
    });

    expect(selected.map((selection) => selection.row.id)).toEqual(candidates.map(({ id }) => id));
  });

  it("never repeats an alert when availability has not increased", () => {
    const row = candidate("00000000-0000-4000-8000-000000000021", "entry", new Date());
    const selected = __waitlistTesting.selectNotifications({
      event: event(),
      inventory: {
        eventAvailable: 1,
        byType: { entry: 1, vip: 1 },
        sharedCapacityBinding: true,
      },
      previous: { event: 1, "ticket:entry": 1, "ticket:vip": 1 },
      candidates: [row],
    });

    expect(selected).toEqual([]);
  });

  it("retains an unused opening until a pending person confirms", () => {
    const row = candidate("00000000-0000-4000-8000-000000000031", "entry", new Date());
    const selected = __waitlistTesting.selectNotifications({
      event: event(),
      inventory: {
        eventAvailable: 1,
        byType: { entry: 1, vip: 0 },
        sharedCapacityBinding: true,
      },
      previous: { event: 1, "ticket:entry": 1, "ticket:vip": 0 },
      credits: { event: 1, "ticket:entry": 1, "ticket:vip": 0 },
      candidates: [row],
    });

    expect(selected.map((selection) => selection.row.id)).toEqual([row.id]);
  });
});
