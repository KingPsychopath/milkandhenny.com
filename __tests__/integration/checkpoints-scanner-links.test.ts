import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

/**
 * Integration tests for checkpoint consumption and scanner links, against
 * real Postgres.
 *
 * The property that matters at a catering hatch is the same shape as the
 * door's: a bundle of N units hands out exactly N under simultaneous scans.
 * That guarantee is a guarded upsert, so it is tested against a real
 * database.
 */

process.env.AUTH_SECRET = "test-secret-value-long-enough-to-pass";

vi.mock("@/lib/platform/redis.server", () => ({
  getRedis: () => null,
  getRedisRestConfig: () => null,
}));

import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";
import { putEvent } from "@/features/events/store.server";
import { normaliseEventInput } from "@/features/events/events.server";
import { issueTickets, voidTicket } from "@/features/tickets/tickets.server";
import {
  checkpointScan,
  deleteCheckpoint,
  getCheckpointSummaries,
  listCheckpoints,
  undoCheckpointUse,
  upsertCheckpoint,
} from "@/features/tickets/checkpoints.server";
import {
  createScannerLink,
  listScannerLinks,
  resolveScannerLink,
  revokeScannerLink,
} from "@/features/tickets/scanner-links.server";
import {
  cancelGuestRequest,
  createGuestRequest,
  decideGuestRequest,
  listGuestRequests,
  listGuestRequestsForToken,
} from "@/features/tickets/guest-requests.server";
import { getTicket, lookupTicketsByEmail } from "@/features/tickets/tickets.server";
import { updateTicketHolder } from "@/features/tickets/store.server";
import { renderEventMessage } from "@/features/tickets/email.server";
import { buildTicketQrPayload } from "@/features/tickets/qr.server";
import { checkpointAllowanceFor } from "@/features/tickets/checkpoint-types";

const SLUG = "supper-club";

async function seedEvent(): Promise<void> {
  const result = normaliseEventInput({
    slug: SLUG,
    title: "Supper Club",
    status: "published",
    area: "East London",
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    ticketTypes: [
      {
        id: "entry",
        name: "Entry",
        priceMinor: 0,
        currency: "GBP",
        quantity: 50,
        perPersonLimit: 4,
      },
      {
        id: "vip",
        name: "VIP Bundle",
        priceMinor: 0,
        currency: "GBP",
        quantity: 50,
        perPersonLimit: 4,
      },
    ],
  });
  if (!result.ok) throw new Error(result.error);
  await putEvent(result.value);
}

async function seedDinnerCheckpoint(): Promise<void> {
  const result = await upsertCheckpoint({
    eventSlug: SLUG,
    id: "dinner",
    name: "Dinner",
    defaultAllowance: 1,
    allowances: { vip: 3 },
  });
  if (!result.ok) throw new Error(result.error);
}

async function issueOne(ticketTypeId: string, name = "Alice") {
  const result = await issueTickets({
    eventSlug: SLUG,
    ticketTypeId,
    holderName: name,
    quantity: 1,
    kind: "free",
  });
  if (!result.ok) throw new Error(result.error);
  return result.value.tickets[0];
}

