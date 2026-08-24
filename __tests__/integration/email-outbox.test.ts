import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { drainEmailOutbox, enqueueEmail } from "@/lib/platform/email-outbox.server";
import { recordEmailDeliveryEvent } from "@/lib/platform/email-delivery-events.server";
import {
  prepareCommunicationLinkMap,
  recordCommunicationLinkClick,
} from "@/features/communications/email-links.server";
import { communicationLinkKey } from "@/features/communications/email.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

describeWithDatabase("email outbox (postgres)", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);

  beforeEach(async () => {
    await truncateAll();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("deduplicates delivery and removes private content after provider acceptance", async () => {
    const message = {
      channel: "tickets" as const,
      to: "person@example.com",
      subject: "Your ticket",
      text: "Private ticket link",
    };
    const first = await enqueueEmail(message, {
      idempotencyKey: "tickets:issued:order-1",
      deliverNow: false,
    });
    const duplicate = await enqueueEmail(message, {
      idempotencyKey: "tickets:issued:order-1",
      deliverNow: false,
    });
    expect(first).toEqual(duplicate);

    const pending = await query<{ count: string; message: unknown }>(
      `select count(*)::text as count, min(message::text)::jsonb as message from email_outbox`,
    );
    expect(pending[0]?.count).toBe("1");
    expect(pending[0]?.message).toMatchObject({ to: "person@example.com" });

    vi.stubEnv("EMAIL_API_KEY", "test-key");
    vi.stubEnv("EMAIL_ACCOUNT_ID", "test-account");
    vi.stubEnv("EMAIL_TICKETS_FROM", "tickets@example.com");
    vi.stubEnv("EMAIL_REPLY_TO", "reply@example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            errors: [],
            result: { message_id: "provider-1", queued: ["person@example.com"] },
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(drainEmailOutbox()).resolves.toBe(1);
    const accepted = await query<{
      status: string;
      message: unknown;
      provider_message_id: string | null;
    }>(`select status, message, provider_message_id from email_outbox`);
    expect(accepted[0]).toEqual({
      status: "accepted",
      message: null,
      provider_message_id: "provider-1",
    });

    await recordEmailDeliveryEvent({
      eventId: "delivered-1",
      type: "delivered",
      occurredAt: new Date("2026-08-14T12:00:00.000Z"),
      providerMessageId: "provider-1",
      recipients: ["PERSON@example.com"],
    });
    const delivered = await query<{
      status: string;
      provider_delivery_status: string | null;
    }>(`select status, provider_delivery_status from email_outbox`);
    expect(delivered[0]).toEqual({ status: "accepted", provider_delivery_status: "delivered" });

    vi.stubEnv("AUTH_SECRET", "test-auth-secret");
    const sourceId = randomUUID();
    const links = await prepareCommunicationLinkMap({
      body: "[Practise spelling](/things/spelling-bee)",
      context: {},
      origin: "http://localhost:3000",
      media: [],
      source: {
        sourceType: "message",
        sourceId,
        recipientHash: "a".repeat(64),
      },
    });
    const tracked = links.get(communicationLinkKey("/things/spelling-bee") ?? "");
    expect(tracked).toBeTruthy();
    const token = tracked ? new URL(tracked).searchParams.get("token") : null;
    await expect(recordCommunicationLinkClick(token ?? "")).resolves.toBe("/things/spelling-bee");
    const click = await query<{ click_count: number }>(
      `select click_count from communication_links where source_id = $1`,
      [sourceId],
    );
    expect(click[0]?.click_count).toBe(1);

    await recordEmailDeliveryEvent({
      eventId: "feedback-1",
      type: "bounced",
      occurredAt: new Date("2026-08-14T12:00:00.000Z"),
      providerMessageId: "provider-1",
      recipients: ["PERSON@example.com"],
    });
    const bounced = await query<{ status: string; provider_status: number }>(
      `select status, provider_status from email_outbox`,
    );
    expect(bounced[0]).toEqual({ status: "failed", provider_status: 422 });
    await expect(
      enqueueEmail(message, { idempotencyKey: "tickets:issued:order-2", deliverNow: false }),
    ).resolves.toEqual({
      ok: false,
      status: 422,
      error: "Recipient address is suppressed after a delivery failure",
    });
  });
});
