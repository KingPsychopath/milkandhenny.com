import { describe, expect, it } from "vitest";

import { eventNightStatus, isCurrentEvent } from "@/features/event-operations/event-night";
import {
  eventLocalInputToIso,
  isoToEventLocalInput,
} from "@/features/event-operations/night-schedule";
import type { EventNightContext } from "@/features/event-operations/event-night.types";

const EVENT_TIME = Date.parse("2026-09-01T20:00:00.000Z");

function context(overrides: Partial<EventNightContext> = {}): EventNightContext {
  return {
    eventSlug: "event-night",
    eventTitle: "Event night",
    eventStatus: "published",
    startsAt: new Date(EVENT_TIME).toISOString(),
    ticketId: "ticket-public-id",
    participantId: "participant-id",
    holderName: "Guest",
    active: true,
    checkedIn: false,
    savedToAccount: false,
    points: 7,
    revision: 2,
    scoringState: "live",
    selectedAt: new Date(EVENT_TIME - 1_000).toISOString(),
    ...overrides,
  };
}

describe("event-night attendee state", () => {
  it("shows event navigation only inside its bounded event-night window", () => {
    const ticket = context({
      doorsAt: new Date(EVENT_TIME - 60 * 60 * 1_000).toISOString(),
      endsAt: new Date(EVENT_TIME + 4 * 60 * 60 * 1_000).toISOString(),
    });

    expect(isCurrentEvent(ticket, EVENT_TIME - 7 * 60 * 60 * 1_000 - 1)).toBe(false);
    expect(isCurrentEvent(ticket, EVENT_TIME)).toBe(true);
    expect(isCurrentEvent(ticket, EVENT_TIME + 17 * 60 * 60 * 1_000)).toBe(false);
    expect(isCurrentEvent(context({ eventStatus: "cancelled" }), EVENT_TIME)).toBe(false);
  });

  it.each([
    [{ rejected: 1, pending: 0 }, true, {}, "one claim needs help"],
    [{ rejected: 0, pending: 2 }, true, {}, "2 claims saved · confirming"],
    [{ rejected: 0, pending: 0 }, true, { eventStatus: "cancelled" }, "event cancelled"],
    [{ rejected: 0, pending: 0 }, false, {}, "7 confirmed · offline"],
    [{ rejected: 0, pending: 0 }, true, { active: false }, "choose the ticket receiving points"],
    [
      { rejected: 0, pending: 0 },
      true,
      { scoringState: "ready" },
      "points ticket selected · scoring not open",
    ],
    [{ rejected: 0, pending: 0 }, true, { scoringState: "frozen" }, "7 confirmed · scoring frozen"],
    [{ rejected: 0, pending: 0 }, true, { checkedIn: true }, "7 confirmed · checked in"],
  ] as const)("renders one authoritative status %#", (claims, online, overrides, expected) => {
    expect(eventNightStatus(context(overrides), online, claims)).toBe(expected);
  });
});

describe("event-night schedule time fields", () => {
  it("round-trips London summer and winter wall-clock values", () => {
    expect(eventLocalInputToIso("2026-09-01T19:00", "Europe/London")).toBe(
      "2026-09-01T18:00:00.000Z",
    );
    expect(eventLocalInputToIso("2026-12-01T19:00", "Europe/London")).toBe(
      "2026-12-01T19:00:00.000Z",
    );
    expect(isoToEventLocalInput("2026-09-01T21:55:00.000Z", "Europe/London")).toBe(
      "2026-09-01T22:55",
    );
  });

  it("rejects a local time skipped by daylight-saving time", () => {
    expect(() => eventLocalInputToIso("2026-03-29T01:30", "Europe/London")).toThrow(
      "does not exist",
    );
  });
});
