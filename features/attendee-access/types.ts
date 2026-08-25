export type AttendeeAccount = {
  personId: string;
  name: string | null;
  emails: Array<{ id: string; masked: string; verifiedAt: string }>;
  tickets: Array<{
    id: string;
    publicId: string;
    orderId: string;
    eventSlug: string;
    eventTitle: string;
    holderName: string;
    status: string;
    startsAt: string;
    points: number;
    rank?: number;
    publicAlias?: string;
    scoreHistory: Array<{ points: number; reason: string; createdAt: string }>;
    personallyClaimed: boolean;
    managesOrder: boolean;
  }>;
  ticketOperations: {
    incomingAssignments: AttendeeTicketOperation[];
    incomingTransfers: AttendeeTicketOperation[];
    outgoingAssignments: AttendeeTicketOperation[];
    outgoingTransfers: AttendeeTicketOperation[];
    returnRequests: Array<AttendeeTicketOperation & { canCancel: boolean }>;
  };
  access: Array<{
    kind: "global" | "event";
    label: string;
    eventSlug?: string;
    status: string;
    expiresAt?: string;
    href?: string;
  }>;
};

export type AttendeeTicketOperation = {
  id: string;
  ticketId: string;
  eventSlug: string;
  eventTitle: string;
  status: string;
  expiresAt: string;
};

export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/my";
  const trimmed = value.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    trimmed.length > 500 ||
    [...trimmed].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  ) {
    return "/my";
  }
  return trimmed;
}

export function attendeeSignInHref(returnTo: unknown): string {
  return `/access?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}
