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

import { normaliseEventInput } from "@/features/events/events.server";
import { putEvent } from "@/features/events/store.server";
import {
  beginTicketExchange,
  fulfilTicketExchangeCheckout,
} from "@/features/tickets/exchange.server";
import { getTicket } from "@/features/tickets/store.server";
import { issueTickets } from "@/features/tickets/tickets.server";
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
});
