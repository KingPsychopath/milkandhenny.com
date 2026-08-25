import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

process.env.AUTH_SECRET = "test-secret-value-long-enough-to-pass";

const stripe = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  refundPayment: vi.fn(),
  retrievePaymentBalance: vi.fn(),
  retrieveSession: vi.fn(),
}));

vi.mock("@/lib/platform/stripe.server", () => ({
  createCheckoutSession: stripe.createCheckoutSession,
  refundPayment: stripe.refundPayment,
  retrievePaymentBalance: stripe.retrievePaymentBalance,
  retrieveSession: stripe.retrieveSession,
  isPaymentsConfigured: () => true,
}));

vi.mock("@/features/tickets/email.server", () => ({
  sendTicketExchangeEmail: vi.fn().mockResolvedValue({ queued: true }),
  sendTicketExchangePaymentEmail: vi.fn().mockResolvedValue({ queued: true }),
}));

import { normaliseEventInput, updateEvent } from "@/features/events/events.server";
import { putEvent } from "@/features/events/store.server";
import {
  beginTicketExchange,
  completePendingExchangeRefund,
  fulfilTicketExchangeCheckout,
  getTicketExchangeManagement,
} from "@/features/tickets/exchange.server";
import { getTicket } from "@/features/tickets/store.server";
import { getEventTickets, issueTickets } from "@/features/tickets/tickets.server";
import { query, queryOne } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

const SLUG = "ticket-exchange";

async function seedEvent() {
  const result = normaliseEventInput({
    slug: SLUG,
    title: "Ticket Exchange",
    status: "published",
    area: "East London",
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    ticketTypes: [
      { id: "entry", name: "Entry", priceMinor: 1000, currency: "GBP", quantity: 20 },
      { id: "balcony", name: "Balcony", priceMinor: 1000, currency: "GBP", quantity: 20 },
      { id: "early", name: "Early", priceMinor: 500, currency: "GBP", quantity: 20 },
      { id: "vip", name: "VIP", priceMinor: 2000, currency: "GBP", quantity: 1 },
      {
        id: "limited",
        name: "Limited",
        priceMinor: 2000,
        currency: "GBP",
        quantity: 2,
        perPersonLimit: 1,
      },
    ],
  });
  if (!result.ok) throw new Error(result.error);
  await putEvent(result.value);
}

async function paidOrder(quantity = 1) {
  const result = await issueTickets({
    eventSlug: SLUG,
    ticketTypeId: "entry",
    holderName: "Alice",
    email: "alice@example.com",
    quantity,
    kind: "paid",
    paymentRef: "pi_original",
    amountPaidMinor: 1000,
    currency: "GBP",
  });
  if (!result.ok) throw new Error(result.error);
  return result.value.tickets;
}

