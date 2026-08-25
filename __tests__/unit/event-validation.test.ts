import { describe, it, expect } from "vitest";

/**
 * Unit tests for event normalisation and the sales-state machine.
 *
 * These are the rules that decide whether a stranger can buy a ticket, so
 * they are tested directly rather than through a route.
 */

import { buildAvailability } from "@/features/event-operations/event-page.server";
import { normaliseEventInput } from "@/features/events/events.server";
import {
  heroImageHeightClass,
  isEventHeroHeight,
  isPubliclyVisible,
  isUpcoming,
  isValidEventSlug,
  slugifyEventTitle,
  ticketTypeSalesState,
  toPublicEvent,
  toTicketHolderEvent,
  formatMoney,
  type EventRecord,
  type TicketType,
} from "@/features/events/types";

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
const LATER = new Date(Date.now() + 8 * 24 * 60 * 60 * 1_000).toISOString();

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "Apartment Life",
    startsAt: FUTURE,
    area: "East London",
    ticketTypes: [
      {
        id: "entry",
        name: "Entry",
        priceMinor: 0,
        currency: "GBP",
        quantity: 50,
        perPersonLimit: 2,
      },
    ],
    ...overrides,
  };
}

describe("slugs", () => {
  it("slugifies titles", () => {
    expect(slugifyEventTitle("Apartment Life — DJ Set!")).toBe("apartment-life-dj-set");
    expect(slugifyEventTitle("  Hot   Takes  ")).toBe("hot-takes");
  });

  it("strips diacritics rather than dropping the word", () => {
    expect(slugifyEventTitle("Café Night")).toBe("cafe-night");
  });

  it("validates slug shape", () => {
    expect(isValidEventSlug("apartment-life")).toBe(true);
    expect(isValidEventSlug("a")).toBe(false);
    expect(isValidEventSlug("Has-Caps")).toBe(false);
    expect(isValidEventSlug("trailing-")).toBe(false);
    expect(isValidEventSlug("../etc/passwd")).toBe(false);
  });
});

