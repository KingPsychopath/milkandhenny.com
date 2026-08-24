import { describe, expect, it, vi } from "vitest";

import { __emailDeliveryTesting } from "@/lib/platform/email-delivery-events.server";
import {
  authenticateCloudflareEmailRelay,
  parseCloudflareEmailDeliveryEvent,
} from "@/lib/platform/email-providers/cloudflare-email-events.server";

describe("Cloudflare email delivery events", () => {
  it("parses a bounce without retaining the address in its identity", () => {
    const event = parseCloudflareEmailDeliveryEvent(
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
      type: "bounced",
      occurredAt: new Date("2026-08-14T12:00:00.000Z"),
      providerMessageId: "email_123",
      recipients: ["Guest@Example.com"],
    });
    expect(__emailDeliveryTesting.hashRecipient(" Guest@Example.com ")).toBe(
      __emailDeliveryTesting.hashRecipient("guest@example.com"),
    );
  });

  it.each([
    ["delivered", "cf.email.sending.message.delivered"],
    ["deferred", "cf.email.sending.message.deferred"],
    ["failed", "cf.email.sending.message.failed"],
    ["rejected", "cf.email.sending.message.rejected"],
    ["complained", "cf.email.sending.message.complained"],
  ] as const)("normalizes %s events at the provider boundary", (status, providerType) => {
    expect(
      parseCloudflareEmailDeliveryEvent(
        {
          type: providerType,
          source: { type: "email.sending" },
          payload: { messageId: "email_123", recipient: "guest@example.com" },
        },
        "event_123",
        new Date("2026-08-14T12:00:00.000Z"),
      )?.type,
    ).toBe(status);
  });

  it("rejects malformed handled events", () => {
    expect(() =>
      parseCloudflareEmailDeliveryEvent(
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
