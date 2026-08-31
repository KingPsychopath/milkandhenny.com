import { describe, expect, it } from "vitest";

import { groupEmailDeliveryIncidents } from "@/features/email-operations/delivery-incidents";
import type { EmailLedgerEntry } from "@/features/email-operations/types";

function entry(overrides: Partial<EmailLedgerEntry> = {}): EmailLedgerEntry {
  return {
    id: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    channel: "communications",
    kind: "communication-stage",
    source: "scheduled",
    dispatchReason: "late-join-catch-up",
    context: {},
    recipientHint: "a…@icloud.com",
    suppression: {
      recipientHash: "recipient-a",
      recipientHint: "a…@icloud.com",
      reason: "bounced",
      firstOccurredAt: "2026-08-30T20:39:00.000Z",
      lastOccurredAt: "2026-08-30T20:39:00.000Z",
    },
    subject: "Earlier event email",
    status: "failed",
    deliveryStatus: "bounced",
    attempts: 1,
    providerStatus: 422,
    providerMessageId: "provider-message",
    lastError: "Email provider reported bounced",
    payloadRetained: false,
    canRetry: false,
    canCancel: false,
    canResend: false,
    nextAttemptAt: "2026-08-30T20:39:00.000Z",
    createdAt: "2026-08-30T20:39:00.000Z",
    updatedAt: "2026-08-30T20:39:00.000Z",
    acceptedAt: "2026-08-30T20:39:00.000Z",
    deliveredAt: null,
    failedAt: "2026-08-30T20:39:00.000Z",
    cancelledAt: null,
    contentExpiresAt: "2026-09-06T20:39:00.000Z",
    retainUntil: "2026-12-28T20:39:00.000Z",
    ...overrides,
  };
}

describe("groupEmailDeliveryIncidents", () => {
  it("groups one recipient block once and identifies catch-up messages and ticket recovery", () => {
    const entries = [
      entry(),
      entry(),
      entry({
        channel: "tickets",
        kind: "ticket-issued",
        source: "system",
        dispatchReason: "requested",
        canResend: true,
      }),
    ];

    const incidents = groupEmailDeliveryIncidents(entries);

    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      recipientHash: "recipient-a",
      lateJoinCount: 2,
      recoveryEntry: { kind: "ticket-issued" },
    });
    expect(incidents[0]?.entries).toHaveLength(3);
  });

  it("keeps different recipients separate and ignores unblocked delivery history", () => {
    const incidents = groupEmailDeliveryIncidents([
      entry(),
      entry({
        suppression: {
          recipientHash: "recipient-b",
          recipientHint: "b…@icloud.com",
          reason: "complained",
          firstOccurredAt: "2026-08-30T20:39:00.000Z",
          lastOccurredAt: "2026-08-30T20:39:00.000Z",
        },
      }),
      entry({ suppression: null, deliveryStatus: "delivered" }),
    ]);

    expect(incidents.map((incident) => incident.recipientHash)).toEqual([
      "recipient-a",
      "recipient-b",
    ]);
  });
});