describeWithDatabase("ticket exchanges (postgres)", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);

  beforeEach(async () => {
    await truncateAll();
    await seedEvent();
    stripe.createCheckoutSession.mockReset();
    stripe.refundPayment.mockReset();
    stripe.retrievePaymentBalance.mockReset();
    stripe.retrievePaymentBalance.mockResolvedValue({
      amountMinor: 2000,
      amountRefundedMinor: 0,
      remainingMinor: 2000,
    });
    stripe.retrieveSession.mockReset();
  });

  it("changes only the selected ticket in a grouped order and preserves its QR id", async () => {
    const tickets = await paidOrder(2);
    const result = await beginTicketExchange({
      managerTicketId: tickets[0].id,
      ticketId: tickets[1].id,
      targetTicketTypeId: "balcony",
      actorType: "purchaser",
      origin: "https://milkandhenny.com",
    });

    expect(result.ok).toBe(true);
    expect((await getTicket(tickets[0].id))?.ticketTypeId).toBe("entry");
    expect((await getTicket(tickets[1].id))?.ticketTypeId).toBe("balcony");
    expect((await getTicket(tickets[1].id))?.amountPaidMinor).toBe(1000);
  });

  it("keeps tickets and exchange history attached when the event slug changes", async () => {
    const [ticket] = await paidOrder();
    const exchange = await beginTicketExchange({
      managerTicketId: ticket.id,
      ticketId: ticket.id,
      targetTicketTypeId: "balcony",
      actorType: "purchaser",
      origin: "https://milkandhenny.com",
    });
    expect(exchange.ok && exchange.value.state).toBe("completed");

    const renamed = await updateEvent(SLUG, { slug: "ticket-exchange-renamed" });
    expect(renamed.ok).toBe(true);
    expect((await getTicket(ticket.id))?.eventSlug).toBe("ticket-exchange-renamed");
    expect(
      await queryOne<{ event_slug: string }>(
        `select event_slug from ticket_exchanges where ticket_id = $1`,
        [ticket.id],
      ),
    ).toEqual({ event_slug: "ticket-exchange-renamed" });
  });

  it("partially refunds the difference for a cheaper ticket", async () => {
    const [ticket] = await paidOrder();
    stripe.refundPayment.mockResolvedValue({
      ok: true,
      refundId: "re_exchange",
      status: "succeeded",
      amountMinor: 500,
    });

    const result = await beginTicketExchange({
      managerTicketId: ticket.id,
      ticketId: ticket.id,
      targetTicketTypeId: "early",
      actorType: "purchaser",
      origin: "https://milkandhenny.com",
    });

    expect(result.ok && result.value.state).toBe("completed");
    expect(stripe.refundPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentId: "pi_original",
        amountMinor: 500,
        metadata: expect.objectContaining({ refundPurpose: "ticket_exchange" }),
      }),
    );
    expect((await getTicket(ticket.id))?.ticketTypeId).toBe("early");
    expect((await getTicket(ticket.id))?.amountPaidMinor).toBe(500);
  });

  it("reserves an upgrade place and changes the ticket only after payment", async () => {
    const [ticket] = await paidOrder();
    stripe.createCheckoutSession.mockResolvedValue({
      id: "cs_exchange_123456",
      url: "https://checkout.stripe.test/session",
    });

    const started = await beginTicketExchange({
      managerTicketId: ticket.id,
      ticketId: ticket.id,
      targetTicketTypeId: "vip",
      actorType: "purchaser",
      origin: "https://milkandhenny.com",
    });
    expect(started.ok && started.value.state).toBe("checkout");
    expect((await getTicket(ticket.id))?.ticketTypeId).toBe("entry");

    const competing = await issueTickets({
      eventSlug: SLUG,
      ticketTypeId: "vip",
      holderName: "Bob",
      email: "bob@example.com",
      quantity: 1,
      kind: "paid",
      paymentRef: "pi_competing",
      amountPaidMinor: 2000,
      currency: "GBP",
    });
    expect(competing.ok).toBe(false);

    stripe.retrieveSession.mockResolvedValue({
      paid: true,
      paymentIntentId: "pi_upgrade",
      amountMinor: 1000,
      currency: "gbp",
      email: "alice@example.com",
      metadata: {
        checkoutPurpose: "ticket_exchange",
        ticketExchangeId: started.ok ? started.value.exchangeId : "",
      },
      amountRefundedMinor: 0,
      disputed: false,
    });
    const fulfilled = await fulfilTicketExchangeCheckout(
      "cs_exchange_123456",
      "https://milkandhenny.com",
    );
    expect(fulfilled?.state).toBe("complete");
    expect((await getTicket(ticket.id))?.ticketTypeId).toBe("vip");
    expect((await getTicket(ticket.id))?.amountPaidMinor).toBe(2000);
  });

  it("shows a Checkout-held upgrade as sold out and rejects the exchange", async () => {
    const [ticket] = await paidOrder();
    await query(
      `insert into checkout_sessions (
         id, event_slug, ticket_type_id, quantity, holder_name, email, email_hash,
         amount_minor, currency, reference, status
       ) values ('cs_vip_hold_123456','ticket-exchange','vip',1,'Other buyer',
                 'other@example.com','other-hash',2000,'GBP','vip-hold-reference','pending')`,
    );

    const management = await getTicketExchangeManagement({ managerTicketId: ticket.id });
    expect(management.ok).toBe(true);
    expect(management.ok && management.value.options.find((option) => option.id === "vip")).toEqual(
      expect.objectContaining({ available: false, unavailableReason: "sold-out" }),
    );

    const exchange = await beginTicketExchange({
      managerTicketId: ticket.id,
      ticketId: ticket.id,
      targetTicketTypeId: "vip",
      actorType: "purchaser",
      origin: "https://milkandhenny.com",
    });
    expect(exchange).toEqual({ ok: false, status: 409, error: "VIP is sold out" });
  });

  it("allows an existing buyer to upgrade when only new event sales are marked sold out", async () => {
    const [ticket] = await paidOrder();
    await query(`update events set status = 'sold-out' where slug = $1`, [SLUG]);
    stripe.createCheckoutSession.mockResolvedValue({
      id: "cs_exchange_sold_event_123456",
      url: "https://checkout.stripe.test/session",
    });

    const management = await getTicketExchangeManagement({ managerTicketId: ticket.id });
    expect(management.ok).toBe(true);
    expect(
      management.ok && management.value.options.find((option) => option.id === "vip")?.available,
    ).toBe(true);

    const exchange = await beginTicketExchange({
      managerTicketId: ticket.id,
      ticketId: ticket.id,
      targetTicketTypeId: "vip",
      actorType: "purchaser",
      origin: "https://milkandhenny.com",
    });
    expect(exchange.ok && exchange.value.state).toBe("checkout");
  });

  it("counts pending exchanges against the target per-person limit", async () => {
    const tickets = await paidOrder(2);
    stripe.createCheckoutSession.mockResolvedValue({
      id: "cs_exchange_limited_123456",
      url: "https://checkout.stripe.test/session",
    });
    const first = await beginTicketExchange({
      managerTicketId: tickets[0].id,
      ticketId: tickets[0].id,
      targetTicketTypeId: "limited",
      actorType: "purchaser",
      origin: "https://milkandhenny.com",
    });
    expect(first.ok && first.value.state).toBe("checkout");

    const second = await beginTicketExchange({
      managerTicketId: tickets[0].id,
      ticketId: tickets[1].id,
      targetTicketTypeId: "limited",
      actorType: "purchaser",
      origin: "https://milkandhenny.com",
    });
    expect(second).toEqual({
      ok: false,
      status: 409,
      error: "Limit of 1 per person for Limited",
    });
  });

  it("splits a later downgrade across the upgrade and original payments", async () => {
    const [ticket] = await paidOrder();
    stripe.createCheckoutSession.mockResolvedValue({
      id: "cs_exchange_split_123456",
      url: "https://checkout.stripe.test/session",
    });
    const upgrade = await beginTicketExchange({
      managerTicketId: ticket.id,
      ticketId: ticket.id,
      targetTicketTypeId: "vip",
      actorType: "purchaser",
      origin: "https://milkandhenny.com",
    });
    if (!upgrade.ok) throw new Error(upgrade.error);
    stripe.retrieveSession.mockResolvedValue({
      paid: true,
      paymentIntentId: "pi_upgrade_split",
      amountMinor: 1000,
      currency: "gbp",
      email: "alice@example.com",
      metadata: { ticketExchangeId: upgrade.value.exchangeId },
      amountRefundedMinor: 0,
      disputed: false,
    });
    await fulfilTicketExchangeCheckout("cs_exchange_split_123456", "https://milkandhenny.com");

    stripe.retrievePaymentBalance.mockImplementation(async (paymentIntentId: string) => ({
      amountMinor: paymentIntentId === "pi_upgrade_split" ? 1000 : 2000,
      amountRefundedMinor: 0,
      remainingMinor: paymentIntentId === "pi_upgrade_split" ? 1000 : 2000,
    }));
    stripe.refundPayment.mockImplementation(
      async (input: { paymentIntentId: string; amountMinor: number }) => ({
        ok: true,
        refundId: `re_${input.paymentIntentId}`,
        status: "succeeded",
        amountMinor: input.amountMinor,
      }),
    );

    const downgrade = await beginTicketExchange({
      managerTicketId: ticket.id,
      ticketId: ticket.id,
      targetTicketTypeId: "early",
      actorType: "purchaser",
      origin: "https://milkandhenny.com",
    });

    expect(downgrade.ok && downgrade.value.state).toBe("completed");
    expect(stripe.refundPayment).toHaveBeenCalledTimes(2);
    expect(stripe.refundPayment.mock.calls.map(([input]) => input.amountMinor)).toEqual([
      1000, 500,
    ]);
    expect((await getTicket(ticket.id))?.amountPaidMinor).toBe(500);
  });

  it("keeps a partially completed multi-payment refund blocked for attention", async () => {
    const [ticket] = await paidOrder();
    stripe.createCheckoutSession.mockResolvedValue({
      id: "cs_exchange_partial_refund_123456",
      url: "https://checkout.stripe.test/session",
    });
    const upgrade = await beginTicketExchange({
      managerTicketId: ticket.id,
      ticketId: ticket.id,
      targetTicketTypeId: "vip",
      actorType: "purchaser",
      origin: "https://milkandhenny.com",
    });
    if (!upgrade.ok) throw new Error(upgrade.error);
    stripe.retrieveSession.mockResolvedValue({
      paid: true,
      paymentIntentId: "pi_upgrade_partial",
      amountMinor: 1000,
      currency: "gbp",
      email: "alice@example.com",
      metadata: { ticketExchangeId: upgrade.value.exchangeId },
      amountRefundedMinor: 0,
      disputed: false,
    });
    await fulfilTicketExchangeCheckout(
      "cs_exchange_partial_refund_123456",
      "https://milkandhenny.com",
    );

    stripe.retrievePaymentBalance.mockImplementation(async (paymentIntentId: string) => ({
      amountMinor: paymentIntentId === "pi_upgrade_partial" ? 1000 : 2000,
      amountRefundedMinor: 0,
      remainingMinor: paymentIntentId === "pi_upgrade_partial" ? 1000 : 2000,
    }));
    stripe.refundPayment
      .mockResolvedValueOnce({
        ok: true,
        refundId: "re_partial_succeeded",
        status: "succeeded",
        amountMinor: 1000,
      })
      .mockResolvedValueOnce({
        ok: true,
        refundId: "re_partial_pending",
        status: "pending",
        amountMinor: 500,
      });
    const downgrade = await beginTicketExchange({
      managerTicketId: ticket.id,
      ticketId: ticket.id,
      targetTicketTypeId: "early",
      actorType: "purchaser",
      origin: "https://milkandhenny.com",
    });
    expect(downgrade.ok && downgrade.value.state).toBe("refund_pending");
    if (!downgrade.ok) throw new Error(downgrade.error);

    await completePendingExchangeRefund("re_partial_pending", "failed", "https://milkandhenny.com");
    expect(
      await queryOne<{ status: string; error_message: string | null }>(
        `select status, error_message from ticket_exchanges where id = $1`,
        [downgrade.value.exchangeId],
      ),
    ).toEqual({
      status: "refund_pending",
      error_message: "Part of the refund succeeded, but the remainder needs attention",
    });
    expect((await getTicket(ticket.id))?.ticketTypeId).toBe("vip");
    expect(
      (await getEventTickets(SLUG)).tickets.find((entry) => entry.id === ticket.id)?.activeExchange,
    ).toEqual(
      expect.objectContaining({
        status: "refund_pending",
        toTicketTypeName: "Early",
        errorMessage: "Part of the refund succeeded, but the remainder needs attention",
      }),
    );
  });
});
