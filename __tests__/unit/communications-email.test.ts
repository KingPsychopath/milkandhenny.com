import { describe, expect, it } from "vitest";

import type { EventRecord } from "@/features/events/types";
import { renderCommunicationMessage } from "@/features/communications/email.server";

const event = {
  slug: "after-school-club-2026-09-01",
  title: "After School Club — First Bell",
  status: "published",
  startsAt: "2026-09-01T18:00:00.000Z",
  doorsAt: "2026-09-01T18:00:00.000Z",
  timezone: "Europe/London",
  venueName: "Common Sense Studios",
  address: "Unit 10, Common Sense Studios, Cable Depot Workshops, Warspite Road, London SE18 5NX",
  lineup: [],
  ticketTypes: [],
  waitlistEnabled: false,
  transferable: true,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
} as EventRecord;

describe("communication email rendering", () => {
  it("resolves link tokens, keeps the address tidy, and places media after the copy", () => {
    const rendered = renderCommunicationMessage({
      kind: "event_service",
      subject: "Getting there",
      body: "Here is the practical bit.\n\n## Where\n\n**{{event.venue}}**\n{{event.address}}\n\n## Timing\n\n{{event.timing}}\n\n[Practise your spelling]({{links.spellingGame}})",
      media: [
        {
          kind: "gif",
          url: "https://milkandhenny.com/media/walking.gif",
          alt: "A walking guide",
        },
      ],
      origin: "https://milkandhenny.com",
      meta: event.title,
      context: { event },
    });

    expect(rendered.html).not.toContain("{{");
    expect(rendered.html).toContain("https://milkandhenny.com/things/spelling-bee");
    expect(rendered.html).toContain("Unit 10, Cable Depot Workshops");
    expect(rendered.html).not.toContain("Unit 10, Common Sense Studios,");
    expect(rendered.html.indexOf("Here is the practical bit")).toBeLessThan(
      rendered.html.indexOf("https://milkandhenny.com/media/walking.gif"),
    );
    expect(rendered.text).not.toContain("**");
    expect(rendered.text).toContain(
      "Practise your spelling (https://milkandhenny.com/things/spelling-bee)",
    );
  });

  it("does not repeat the start time when doors and the event start together", () => {
    const rendered = renderCommunicationMessage({
      kind: "event_service",
      subject: "Today",
      body: "## Timing\n\n{{event.timing}}",
      origin: "https://milkandhenny.com",
      context: { event },
    });

    expect(rendered.text).toContain("Doors open: 19:00");
    expect(rendered.text).not.toContain("Starts:");
  });
});
