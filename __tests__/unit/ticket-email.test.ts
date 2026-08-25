import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What actually arrives in someone's inbox.
 *
 * The door admits one person per scan, so a group's email has to carry a code
 * each — these tests exist because a single QR for a three-person order looks
 * fine until three people are standing outside a flat with no signal.
 */

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));

vi.mock("@/lib/platform/email.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform/email.server")>()),
  sendEmail,
}));

import { sendTicketEmail } from "@/features/tickets/email.server";
import type { EventRecord } from "@/features/events/types";
import type { TicketRecord } from "@/features/tickets/types";

const EVENT: EventRecord = {
  slug: "apartment-life",
  title: "Apartment Life",
  status: "published",
  startsAt: "2026-09-12T18:30:00.000Z",
  doorsAt: "2026-09-12T18:00:00.000Z",
  timezone: "Europe/London",
  area: "East London",
  venueName: "The Front Room",
  address: "14 Example Road, London E8 1AA",
  doorCode: "4821",
  threeWordHint: "///plant.window.stairs",
  lineup: [],
  ticketTypes: [],
  waitlistEnabled: false,
  transferable: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const NAMES = ["Ada", "Bram", "Cleo", "Dara", "Esme", "Fionn", "Gus", "Hana"];

function order(count: number): TicketRecord[] {
  const tickets = Array.from({ length: count }, (_, index) => ({
    id: `TKT${String(index).padStart(13, "0")}`,
    eventSlug: EVENT.slug,
    ticketTypeId: "entry",
    kind: "paid" as const,
    status: "valid" as const,
    holderName: NAMES[index],
    email: "guest@example.com",
    orderId: "ord_1",
    issuedAt: "2026-08-02T00:00:00.000Z",
  })) as TicketRecord[];
  for (const ticket of tickets.slice(1)) ticket.parentTicketId = tickets[0].id;
  return tickets;
}

async function send(count: number) {
  sendEmail.mockResolvedValue({ ok: true, id: "msg_1" });
  const result = await sendTicketEmail({
    event: EVENT,
    tickets: order(count),
    origin: "https://milkandhenny.com",
    idempotencyKey: "tickets:issued:ord_1",
  });
  expect(result.queued).toBe(true);
  return sendEmail.mock.calls[0][0] as {
    html: string;
    text: string;
    attachments?: { filename: string; type: string; contentId?: string; content: string }[];
  };
}

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-secret-long-enough-to-sign");
  sendEmail.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ticket email", () => {
  it("carries a QR for every guest on the order", async () => {
    const message = await send(3);
    const qrs = message.attachments?.filter((item) => item.type === "image/png") ?? [];

    expect(qrs).toHaveLength(3);
    for (const [index, name] of ["Ada", "Bram", "Cleo"].entries()) {
      expect(message.html).toContain(`cid:ticketqr${index}`);
      expect(message.html).toContain(name);
    }
    expect(message.text).toContain("Everyone scans their own code");
  });

  it("names each guest once, under their own code, as the way into it", async () => {
    const message = await send(3);

    // One "open ticket" per guest — the caption is the link, so there is no
    // second list of the same names underneath.
    expect(message.html.match(/open ticket/g) ?? []).toHaveLength(3);
    expect(message.html).toContain('href="https://milkandhenny.com/ticket/TKT0000000000000"');
    expect(message.html).toContain('href="https://milkandhenny.com/ticket/TKT0000000000002"');
    expect(message.html).toContain("Ada — open ticket · manage order");
    expect(message.text).toContain("Share each guest's own link");
  });

  it("still lists the tickets that have no QR of their own", async () => {
    const message = await send(8);
    // Six captions plus a row each for the two beyond the cap.
    expect(message.html.match(/open ticket/g) ?? []).toHaveLength(8);
  });

  it("makes a three-word hint tappable", async () => {
    const message = await send(1);
    expect(message.html).toContain('href="https://what3words.com/plant.window.stairs"');
    expect(message.text).toContain(
      "Find it: ///plant.window.stairs — https://what3words.com/plant.window.stairs",
    );
  });

  it("keeps a single ticket to one QR and no roll call", async () => {
    const message = await send(1);
    const qrs = message.attachments?.filter((item) => item.type === "image/png") ?? [];

    expect(qrs).toHaveLength(1);
    expect(message.html).toContain("cid:ticketqr0");
    expect(message.text).not.toContain("Everyone scans their own code");
  });

  it("caps a large order and says where the rest are", async () => {
    const message = await send(8);
    const qrs = message.attachments?.filter((item) => item.type === "image/png") ?? [];

    expect(qrs).toHaveLength(6);
    expect(message.html).toContain("The other 2 tickets are on the links below.");
  });

  it("attaches a calendar entry carrying the address and door code", async () => {
    const message = await send(2);
    const calendar = message.attachments?.find((item) => item.type === "text/calendar");

    expect(calendar).toBeDefined();
    expect(calendar?.filename).toBe("apartment-life.ics");

    const ics = Buffer.from(calendar!.content, "base64").toString("utf8").replace(/\r\n /g, "");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("LOCATION:The Front Room\\, 14 Example Road\\, London E8 1AA");
    expect(ics).toContain("Venue door code: 4821");
    expect(ics).toContain("TRIGGER:-PT120M");
  });

  it("does not mention a venue code when the event has none", async () => {
    const doorCode = EVENT.doorCode;
    delete EVENT.doorCode;
    try {
      const message = await send(1);
      expect(message.text).not.toContain("door code");
      expect(message.html).not.toContain("door code");
    } finally {
      EVENT.doorCode = doorCode;
    }
  });

  it("links the per-ticket calendar route for clients that strip attachments", async () => {
    const message = await send(1);
    expect(message.text).toContain(
      "Add to calendar: https://milkandhenny.com/api/tickets/TKT0000000000000/ics",
    );
    expect(message.html).toContain("/api/tickets/TKT0000000000000/ics");
  });

  it("clearly offers later upgrades when a higher-priced ticket exists", async () => {
    EVENT.ticketTypes = [
      {
        id: "entry",
        name: "Entry",
        priceMinor: 1500,
        currency: "GBP",
        quantity: 50,
        perPersonLimit: 4,
        hidden: false,
      },
      {
        id: "vip",
        name: "VIP",
        priceMinor: 3000,
        currency: "GBP",
        quantity: 20,
        perPersonLimit: 4,
        hidden: false,
      },
    ];
    try {
      const message = await send(1);
      expect(message.text).toContain("upgrades charge only the difference");
      expect(message.html).toContain("upgrades charge only the difference");
    } finally {
      EVENT.ticketTypes = [];
    }
  });

  it("keeps management subtle for the highest-priced ticket", async () => {
    EVENT.ticketTypes = [
      {
        id: "entry",
        name: "Entry",
        priceMinor: 1500,
        currency: "GBP",
        quantity: 50,
        perPersonLimit: 4,
        hidden: false,
      },
    ];
    try {
      const message = await send(1);
      expect(message.text).toContain("choose manage tickets if you need to update this order");
      expect(message.text).not.toContain("upgrade");
    } finally {
      EVENT.ticketTypes = [];
    }
  });
});
