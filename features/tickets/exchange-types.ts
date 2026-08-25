export const TICKET_EXCHANGE_STATUSES = [
  "processing",
  "awaiting_payment",
  "refund_pending",
  "completed",
  "failed",
  "cancelled",
  "expired",
] as const;

export type TicketExchangeStatus = (typeof TICKET_EXCHANGE_STATUSES)[number];

export type TicketExchangeOption = {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
  available: boolean;
  unavailableReason?: "sold-out" | "not-on-sale";
};

export type ManagedExchangeTicket = {
  id: string;
  holderName: string;
  ticketTypeId: string;
  ticketTypeName: string;
  amountPaidMinor: number;
  currency: string;
  status: "valid" | "void" | "refunded";
  redeemed: boolean;
  activeExchange?: {
    id: string;
    status: TicketExchangeStatus;
    toTicketTypeName: string;
    amountDeltaMinor: number;
    errorMessage?: string;
  };
};

export type TicketExchangeManagement = {
  orderId: string;
  tickets: ManagedExchangeTicket[];
  options: TicketExchangeOption[];
  exchangesCloseAt: string;
};
