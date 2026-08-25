export const ADMIN_ALERT_CATEGORIES = [
  {
    id: "refund-failed",
    label: "refund failed",
    description: "A ticket refund failed or only partly completed at the payment provider.",
  },
  {
    id: "event-cancellation-refund-failed",
    label: "cancellation refund failed",
    description: "An automatic refund failed while cancelling an event.",
  },
  {
    id: "access-email-failed",
    label: "access email failed",
    description: "A staff or administrator invitation could not be delivered.",
  },
  {
    id: "ticket-email-failure",
    label: "ticket update email failed",
    description: "An assignment, transfer, return, or other ticket update was not delivered.",
  },
  {
    id: "refund-consent-email-failed",
    label: "refund consent email failed",
    description: "A holder did not receive the link needed to review a ticket return.",
  },
] as const;

export type AdminAlertCategory = (typeof ADMIN_ALERT_CATEGORIES)[number]["id"];
