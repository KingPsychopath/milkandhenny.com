import { describe, expect, it } from "vitest";

import { resolveAdminNotificationDeepLink } from "@/features/attendee-operations/notification-destination";

describe("admin notification destinations", () => {
  it("routes delivery failures to the filtered email operations surface", () => {
    expect(
      resolveAdminNotificationDeepLink({
        kind: "ticket.transfer_delivery_failed",
        category: "ticket-email-failure",
        eventSlug: "summer-night",
        entityRefs: { ticketId: "ticket_123", transferId: "transfer_123" },
        fallback: "/admin?view=operations",
      }),
    ).toBe(
      "/admin?view=communications&communicationTab=delivery&emailStatus=failed&emailQuery=ticket_123",
    );
  });

  it("routes refund cases to the affected ticket", () => {
    expect(
      resolveAdminNotificationDeepLink({
        kind: "refund.failed",
        category: "refund-failed",
        eventSlug: "summer-night",
        entityRefs: { ticketId: "ticket_123" },
      }),
    ).toBe("/admin?view=operations&operationsTab=people&ticket=ticket_123");
  });

  it("opens identity notifications on the affected person in People & Access", () => {
    expect(
      resolveAdminNotificationDeepLink({
        kind: "identity.restricted",
        category: "people-access",
        entityRefs: { personId: "person_123" },
        fallback: "/admin?view=operations",
      }),
    ).toBe("/admin?view=operations&operationsTab=people&person=person_123");
  });

  it("uses event, system, and inbox destinations for broader events", () => {
    expect(
      resolveAdminNotificationDeepLink({
        kind: "event.capacity_warning",
        category: "event-capacity",
        eventSlug: "summer-night",
        entityRefs: {},
      }),
    ).toBe("/admin?view=events&event=summer-night");
    expect(
      resolveAdminNotificationDeepLink({
        kind: "system.unknown",
        category: "system",
        entityRefs: {},
      }),
    ).toBe("/admin?view=system");
    expect(
      resolveAdminNotificationDeepLink({
        kind: "operations.unknown",
        category: "other",
        entityRefs: {},
      }),
    ).toBe("/admin?view=overview#notifications");
  });
});
