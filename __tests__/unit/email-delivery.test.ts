import { afterEach, describe, expect, it, vi } from "vitest";

import { __emailOutboxTesting } from "@/lib/platform/email-outbox.server";
import { deliverEmailNow } from "@/lib/platform/email.server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function configureCloudflare() {
  vi.stubEnv("EMAIL_PROVIDER", "cloudflare");
  vi.stubEnv("EMAIL_API_KEY", "test-key");
  vi.stubEnv("EMAIL_ACCOUNT_ID", "test-account");
  vi.stubEnv("EMAIL_TICKETS_FROM", "tickets@example.com");
  vi.stubEnv("EMAIL_REPLY_TO", "reply@example.com");
}

describe("email provider delivery", () => {
  it("sends the documented Cloudflare REST attachment shape", async () => {
    configureCloudflare();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          errors: [],
          result: { message_id: "message-1", delivered: [], queued: ["person@example.com"] },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deliverEmailNow(
        {
          channel: "tickets",
          to: "person@example.com",
          subject: "Your ticket",
          text: "Open your ticket.",
          html: '<img src="cid:ticketqr">',
          attachments: [
            {
              content: "cG5n",
              filename: "ticket.png",
              type: "image/png",
              disposition: "inline",
              contentId: "ticketqr",
            },
          ],
        },
        "tickets:issued:order-1",
      ),
    ).resolves.toEqual({ ok: true, id: "message-1" });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(request?.body))).toMatchObject({
      from: { address: "tickets@example.com", name: "milk & henny tickets" },
      reply_to: "reply@example.com",
      headers: { "X-Milk-Henny-Delivery": "tickets:issued:order-1" },
      attachments: [
        {
          content: "cG5n",
          filename: "ticket.png",
          type: "image/png",
          disposition: "inline",
          content_id: "ticketqr",
        },
      ],
    });
  });

  it("rejects a permanent bounce even when Cloudflare returns 200", async () => {
    configureCloudflare();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            errors: [],
            result: { message_id: "message-2", permanent_bounces: ["bad@example.com"] },
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      deliverEmailNow({
        channel: "tickets",
        to: "bad@example.com",
        subject: "Your ticket",
        text: "Open your ticket.",
      }),
    ).resolves.toEqual({
      ok: false,
      status: 422,
      error: "Recipient address permanently bounced",
    });
  });

  it("gives Resend the outbox idempotency key", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("EMAIL_API_KEY", "test-key");
    vi.stubEnv("EMAIL_STUDIO_FROM", "studio@example.com");
    vi.stubEnv("EMAIL_REPLY_TO", "reply@example.com");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "resend-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deliverEmailNow(
        {
          channel: "studio",
          to: "person@example.com",
          subject: "Your pitch",
          text: "Open your pitch.",
        },
        "pitches:welcome:p_123",
      ),
    ).resolves.toEqual({ ok: true, id: "resend-1" });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "Idempotency-Key": "pitches:welcome:p_123" }),
    });
  });
});

describe("email outbox policy", () => {
  it("retries temporary failures and stops invalid messages", () => {
    expect(
      __emailOutboxTesting.isPermanentFailure({ ok: false, status: 429, error: "limited" }),
    ).toBe(false);
    expect(__emailOutboxTesting.isPermanentFailure({ ok: false, status: 503, error: "down" })).toBe(
      false,
    );
    expect(
      __emailOutboxTesting.isPermanentFailure({ ok: false, status: 422, error: "bad address" }),
    ).toBe(true);
    expect(__emailOutboxTesting.retryDelaySeconds(1)).toBe(60);
    expect(__emailOutboxTesting.retryDelaySeconds(7)).toBe(86_400);
  });

  it("validates stored messages before delivery", () => {
    expect(
      __emailOutboxTesting.parseMessage({
        channel: "studio",
        to: "person@example.com",
        subject: "Your pitch",
        text: "Open your pitch.",
      }),
    ).toEqual({
      channel: "studio",
      to: "person@example.com",
      subject: "Your pitch",
      text: "Open your pitch.",
    });
    expect(
      __emailOutboxTesting.parseMessage({ channel: "studio", to: "person@example.com" }),
    ).toBeNull();
  });
});
