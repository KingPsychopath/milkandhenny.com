export type AttendeeAccount = {
  personId: string;
  name: string | null;
  emails: Array<{ masked: string; verifiedAt: string }>;
  tickets: Array<{
    id: string;
    orderId: string;
    eventSlug: string;
    eventTitle: string;
    holderName: string;
    points: number;
    personallyClaimed: boolean;
    managesOrder: boolean;
  }>;
};

export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/my";
  const trimmed = value.trim();
  return trimmed.startsWith("/") && !trimmed.startsWith("//") && trimmed.length <= 500
    ? trimmed
    : "/my";
}
