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

  it("parses content formatting, tokens, safe links, and media", () => {
    const rendered = renderCommunicationMessage({
      kind: "newsletter",
      subject: "{{event.title}} · {{event.date}}",
      body: "## Hello **{{recipient.name}}**\n\n- First point\n- [Visit the contact page]({{links.contact}})\n\nA literal <tag> stays escaped.\n\n[Unsafe link](javascript:alert(1))",
      media: [
        {
          kind: "video",
          url: "https://milkandhenny.com/media/walking.mp4",
          posterUrl: "https://milkandhenny.com/media/walking-poster.jpg",
          alt: "A walking guide",
        },
        {
          kind: "image",
          url: "//evil.example/image.jpg",
          alt: "Unsafe image",
        },
      ],
      origin: "https://milkandhenny.com",
      context: { event, recipientName: "Owen" },
    });

    expect(rendered.subject).toContain("After School Club — First Bell");
    expect(rendered.subject).toContain("Tuesday, 1 September 2026");
    expect(rendered.html).toContain("<h2");
    expect(rendered.html).toContain("<strong>Owen</strong>");
    expect(rendered.html).toContain("<ul");
    expect(rendered.html).toContain("Visit the contact page");
    expect(rendered.html).toContain('href="https://milkandhenny.com/contact"');
    expect(rendered.html).toContain("&lt;tag&gt;");
    expect(rendered.html).toContain("Unsafe link");
    expect(rendered.html).not.toContain("Unsafe link)");
    expect(rendered.html).not.toContain("javascript:alert");
    expect(rendered.html).not.toContain("//evil.example/image.jpg");
    expect(rendered.html).toContain("walking-poster.jpg");
    expect(rendered.html).toContain("walking.mp4");
    expect(rendered.text).toContain("First point");
    expect(rendered.text).toContain("Visit the contact page (https://milkandhenny.com/contact)");
    expect(rendered.text).toContain("Unsafe link");
    expect(rendered.text).not.toContain("Unsafe link)");
    expect(rendered.text).not.toContain("javascript:alert");
    expect(rendered.text).not.toContain("**");
  });
});
