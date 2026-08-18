import type { TicketRecord } from "./types";

export type TicketOrderAccess = {
  tickets: TicketRecord[];
  orderSize: number;
  orderPosition: number;
  canManageOrder: boolean;
  managerTicketId?: string;
};

/**
 * A primary ticket is the purchaser capability for the whole order. Child
 * ticket links remain useful on their own without disclosing sibling links.
 */
export function resolveTicketOrderAccess(
  ticket: TicketRecord,
  order: TicketRecord[],
  managedOrderIds: readonly string[],
): TicketOrderAccess {
  const sorted = [...order].sort((left, right) => {
    const leftChild = left.parentTicketId ? 1 : 0;
    const rightChild = right.parentTicketId ? 1 : 0;
    return (
      leftChild - rightChild ||
      left.issuedAt.localeCompare(right.issuedAt) ||
      left.id.localeCompare(right.id)
    );
  });
  const primary = sorted.find((entry) => !entry.parentTicketId);
  const orderPosition = sorted.findIndex((entry) => entry.id === ticket.id) + 1;
  const canManageOrder = primary?.id === ticket.id || managedOrderIds.includes(ticket.orderId);

  return {
    tickets: canManageOrder ? sorted : [ticket],
    orderSize: sorted.length,
    orderPosition: Math.max(1, orderPosition),
    canManageOrder,
    managerTicketId: canManageOrder ? primary?.id : undefined,
  };
}
