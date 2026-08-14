import { describe, expect, it, vi } from "vitest";

import {
  __emailFeedbackTesting,
  authenticateCloudflareEmailRelay,
  parseCloudflareEmailFeedback,
} from "@/lib/platform/email-feedback.server";

describe("Cloudflare email delivery feedback", () => {
  it("parses a bounce without retaining the address in its identity", () => {
    const event = parseCloudflareEmailFeedback(
      {
        type: "cf.email.sending.message.bounced",
        source: { type: "email.sending", domain: "tickets.milkandhenny.com" },
        payload: { messageId: "email_123", recipient: "Guest@Example.com" },
      },
      "event_123",
      new Date("2026-08-14T12:00:00.000Z"),
    );

    expect(event).toEqual({
      eventId: "event_123",
      type: "cf.email.sending.message.bounced",
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
      parseCloudflareEmailFeedback(
        {
          type: "cf.email.sending.message.delivered",
          source: { type: "email.sending" },
          payload: { messageId: "email_123", recipient: "guest@example.com" },
        },
        "event_123",
        new Date(),
      ),
    ).toBeNull();
  });

  it("rejects malformed handled events", () => {
    expect(() =>
      parseCloudflareEmailFeedback(
        {
          type: "cf.email.sending.message.complained",
          source: { type: "email.routing" },
          payload: {},
        },
        "event_123",
        new Date(),
      ),
    ).toThrow("payload is invalid");
  });

  it("authenticates the queue relay with its dedicated bearer secret", () => {
    vi.stubEnv("EMAIL_EVENT_SECRET", "cloudflare-event-secret");
    expect(
      authenticateCloudflareEmailRelay(
        new Request("https://example.com/api/email/events/cloudflare", {
          headers: { authorization: "Bearer cloudflare-event-secret" },
        }),
      ),
    ).toBe(true);
    expect(
      authenticateCloudflareEmailRelay(
        new Request("https://example.com/api/email/events/cloudflare", {
          headers: { authorization: "Bearer wrong" },
        }),
      ),
    ).toBe(false);
    vi.unstubAllEnvs();
  });
});