describeWithDatabase("checkpoints (postgres)", () => {
  beforeAll(async () => {
    await applySchema();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedEvent();
    await seedDinnerCheckpoint();
  });

  it("consumes one unit per scan and reports the remainder", async () => {
    const ticket = await issueOne("entry");

    const first = await checkpointScan({
      scanned: buildTicketQrPayload(ticket.id),
      eventSlug: SLUG,
      checkpointId: "dinner",
    });
    expect(first.result).toBe("consumed");
    if (first.result !== "consumed") return;
    expect(first.ticket.used).toBe(1);
    expect(first.ticket.allowance).toBe(1);

    const second = await checkpointScan({
      scanned: ticket.id,
      eventSlug: SLUG,
      checkpointId: "dinner",
    });
    expect(second.result).toBe("exhausted");
  });

  it("honours per-type allowance overrides", async () => {
    const vip = await issueOne("vip", "Bea");

    for (let i = 1; i <= 3; i += 1) {
      const scan = await checkpointScan({
        scanned: vip.id,
        eventSlug: SLUG,
        checkpointId: "dinner",
      });
      expect(scan.result).toBe("consumed");
      if (scan.result === "consumed") expect(scan.ticket.used).toBe(i);
    }

    const fourth = await checkpointScan({
      scanned: vip.id,
      eventSlug: SLUG,
      checkpointId: "dinner",
    });
    expect(fourth.result).toBe("exhausted");
  });

  it("never over-hands-out under simultaneous scans", async () => {
    const vip = await issueOne("vip", "Cara");

    const scans = await Promise.all(
      Array.from({ length: 8 }, () =>
        checkpointScan({ scanned: vip.id, eventSlug: SLUG, checkpointId: "dinner" }),
      ),
    );
    const consumed = scans.filter((scan) => scan.result === "consumed");
    expect(consumed.length).toBe(3);
    const summaries = await getCheckpointSummaries(SLUG);
    expect(summaries.find((entry) => entry.checkpointId === "dinner")?.unitsUsed).toBe(3);
  });

  it("refuses more than remains in one ask", async () => {
    const vip = await issueOne("vip", "Dan");
    const first = await checkpointScan({
      scanned: vip.id,
      eventSlug: SLUG,
      checkpointId: "dinner",
      consume: 2,
    });
    expect(first.result).toBe("consumed");

    const over = await checkpointScan({
      scanned: vip.id,
      eventSlug: SLUG,
      checkpointId: "dinner",
      consume: 2,
    });
    expect(over.result).toBe("over-remaining");
  });

  it("treats a zero allowance as not included", async () => {
    await upsertCheckpoint({
      eventSlug: SLUG,
      id: "cloakroom",
      name: "Cloakroom",
      defaultAllowance: 0,
      allowances: { vip: 1 },
    });
    const entry = await issueOne("entry", "Eve");
    const scan = await checkpointScan({
      scanned: entry.id,
      eventSlug: SLUG,
      checkpointId: "cloakroom",
    });
    expect(scan.result).toBe("not-included");
  });

  it("peeks without consuming when consume is 0", async () => {
    const ticket = await issueOne("entry", "Fay");
    const peek = await checkpointScan({
      scanned: ticket.id,
      eventSlug: SLUG,
      checkpointId: "dinner",
      consume: 0,
    });
    expect(peek.result).toBe("consumed");
    if (peek.result === "consumed") expect(peek.ticket.used).toBe(0);

    const real = await checkpointScan({
      scanned: ticket.id,
      eventSlug: SLUG,
      checkpointId: "dinner",
    });
    expect(real.result).toBe("consumed");
  });

  it("undo puts a unit back", async () => {
    const ticket = await issueOne("entry", "Gus");
    await checkpointScan({ scanned: ticket.id, eventSlug: SLUG, checkpointId: "dinner" });

    const undo = await undoCheckpointUse({
      eventSlug: SLUG,
      checkpointId: "dinner",
      ticketId: ticket.id,
    });
    expect(undo.ok).toBe(true);
    if (undo.ok) expect(undo.value.used).toBe(0);

    const again = await checkpointScan({
      scanned: ticket.id,
      eventSlug: SLUG,
      checkpointId: "dinner",
    });
    expect(again.result).toBe("consumed");
  });

  it("rejects void tickets and wrong events", async () => {
    const ticket = await issueOne("entry", "Hal");
    await voidTicket(ticket.id);
    const scan = await checkpointScan({
      scanned: ticket.id,
      eventSlug: SLUG,
      checkpointId: "dinner",
    });
    expect(scan.result).toBe("void");

    // A ticket from another night, scanned at this event's checkpoint.
    const otherEvent = normaliseEventInput({
      slug: "other-night",
      title: "Other Night",
      status: "published",
      area: "East London",
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      ticketTypes: [
        {
          id: "entry",
          name: "Entry",
          priceMinor: 0,
          currency: "GBP",
          quantity: 5,
          perPersonLimit: 2,
        },
      ],
    });
    if (!otherEvent.ok) throw new Error(otherEvent.error);
    await putEvent(otherEvent.value);
    const foreign = await issueTickets({
      eventSlug: "other-night",
      ticketTypeId: "entry",
      holderName: "Ida",
      quantity: 1,
      kind: "free",
    });
    if (!foreign.ok) throw new Error(foreign.error);

    const wrong = await checkpointScan({
      scanned: foreign.value.tickets[0].id,
      eventSlug: SLUG,
      checkpointId: "dinner",
    });
    expect(wrong.result).toBe("wrong-event");

    // And a station that simply does not exist.
    const fresh = await issueOne("entry", "Kim");
    const unknown = await checkpointScan({
      scanned: fresh.id,
      eventSlug: SLUG,
      checkpointId: "no-such-station",
    });
    expect(unknown.result).toBe("unknown-checkpoint");
  });

  it("deleting a checkpoint removes it and its usage", async () => {
    const ticket = await issueOne("entry", "Jo");
    await checkpointScan({ scanned: ticket.id, eventSlug: SLUG, checkpointId: "dinner" });

    const removed = await deleteCheckpoint(SLUG, "dinner");
    expect(removed.ok).toBe(true);
    expect(await listCheckpoints(SLUG)).toHaveLength(0);

    const scan = await checkpointScan({
      scanned: ticket.id,
      eventSlug: SLUG,
      checkpointId: "dinner",
    });
    expect(scan.result).toBe("unknown-checkpoint");
  });

  it("allowance helper prefers the override and falls back to the default", () => {
    const checkpoint = { defaultAllowance: 1, allowances: { vip: 3, none: 0 } };
    expect(checkpointAllowanceFor(checkpoint, "vip")).toBe(3);
    expect(checkpointAllowanceFor(checkpoint, "none")).toBe(0);
    expect(checkpointAllowanceFor(checkpoint, "entry")).toBe(1);
  });
});

