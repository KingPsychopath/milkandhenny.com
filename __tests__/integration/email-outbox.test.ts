import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { drainEmailOutbox, enqueueEmail } from "@/lib/platform/email-outbox.server";
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

    vi.stubEnv("EMAIL_PROVIDER", "cloudflare");
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
  });
});
