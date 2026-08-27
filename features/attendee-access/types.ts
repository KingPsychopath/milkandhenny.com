import type { PersonGameHistoryItem, PersonGameStats } from "@/features/person-games/types";

export type AttendeeAccount = {
  name: string | null;
  gameHistory: PersonGameHistoryItem[];
  gameStats: PersonGameStats[];
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

export type AttendeeTicketIdentity = {
  account: { name: string | null } | null;
  personallyClaimed: boolean;
  anotherClaimedTicketName?: string;
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
  let pathname: string;
  try {
    pathname = new URL(trimmed, "https://return.invalid").pathname;
  } catch {
    return "/my";
  }
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return "/my";
  }
  if (
    decodedPathname.startsWith("//") ||
    decodedPathname.includes("\\") ||
    [...decodedPathname].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  ) {
    return "/my";
  }
  const allowed =
    decodedPathname === "/" ||
    [
      "/my",
      "/admin",
      "/events",
      "/ticket",
      "/t",
      "/things",
      "/pics",
      "/words",
      "/vault",
      "/surveys",
      "/best-dressed",
      "/party",
      "/icebreaker",
      "/pitch-night",
    ].some((prefix) => decodedPathname === prefix || decodedPathname.startsWith(`${prefix}/`));
  return allowed ? trimmed : "/my";
}

export function attendeeSignInHref(returnTo: unknown): string {
  return `/access?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}
