import { describe, expect, it } from "vitest";

import { resolveTicketOrderAccess } from "@/features/tickets/order-access";
import type { TicketRecord } from "@/features/tickets/types";

const ORDER_ID = "ord_1234567890abcdef";

function ticket(id: string, parentTicketId?: string): TicketRecord {
  return {
    id,
    eventSlug: "pitch-night",
    ticketTypeId: "entry",
    kind: "paid",
    status: "valid",
    holderName: id,
    orderId: ORDER_ID,
    parentTicketId,
    issuedAt: "2026-08-18T12:00:00.000Z",
  };
}

const primary = ticket("0000000000000001");
const second = ticket("0000000000000002", primary.id);
const third = ticket("0000000000000003", primary.id);
const unsortedOrder = [third, primary, second];

describe("ticket order access", () => {
  it("shows the purchaser every ticket in a stable order", () => {
    const access = resolveTicketOrderAccess(primary, unsortedOrder, []);

    expect(access.canManageOrder).toBe(true);
    expect(access.managerTicketId).toBe(primary.id);
    expect(access.tickets.map((entry) => entry.id)).toEqual([primary.id, second.id, third.id]);
    expect(access.orderPosition).toBe(1);
    expect(access.orderSize).toBe(3);
  });

  it("shows a separately shared ticket only itself and its set position", () => {
    const access = resolveTicketOrderAccess(second, unsortedOrder, []);

    expect(access.canManageOrder).toBe(false);
    expect(access.managerTicketId).toBeUndefined();
    expect(access.tickets).toEqual([second]);
    expect(access.orderPosition).toBe(2);
    expect(access.orderSize).toBe(3);
  });

  it("keeps the full set available on the purchaser's browser", () => {
    const access = resolveTicketOrderAccess(third, unsortedOrder, [ORDER_ID]);

    expect(access.canManageOrder).toBe(true);
    expect(access.managerTicketId).toBe(primary.id);
    expect(access.tickets).toHaveLength(3);
    expect(access.orderPosition).toBe(3);
  });
});