describe("normaliseEventInput", () => {
  it("accepts a valid draft", () => {
    const result = normaliseEventInput(validInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.slug).toBe("apartment-life");
      expect(result.value.status).toBe("draft");
      expect(result.value.timezone).toBe("Europe/London");
    }
  });

  it("requires a title", () => {
    const result = normaliseEventInput(validInput({ title: "   " }));
    expect(result.ok).toBe(false);
  });

  it("rejects an end time before the start", () => {
    const result = normaliseEventInput(validInput({ startsAt: LATER, endsAt: FUTURE }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/after the start/i);
  });

  it("rejects doors after the start time", () => {
    const result = normaliseEventInput(validInput({ doorsAt: LATER }));
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid timezone", () => {
    const result = normaliseEventInput(validInput({ timezone: "Mars/Olympus" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/IANA/i);
  });

  it("refuses to publish without ticket types", () => {
    const result = normaliseEventInput(validInput({ status: "published", ticketTypes: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ticket type/i);
  });

  it("refuses to publish without a public area", () => {
    const result = normaliseEventInput(validInput({ status: "published", area: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/area/i);
  });

  it("allows publishing when complete", () => {
    expect(normaliseEventInput(validInput({ status: "published" })).ok).toBe(true);
  });

  it("rejects duplicate ticket type ids", () => {
    const result = normaliseEventInput(
      validInput({
        ticketTypes: [
          {
            id: "entry",
            name: "A",
            priceMinor: 0,
            currency: "GBP",
            quantity: 1,
            perPersonLimit: 1,
          },
          {
            id: "entry",
            name: "B",
            priceMinor: 0,
            currency: "GBP",
            quantity: 1,
            perPersonLimit: 1,
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/duplicate/i);
  });

  it("rejects a sales window that closes before it opens", () => {
    const result = normaliseEventInput(
      validInput({
        ticketTypes: [
          {
            id: "entry",
            name: "Entry",
            priceMinor: 0,
            currency: "GBP",
            quantity: 1,
            perPersonLimit: 1,
            salesStart: LATER,
            salesEnd: FUTURE,
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("clamps negative prices and quantities rather than storing them", () => {
    const result = normaliseEventInput(
      validInput({
        ticketTypes: [
          {
            id: "entry",
            name: "Entry",
            priceMinor: -500,
            currency: "GBP",
            quantity: -10,
            perPersonLimit: 999,
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ticketTypes[0].priceMinor).toBe(0);
      expect(result.value.ticketTypes[0].quantity).toBe(0);
      expect(result.value.ticketTypes[0].perPersonLimit).toBe(20);
    }
  });

  it("preserves createdAt across an update", () => {
    const first = normaliseEventInput(validInput());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = normaliseEventInput({ title: "Renamed" }, first.value);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.createdAt).toBe(first.value.createdAt);
      expect(second.value.title).toBe("Renamed");
      // Unspecified fields survive a partial update.
      expect(second.value.area).toBe("East London");
    }
  });

  it("accepts a same-origin marketing story path", () => {
    const result = normaliseEventInput(validInput({ marketingPath: "/pitch-night" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.marketingPath).toBe("/pitch-night");
  });

  it("rejects an external marketing story URL", () => {
    const result = normaliseEventInput(
      validInput({ marketingPath: "https://tickets.example.com/phish" }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("hero height", () => {
  it("keeps a valid preset and rejects anything else", () => {
    const result = normaliseEventInput(validInput({ heroHeight: "medium" }));
    expect(result.ok && result.value.heroHeight).toBe("medium");

    const junk = normaliseEventInput(validInput({ heroHeight: "enormous" }));
    expect(junk.ok && junk.value.heroHeight).toBeUndefined();
  });

  it("keeps the existing height when an update omits it", () => {
    const existing = normaliseEventInput(validInput({ heroHeight: "short" }));
    expect(existing.ok).toBe(true);
    if (!existing.ok) return;

    const updated = normaliseEventInput(validInput(), existing.value);
    expect(updated.ok && updated.value.heroHeight).toBe("short");
  });

  it("constrains every preset but natural", () => {
    expect(heroImageHeightClass("natural")).toBe("");
    // An unset height must behave exactly as `natural` did before the field
    // existed, or publishing this would silently crop every current event.
    expect(heroImageHeightClass(undefined)).toBe("");
    for (const height of ["tall", "medium", "short"] as const) {
      expect(heroImageHeightClass(height)).toContain("object-cover");
      expect(heroImageHeightClass(height)).toMatch(/max-h-\[\d+svh\]/);
    }
  });

  it("guards the stored value", () => {
    expect(isEventHeroHeight("tall")).toBe(true);
    expect(isEventHeroHeight("TALL")).toBe(false);
    expect(isEventHeroHeight(null)).toBe(false);
  });
});

describe("event-wide capacity", () => {
  it("limits every ticket type by the remaining room capacity", () => {
    const result = normaliseEventInput(
      validInput({
        capacity: 3,
        ticketTypes: [
          {
            id: "entry",
            name: "Entry",
            priceMinor: 0,
            currency: "GBP",
            quantity: 10,
            perPersonLimit: 4,
          },
          {
            id: "guest",
            name: "Guest",
            priceMinor: 0,
            currency: "GBP",
            quantity: 10,
            perPersonLimit: 4,
          },
        ],
      }),
    );
    if (!result.ok) throw new Error(result.error);

    const availability = buildAvailability(result.value, { entry: 2, guest: 1 });
    expect(availability.map((entry) => entry.remaining)).toEqual([0, 0]);
    expect(availability.map((entry) => entry.sales.state)).toEqual(["sold-out", "sold-out"]);
  });
});

describe("location gating", () => {
  const event = {
    ...(
      normaliseEventInput(
        validInput({
          venueName: "The Flat",
          address: "1 Example Road",
          doorCode: "1234",
          staffNotes: "spare key under the mat",
        }),
      ) as { ok: true; value: EventRecord }
    ).value,
  };

  it("withholds address, door code and staff notes from the public projection", () => {
    const publicEvent = toPublicEvent(event);
    expect(publicEvent.locationRevealed).toBe(false);
    expect("address" in publicEvent).toBe(false);
    expect("doorCode" in publicEvent).toBe(false);
    expect("venueName" in publicEvent).toBe(false);
    expect("staffNotes" in publicEvent).toBe(false);
    // The public area is still shown — people need to know roughly where.
    expect(publicEvent.area).toBe("East London");
  });

  it("reveals the address to a ticket holder but never the staff notes", () => {
    const holderEvent = toTicketHolderEvent(event);
    expect(holderEvent.locationRevealed).toBe(true);
    expect(holderEvent.address).toBe("1 Example Road");
    expect(holderEvent.doorCode).toBe("1234");
    expect("staffNotes" in holderEvent).toBe(false);
  });
});

describe("sales state", () => {
  const type: TicketType = {
    id: "entry",
    name: "Entry",
    priceMinor: 1_000,
    currency: "GBP",
    quantity: 10,
    perPersonLimit: 2,
    hidden: false,
  };
  const base = { status: "published" as const, startsAt: FUTURE, endsAt: undefined };

  it("is on sale for an upcoming published event with stock", () => {
    expect(ticketTypeSalesState(base, type, 0).state).toBe("on-sale");
  });

  it("is sold out once the quantity is reached", () => {
    expect(ticketTypeSalesState(base, type, 10).state).toBe("sold-out");
  });

  it("closes once the event has passed", () => {
    const past = { ...base, startsAt: new Date(Date.now() - 1_000).toISOString() };
    expect(ticketTypeSalesState(past, type, 0).state).toBe("closed");
  });

  it("reports cancellation ahead of everything else", () => {
    expect(ticketTypeSalesState({ ...base, status: "cancelled" }, type, 0).state).toBe("cancelled");
  });

  it("honours a future sales window", () => {
    const result = ticketTypeSalesState(base, { ...type, salesStart: LATER }, 0);
    expect(result.state).toBe("not-yet");
  });
});

describe("helpers", () => {
  it("treats an event as upcoming until its end time", () => {
    expect(isUpcoming({ startsAt: FUTURE })).toBe(true);
    expect(isUpcoming({ startsAt: new Date(Date.now() - 10_000).toISOString() })).toBe(false);
  });

  it("hides drafts and archives from public listings", () => {
    expect(isPubliclyVisible({ status: "published" })).toBe(true);
    expect(isPubliclyVisible({ status: "sold-out" })).toBe(true);
    expect(isPubliclyVisible({ status: "cancelled" })).toBe(true);
    expect(isPubliclyVisible({ status: "draft" })).toBe(false);
    expect(isPubliclyVisible({ status: "archived" })).toBe(false);
  });

  it("formats money from minor units without floating point drift", () => {
    expect(formatMoney(0, "GBP")).toBe("Free");
    expect(formatMoney(1_000, "GBP")).toBe("£10");
    expect(formatMoney(1_050, "GBP")).toBe("£10.50");
  });
});
