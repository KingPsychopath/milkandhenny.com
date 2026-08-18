import { describe, it, expect } from "vitest";

/**
 * Unit tests for calendar generation.
 *
 * The address is the thing being protected, so the two projections are
 * tested as a pair: what a stranger downloads must never contain what a
 * ticket holder's download does.
 */

import {
  buildEventIcs,
  buildPublicIcsOptions,
  buildTicketHolderIcsOptions,
} from "@/features/events/ics";
import { threeWordMapUrl } from "@/features/events/types";
import type { EventRecord } from "@/features/events/types";

const EVENT: EventRecord = {
  slug: "apartment-life",
  title: "Apartment Life",
  tagline: "One room, six acts",
  status: "published",
  startsAt: "2026-09-12T18:30:00.000Z",
  endsAt: "2026-09-12T23:00:00.000Z",
  doorsAt: "2026-09-12T18:00:00.000Z",
  lastEntryAt: "2026-09-12T20:00:00.000Z",
  timezone: "Europe/London",
  area: "East London",
  venueName: "The Front Room",
  address: "14 Example Road, London E8 1AA",
  doorCode: "4821",
  threeWordHint: "///plant.window.stairs",
  transportNote: "Two minutes from London Fields",
  lineup: [],
  ticketTypes: [],
  waitlistEnabled: false,
  transferable: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const EVENT_URL = "https://milkandhenny.com/events/apartment-life";
const TICKET_URL = "https://milkandhenny.com/ticket/tkt_abc123";

/** Unfold before asserting: RFC 5545 wraps at 75 octets mid-word. */
function unfold(ics: string): string {
  return ics.replace(/\r\n /g, "");
}

describe("public calendar entry", () => {
  const ics = unfold(buildEventIcs(EVENT, buildPublicIcsOptions(EVENT, EVENT_URL)));

  it("gives the area and nothing finer", () => {
    expect(ics).toContain("LOCATION:East London");
  });

  it("withholds every private location field", () => {
    expect(ics).not.toContain("Example Road");
    expect(ics).not.toContain("The Front Room");
    expect(ics).not.toContain("4821");
    expect(ics).not.toContain("plant.window.stairs");
  });

  it("does not set a reminder for someone who has not bought", () => {
    expect(ics).not.toContain("BEGIN:VALARM");
  });
});

describe("ticket holder calendar entry", () => {
  const ics = unfold(
    buildEventIcs(
      EVENT,
      buildTicketHolderIcsOptions(EVENT, { eventUrl: EVENT_URL, ticketUrl: TICKET_URL }),
    ),
  );

  it("puts the venue and address in LOCATION", () => {
    expect(ics).toContain("LOCATION:The Front Room\\, 14 Example Road\\, London E8 1AA");
  });

  it("carries what the door actually needs", () => {
    expect(ics).toContain("Venue door code: 4821");
    expect(ics).toContain("Find it: ///plant.window.stairs");
    expect(ics).toContain("Last entry");
  });

  it("points the entry at the ticket, not the marketing page", () => {
    expect(ics).toContain(`URL:${TICKET_URL}`);
    expect(ics).toContain(`Your ticket: ${TICKET_URL}`);
    expect(ics).toContain(`Event page: ${EVENT_URL}`);
  });

  it("sets a reminder two hours out", () => {
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("TRIGGER:-PT120M");
    expect(ics).toContain("END:VALARM");
  });

  it("keeps the UID stable so a second add updates rather than duplicates", () => {
    const fromEventPage = unfold(buildEventIcs(EVENT, buildPublicIcsOptions(EVENT, EVENT_URL)));
    const uid = /UID:(.+)/.exec(ics)?.[1];
    expect(uid).toBeTruthy();
    expect(fromEventPage).toContain(`UID:${uid}`);
  });
});

describe("holder entry without a ticket link", () => {
  it("falls back to the event page", () => {
    const ics = unfold(
      buildEventIcs(EVENT, buildTicketHolderIcsOptions(EVENT, { eventUrl: EVENT_URL })),
    );
    expect(ics).toContain(`URL:${EVENT_URL}`);
    expect(ics).toContain("Venue door code: 4821");
  });
});

describe("an event with no private detail", () => {
  it("still produces a valid entry", () => {
    const bare: EventRecord = { ...EVENT };
    delete bare.venueName;
    delete bare.address;
    delete bare.doorCode;
    delete bare.threeWordHint;
    delete bare.transportNote;

    const ics = unfold(
      buildEventIcs(bare, buildTicketHolderIcsOptions(bare, { eventUrl: EVENT_URL })),
    );
    expect(ics).toContain("LOCATION:East London");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("door code");
  });
});

describe("three-word hints", () => {
  it("recognises an address with or without slashes", () => {
    expect(threeWordMapUrl("///plant.window.stairs")).toBe(
      "https://what3words.com/plant.window.stairs",
    );
    expect(threeWordMapUrl("plant.window.stairs")).toBe(
      "https://what3words.com/plant.window.stairs",
    );
    expect(threeWordMapUrl("  ///plant.window.stairs  ")).toBe(
      "https://what3words.com/plant.window.stairs",
    );
  });

  it("leaves a prose hint alone", () => {
    expect(threeWordMapUrl("the blue door past the chippy")).toBeNull();
    expect(threeWordMapUrl("plant.window")).toBeNull();
    expect(threeWordMapUrl("plant.window.stairs.extra")).toBeNull();
    expect(threeWordMapUrl(undefined)).toBeNull();
  });

  it("carries the link into a holder's calendar entry", () => {
    const ics = unfold(
      buildEventIcs(EVENT, buildTicketHolderIcsOptions(EVENT, { eventUrl: EVENT_URL })),
    );
    expect(ics).toContain("https://what3words.com/plant.window.stairs");
  });
});
