import { describe, expect, it } from "vitest";

import { pickDefaultAdminEvent } from "@/features/admin/ui/components/event-admin-selection";
import type { EventRecord } from "@/features/events/types";

function event(
  slug: string,
  status: EventRecord["status"],
  startsAt: string,
  endsAt?: string,
): EventRecord {
  return {
    slug,
    title: slug,
    status,
    startsAt,
    endsAt,
    timezone: "Europe/London",
    lineup: [],
    ticketTypes: [],
    waitlistEnabled: false,
    transferable: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("default admin event selection", () => {
  it("prefers the nearest live or upcoming public event", () => {
    const events = [
      event("archived", "archived", "2026-08-01T18:00:00.000Z"),
      event("later", "published", "2026-09-10T18:00:00.000Z"),
      event("tonight", "sold-out", "2026-09-01T18:00:00.000Z"),
    ];

    expect(pickDefaultAdminEvent(events, new Date("2026-09-01T10:00:00.000Z"))?.slug).toBe(
      "tonight",
    );
  });

  it("falls back to the most recent public event, then a draft", () => {
    const past = [
      event("older", "published", "2026-07-01T18:00:00.000Z"),
      event("newer", "sold-out", "2026-08-01T18:00:00.000Z"),
      event("draft", "draft", "2026-09-10T18:00:00.000Z"),
    ];
    expect(pickDefaultAdminEvent(past, new Date("2026-09-20T10:00:00.000Z"))?.slug).toBe("newer");
    expect(
      pickDefaultAdminEvent(
        [event("draft", "draft", "2026-09-10T18:00:00.000Z")],
        new Date("2026-09-01T10:00:00.000Z"),
      )?.slug,
    ).toBe("draft");
  });
});