describeWithDatabase("scanner links (postgres)", () => {
  beforeAll(async () => {
    await applySchema();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedEvent();
    await seedDinnerCheckpoint();
  });

  it("creates, resolves, and revokes a door link", async () => {
    const created = await createScannerLink({
      eventSlug: SLUG,
      checkpointId: null,
      label: "Alice — door",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const resolved = await resolveScannerLink(created.value.token);
    expect(resolved?.eventSlug).toBe(SLUG);
    expect(resolved?.checkpointId).toBeNull();
    expect(resolved?.lastUsedAt).toBeDefined();

    await revokeScannerLink(created.value.token);
    expect(await resolveScannerLink(created.value.token)).toBeNull();

    // Still listed for the admin, marked revoked.
    const links = await listScannerLinks(SLUG);
    expect(links).toHaveLength(1);
    expect(links[0].revokedAt).toBeDefined();
  });

  it("scopes links to an existing checkpoint", async () => {
    const missing = await createScannerLink({
      eventSlug: SLUG,
      checkpointId: "nonexistent",
      label: "Caterer",
    });
    expect(missing.ok).toBe(false);

    const created = await createScannerLink({
      eventSlug: SLUG,
      checkpointId: "dinner",
      label: "Caterer",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect((await resolveScannerLink(created.value.token))?.checkpointId).toBe("dinner");
  });

  it("expired links stop resolving", async () => {
    const created = await createScannerLink({
      eventSlug: SLUG,
      checkpointId: null,
      label: "Short shift",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await resolveScannerLink(created.value.token)).toBeNull();
  });

  it("rejects garbage tokens without touching the database", async () => {
    expect(await resolveScannerLink("not-a-token")).toBeNull();
    expect(await resolveScannerLink("scn_short")).toBeNull();
  });

  it("carries a role, defaulting to scanner", async () => {
    const scanner = await createScannerLink({ eventSlug: SLUG, checkpointId: null, label: "A" });
    const manager = await createScannerLink({
      eventSlug: SLUG,
      checkpointId: null,
      label: "B",
      role: "manager",
    });
    expect(scanner.ok && scanner.value.role).toBe("scanner");
    expect(manager.ok && manager.value.role).toBe("manager");
  });
});

describeWithDatabase("guest requests (postgres)", () => {
  beforeAll(async () => {
    await applySchema();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedEvent();
  });

  async function makeLink(label = "Door helper") {
    const created = await createScannerLink({ eventSlug: SLUG, checkpointId: null, label });
    if (!created.ok) throw new Error(created.error);
    return created.value;
  }

  it("raises, lists, and cancels a request", async () => {
    const link = await makeLink();
    const created = await createGuestRequest({
      eventSlug: SLUG,
      token: link.token,
      requestedBy: link.label,
      name: "Walk Up",
    });
    expect(created.ok).toBe(true);

    const own = await listGuestRequestsForToken(link.token);
    expect(own).toHaveLength(1);
    expect(own[0].status).toBe("pending");

    if (!created.ok) return;
    const cancelled = await cancelGuestRequest(created.value.id, link.token);
    expect(cancelled.ok).toBe(true);
    expect((await listGuestRequestsForToken(link.token))[0].status).toBe("cancelled");

    // Cancelling twice reports "already decided" rather than flapping.
    expect((await cancelGuestRequest(created.value.id, link.token)).ok).toBe(false);
  });

  it("approval comps a ticket exactly once under concurrent deciders", async () => {
    const link = await makeLink();
    const created = await createGuestRequest({
      eventSlug: SLUG,
      token: link.token,
      requestedBy: link.label,
      name: "Late Guest",
    });
    if (!created.ok) throw new Error(created.error);

    const decisions = await Promise.all([
      decideGuestRequest({ eventSlug: SLUG, id: created.value.id, approve: true, decidedBy: "a" }),
      decideGuestRequest({ eventSlug: SLUG, id: created.value.id, approve: true, decidedBy: "b" }),
    ]);
    const wins = decisions.filter((decision) => decision.ok);
    expect(wins).toHaveLength(1);

    const request = (await listGuestRequests(SLUG))[0];
    expect(request.status).toBe("approved");
    expect(request.ticketId).toBeDefined();
    const ticket = request.ticketId ? await getTicket(request.ticketId) : null;
    expect(ticket?.kind).toBe("comp");
    expect(ticket?.holderName).toBe("Late Guest");
  });

  it("decline issues nothing", async () => {
    const link = await makeLink();
    const created = await createGuestRequest({
      eventSlug: SLUG,
      token: link.token,
      requestedBy: link.label,
      name: "No Entry",
    });
    if (!created.ok) throw new Error(created.error);

    const declined = await decideGuestRequest({
      eventSlug: SLUG,
      id: created.value.id,
      approve: false,
      decidedBy: "admin",
    });
    expect(declined.ok && declined.value.status).toBe("declined");
    expect(declined.ok && declined.value.ticketId).toBeUndefined();
  });

  it("caps pending requests per link", async () => {
    const link = await makeLink();
    for (let i = 0; i < 10; i += 1) {
      const created = await createGuestRequest({
        eventSlug: SLUG,
        token: link.token,
        requestedBy: link.label,
        name: `Guest ${i}`,
      });
      expect(created.ok).toBe(true);
    }
    const over = await createGuestRequest({
      eventSlug: SLUG,
      token: link.token,
      requestedBy: link.label,
      name: "One Too Many",
    });
    expect(over.ok).toBe(false);
  });
});

describeWithDatabase("ticket holder updates (postgres)", () => {
  beforeAll(async () => {
    await applySchema();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedEvent();
  });

  it("changes name and email, and the new address can find the ticket", async () => {
    const issued = await issueTickets({
      eventSlug: SLUG,
      ticketTypeId: "entry",
      holderName: "Old Name",
      email: "old@example.com",
      quantity: 1,
      kind: "free",
    });
    if (!issued.ok) throw new Error(issued.error);
    const ticket = issued.value.tickets[0];

    const updated = await updateTicketHolder(ticket.id, {
      holderName: "New Name",
      email: "NEW@Example.com",
    });
    expect(updated?.holderName).toBe("New Name");
    expect(updated?.email).toBe("new@example.com");

    const found = await lookupTicketsByEmail(SLUG, "new@example.com");
    expect(found.ok && found.value.tickets.map((entry) => entry.id)).toContain(ticket.id);
    const stale = await lookupTicketsByEmail(SLUG, "old@example.com");
    expect(stale.ok && stale.value.tickets).toHaveLength(0);
  });

  it("clears an email with null and leaves it alone when undefined", async () => {
    const issued = await issueTickets({
      eventSlug: SLUG,
      ticketTypeId: "entry",
      holderName: "Keep",
      email: "keep@example.com",
      quantity: 1,
      kind: "free",
    });
    if (!issued.ok) throw new Error(issued.error);
    const ticket = issued.value.tickets[0];

    const renamed = await updateTicketHolder(ticket.id, { holderName: "Kept" });
    expect(renamed?.email).toBe("keep@example.com");

    const cleared = await updateTicketHolder(ticket.id, { email: null });
    expect(cleared?.email).toBeUndefined();
    expect(cleared?.emailHash).toBeUndefined();
  });
});

describe("event message rendering", () => {
  const event = {
    slug: SLUG,
    title: "Supper Club",
    status: "published",
    startsAt: "2026-09-01T19:00:00.000Z",
    timezone: "Europe/London",
    lineup: [],
    ticketTypes: [],
    waitlistEnabled: false,
    transferable: false,
    createdAt: "",
    updatedAt: "",
  } as never;

  it("escapes HTML and splits paragraphs", () => {
    const rendered = renderEventMessage({
      event,
      subject: "Doors & details",
      body: "First <b>para</b>.\n\nSecond para.",
    });
    expect(rendered.html).toContain("Doors &amp; details");
    expect(rendered.html).toContain("First &lt;b&gt;para&lt;/b&gt;.");
    expect(rendered.html.match(/<p style/g)?.length).toBeGreaterThanOrEqual(2);
    expect(rendered.text).toContain("Second para.");
    expect(rendered.text).toContain("— milk & henny");
  });
});
