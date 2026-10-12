export const HANGOUT = "00000000-0000-4000-8000-000000000002";
export const EVENT_ID = "00000000-0000-4000-8000-000000000001";
export const ORDER_ID = "00000000-0000-4000-8000-000000000003";
export const TICKET_ID = "00000000-0000-4000-8000-000000000005";
export function sonderOrder(quantity = 1, orderId = ORDER_ID, ticketId = TICKET_ID) {
  return {
    hangout_id: HANGOUT,
    order_id: orderId,
    status: "paid",
    purchaser: { name: "Synthetic Buyer", email: "buyer@example.com" },
    ticket_type: { id: "00000000-0000-4000-8000-000000000004", name: "Entry" },
    quantity,
    currency: "gbp",
    amount_total_minor: 1500 * quantity,
    amount_refunded_minor: 0,
    paid_at: new Date().toISOString(),
    refunded_at: null,
    review_required: false,
    tickets: Array.from({ length: quantity }, (_, i) => ({
      id: i === 0 ? ticketId : `00000000-0000-4000-8000-${String(100 + i).padStart(12, "0")}`,
      ordinal: i + 1,
      status: "valid",
      checked_in_at: null,
      qr_payload: "sonder:ticket:v1:" + "a".repeat(64),
    })),
  };
}
