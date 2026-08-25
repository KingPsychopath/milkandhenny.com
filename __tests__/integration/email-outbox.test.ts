import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { drainEmailOutbox, enqueueEmail } from "@/lib/platform/email-outbox.server";
import { recordEmailDeliveryEvent } from "@/lib/platform/email-delivery-events.server";
import {
  prepareCommunicationLinkMap,
  recordCommunicationLinkClick,
} from "@/features/communications/email-links.server";
import { communicationLinkKey } from "@/features/communications/email.server";
import {
  cleanupEmailOperations,
  listEmailLedger,
} from "@/features/email-operations/email-operations.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { __migrationsForTesting } from "@/lib/platform/migrations.server";
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
      kind: "ticket-issued",
      source: "self-service",
      context: { eventSlug: "party", orderId: "order-1" },
      deliverNow: false,
    });
    const duplicate = await enqueueEmail(message, {
      idempotencyKey: "tickets:issued:order-1",
      kind: "ticket-issued",
      deliverNow: false,
    });
    expect(first).toEqual(duplicate);

    const pending = await query<{
      count: string;
      message: unknown;
      recipient_hint: string;
      subject_hint: string;
    }>(
      `select count(*)::text as count, min(message::text)::jsonb as message,
              min(recipient_hint) as recipient_hint, min(subject_hint) as subject_hint
         from email_outbox`,
    );
    expect(pending[0]?.count).toBe("1");
    expect(pending[0]?.message).toMatchObject({ to: "person@example.com" });
    expect(pending[0]?.recipient_hint).toBe("p…@example.com");
    expect(pending[0]?.subject_hint).toBe("Your ticket");

    const ledger = await listEmailLedger({
      page: 1,
      limit: 20,
      sort: "newest",
      query: "PERSON@example.com",
    });
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({
      kind: "ticket-issued",
      source: "self-service",
      recipientHint: "p…@example.com",
      subject: "Your ticket",
      context: { eventSlug: "party", orderId: "order-1" },
      payloadRetained: true,
    });

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
      enqueueEmail(message, {
        idempotencyKey: "tickets:issued:order-2",
        kind: "ticket-issued",
        deliverNow: false,
      }),
    ).resolves.toEqual({
      ok: false,
      status: 422,
      error: "Recipient address is suppressed after a delivery failure",
    });
  });

  it("expires undeliverable content and removes old operational records", async () => {
    await enqueueEmail(
      {
        channel: "studio",
        to: "owner@example.com",
        subject: "Private recovery link",
        text: "secret",
      },
      {
        idempotencyKey: "pitches:recovery:expired",
        kind: "pitch-recovery",
        deliverNow: false,
      },
    );
    await query(`update email_outbox set content_expires_at = now() - interval '1 minute'`);
    await expect(drainEmailOutbox()).resolves.toBe(1);
    const expired = await query<{ status: string; message: unknown; last_error: string }>(
      `select status, message, last_error from email_outbox`,
    );
    expect(expired[0]).toMatchObject({
      status: "failed",
      message: null,
      last_error: "Delivery window expired before the provider accepted the message",
    });

    await query(`update email_outbox set retain_until = now()`);
    const result = await cleanupEmailOperations();
    expect(result).toMatchObject({ expiredMessages: 0, deletedLedgerEntries: 1 });
    await expect(query(`select id from email_outbox`)).resolves.toHaveLength(0);
  });

  it("starts retention from a future scheduled delivery, not from queueing", async () => {
    const notBefore = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000);
    await enqueueEmail(
      {
        channel: "communications",
        to: "guest@example.com",
        subject: "Scheduled event update",
        text: "See you next month",
      },
      {
        idempotencyKey: "communications:scheduled-retention:guest",
        kind: "communication",
        source: "scheduled",
        notBefore,
        deliverNow: false,
      },
    );
    const rows = await query<{
      next_attempt_at: Date;
      content_expires_at: Date;
      retain_until: Date;
    }>(`select next_attempt_at, content_expires_at, retain_until from email_outbox`);
    expect(rows[0]?.next_attempt_at.toISOString()).toBe(notBefore.toISOString());
    expect((rows[0]?.content_expires_at.getTime() ?? 0) - notBefore.getTime()).toBe(
      7 * 24 * 60 * 60 * 1_000,
    );
    expect((rows[0]?.retain_until.getTime() ?? 0) - notBefore.getTime()).toBe(
      120 * 24 * 60 * 60 * 1_000,
    );
  });

  it("does not expire a message while another worker still owns its lease", async () => {
    await enqueueEmail(
      {
        channel: "tickets",
        to: "guest@example.com",
        subject: "Ticket",
        text: "ticket",
      },
      {
        idempotencyKey: "tickets:issued:leased-order",
        kind: "ticket-issued",
        deliverNow: false,
      },
    );
    await query(
      `update email_outbox
          set status = 'processing', attempts = 10,
              locked_until = now() + interval '1 hour',
              content_expires_at = now() - interval '1 minute'`,
    );
    await expect(cleanupEmailOperations()).resolves.toMatchObject({ expiredMessages: 0 });
    const active = await query<{ status: string; payload_retained: boolean }>(
      `select status, message is not null as payload_retained from email_outbox`,
    );
    expect(active[0]).toEqual({ status: "processing", payload_retained: true });

    await query(`update email_outbox set locked_until = now() - interval '1 minute'`);
    await expect(cleanupEmailOperations()).resolves.toMatchObject({ expiredMessages: 1 });
  });

  it("upgrades accepted legacy rows into searchable refund ledger entries", async () => {
    const migrations = __migrationsForTesting();
    const legacyMigrations = migrations.slice(
      0,
      migrations.findIndex((migration) => migration.id === "0032_marketing_consent"),
    );
    const ledgerMigration = migrations.find(
      (migration) => migration.id === "0053_email_operations_ledger",
    );
    expect(ledgerMigration).toBeDefined();

    await transaction(async (client) => {
      await client.query(`drop schema if exists email_upgrade_contract cascade`);
      await client.query(`create schema email_upgrade_contract`);
      await client.query(`set local search_path to email_upgrade_contract, public`);
      for (const migration of legacyMigrations) await client.query(migration.sql);
      await client.query(
        `insert into email_outbox (
           id, idempotency_key, channel, recipient_hash, message, status, accepted_at
         ) values (
           '22222222-2222-4222-8222-222222222222',
           'tickets:refund:order-before-ledger:refund-before-ledger',
           'tickets', $1, null, 'accepted', now()
         )`,
        ["b".repeat(64)],
      );
      await client.query(ledgerMigration?.sql ?? "");
      const result = await client.query<{
        kind: string;
        subject_hint: string;
        context: { orderId?: string };
        message: unknown;
      }>(
        `select kind, subject_hint, context, message
           from email_outbox
          where id = '22222222-2222-4222-8222-222222222222'`,
      );
      expect(result.rows[0]).toEqual({
        kind: "ticket-refund",
        subject_hint: "Refund confirmation",
        context: { orderId: "order-before-ledger" },
        message: null,
      });
      await client.query(`drop schema email_upgrade_contract cascade`);
    });
  });
});
