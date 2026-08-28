type NotificationDestinationInput = {
  kind: string;
  category: string;
  eventSlug?: string;
  entityRefs: Record<string, unknown>;
  fallback?: string;
};

function ref(input: NotificationDestinationInput, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input.entityRefs[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function adminLink(values: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) search.set(key, value);
  }
  return `/admin?${search}`;
}

function safeFallback(value: string | undefined): string | undefined {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  return value;
}

export function resolveAdminNotificationDeepLink(input: NotificationDestinationInput): string {
  const ticketId = ref(input, "ticketId");
  const personId = ref(input, "personId", "purchaserPersonId", "senderPersonId");
  const eventSlug = input.eventSlug ?? ref(input, "eventSlug");
  const emailRecord = ref(
    input,
    "orderId",
    "ticketId",
    "outboxId",
    "assignmentId",
    "transferId",
    "returnRequestId",
    "adminGrantId",
    "staffAssignmentId",
    "operationId",
  );
  const emailFailure =
    input.kind.includes("email_failed") ||
    input.kind.includes("delivery_failed") ||
    input.kind.startsWith("email.delivery_") ||
    input.category.includes("email-fail") ||
    input.category === "email-delivery";

  if (emailFailure) {
    return adminLink({
      view: "communications",
      communicationTab: "delivery",
      emailQuery: emailRecord,
    });
  }
  if (input.kind.startsWith("refund.") || input.kind.includes("refund_failed")) {
    return adminLink({
      view: "operations",
      operationsTab: "people",
      ticket: ticketId,
      event: ticketId ? undefined : eventSlug,
    });
  }
  if (input.kind.startsWith("staff.")) {
    return adminLink({ view: "events", event: eventSlug });
  }
  if (input.kind.startsWith("system.") || input.category === "system") {
    return adminLink({ view: "system" });
  }
  if (ticketId || personId) {
    return adminLink({
      view: "operations",
      operationsTab: "people",
      ticket: ticketId,
      person: personId,
    });
  }
  if (
    input.kind.startsWith("identity.") ||
    input.category.includes("people") ||
    input.category.includes("identity")
  ) {
    return adminLink({ view: "operations", operationsTab: "people" });
  }
  if (eventSlug) return adminLink({ view: "events", event: eventSlug });
  return safeFallback(input.fallback) ?? `${adminLink({ view: "overview" })}#notifications`;
}
