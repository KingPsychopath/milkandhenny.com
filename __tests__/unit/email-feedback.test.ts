import { describe, expect, it } from "vitest";

import { __emailFeedbackTesting } from "@/lib/platform/email-feedback.server";

describe("email delivery feedback", () => {
  it("parses a permanent delivery event without retaining the address", () => {
    const event = __emailFeedbackTesting.parseVerifiedEvent(
      {
        type: "email.bounced",
        created_at: "2026-08-14T12:00:00.000Z",
        data: { email_id: "email_123", to: ["Guest@Example.com"] },
      },
      "event_123",
    );

    expect(event).toEqual({
      eventId: "event_123",
      type: "email.bounced",
      occurredAt: new Date("2026-08-14T12:00:00.000Z"),
      providerMessageId: "email_123",
      recipients: ["Guest@Example.com"],
    });
    expect(__emailFeedbackTesting.hashRecipient(" Guest@Example.com ")).toBe(
      __emailFeedbackTesting.hashRecipient("guest@example.com"),
    );
  });

  it("ignores delivery events that do not suppress future email", () => {
    expect(
      __emailFeedbackTesting.parseVerifiedEvent(
        {
          type: "email.delivered",
          created_at: "2026-08-14T12:00:00.000Z",
          data: { email_id: "email_123", to: ["guest@example.com"] },
        },
        "event_123",
      ),
    ).toBeNull();
  });

  it("rejects malformed handled events", () => {
    expect(() =>
      __emailFeedbackTesting.parseVerifiedEvent(
        { type: "email.complained", created_at: "not-a-date", data: {} },
        "event_123",
      ),
    ).toThrow("payload is invalid");
  });
});
