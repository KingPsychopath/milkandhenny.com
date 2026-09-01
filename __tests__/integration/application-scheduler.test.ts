import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { expandDueCommunicationStages } from "@/features/communications/communication-plans.server";
import { enqueueEmail, hashEmailRecipient } from "@/lib/platform/email-outbox.server";
import {
  describeScheduledJobs,
  runLeasedScheduledJobEffect,
} from "@/lib/platform/scheduled-jobs.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

describeWithDatabase("application scheduler (postgres)", () => {
  const runLeased = <T>(options: {
    jobKey: string;
    intervalMs: number;
    retryMs: number;
    leaseMs: number;
    force?: boolean;
    run: () => Promise<T>;
  }) =>
    Effect.runPromise(
      runLeasedScheduledJobEffect({ ...options, run: Effect.promise(options.run) }),
    );

  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    await truncateAll();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("runs one lease holder and waits until the durable next run", async () => {
    let calls = 0;
    const run = () => {
      calls += 1;
      return Promise.resolve({ queued: calls });
    };
    const options = {
      jobKey: "test-delivery",
      intervalMs: 60_000,
      retryMs: 1_000,
      leaseMs: 30_000,
      run,
    };

    await expect(runLeased(options)).resolves.toMatchObject({
      ran: true,
      value: { queued: 1 },
    });
    await expect(runLeased(options)).resolves.toEqual({ ran: false });
    expect(calls).toBe(1);

    const [snapshot] = await describeScheduledJobs();
    expect(snapshot).toMatchObject({
      jobKey: "test-delivery",
      attemptCount: 1,
      failureCount: 0,
      lastError: null,
    });
    expect(snapshot?.lastSucceededAt).not.toBeNull();
    expect(new Date(snapshot?.nextRunAt ?? 0).getTime()).toBeGreaterThan(Date.now());
  });

  it("records a failure, releases its lease, and permits a forced recovery", async () => {
    await expect(
      runLeased({
        jobKey: "test-recovery",
        intervalMs: 60_000,
        retryMs: 60_000,
        leaseMs: 30_000,
        run: () => Promise.reject(new Error("temporary failure")),
      }),
    ).rejects.toThrow("temporary failure");

    const failed = await describeScheduledJobs();
    expect(failed[0]).toMatchObject({
      jobKey: "test-recovery",
      failureCount: 1,
      lastError: "temporary failure",
      leaseUntil: null,
    });

    await expect(
      runLeased({
        jobKey: "test-recovery",
        intervalMs: 60_000,
        retryMs: 60_000,
        leaseMs: 30_000,
        force: true,
        run: () => Promise.resolve("recovered"),
      }),
    ).resolves.toMatchObject({ ran: true, value: "recovered" });

    const recovered = await describeScheduledJobs();
    expect(recovered[0]).toMatchObject({
      attemptCount: 2,
      failureCount: 1,
      lastError: null,
    });
    expect(recovered[0]?.lastSucceededAt).not.toBeNull();
  });

  it("reclaims work after a crashed runner's lease expires", async () => {
    await query(
      `insert into application_scheduled_jobs
         (job_key,next_run_at,lease_token,lease_until)
       values ('test-stale',now() - interval '1 minute',$1,now() - interval '1 second')`,
      [crypto.randomUUID()],
    );

    await expect(
      runLeased({
        jobKey: "test-stale",
        intervalMs: 60_000,
        retryMs: 1_000,
        leaseMs: 30_000,
        run: () => Promise.resolve(1),
      }),
    ).resolves.toMatchObject({ ran: true, value: 1 });
  });

  it("records Effect failures and releases the durable lease", async () => {
    await expect(
      Effect.runPromise(
        runLeasedScheduledJobEffect({
          jobKey: "test-effect-failure",
          intervalMs: 60_000,
          retryMs: 1_000,
          leaseMs: 30_000,
          run: Effect.fail(new Error("effect failure")),
        }),
      ),
    ).rejects.toThrow("effect failure");

    const [failed] = await describeScheduledJobs();
    expect(failed).toMatchObject({
      jobKey: "test-effect-failure",
      failureCount: 1,
      leaseUntil: null,
    });
  });

  it("resumes an interrupted communication fan-out without losing or duplicating recipients", async () => {
    const eventSlug = "scheduler-test-event";
    const planId = randomUUID();
    const stageId = randomUUID();
    const firstEmail = "first@example.com";
    const secondEmail = "second@example.com";
    const firstHash = hashEmailRecipient(firstEmail);
    const secondHash = hashEmailRecipient(secondEmail);

    await query(
      `insert into events (slug,title,status,starts_at,timezone)
       values ($1,'Scheduler test','published',now() + interval '1 day','Europe/London')`,
      [eventSlug],
    );
    await query(
      `insert into ticket_types (event_slug,id,name,quantity) values ($1,'general','General',10)`,
      [eventSlug],
    );
    await query(
      `insert into tickets
         (id,event_slug,ticket_type_id,holder_name,email,email_hash,order_id,issued_at)
       values
         ('TICKET-SCHEDULER-01',$1,'general','First',$2,$3,'order-1',now() - interval '2 days'),
         ('TICKET-SCHEDULER-02',$1,'general','Second',$4,$5,'order-2',now() - interval '2 days')`,
      [eventSlug, firstEmail, firstHash, secondEmail, secondHash],
    );
    await query(
      `insert into communication_contacts
         (email_hash,email,display_name,sources,unsubscribe_token)
       values ($1,$2,'First','{event}',$3),($4,$5,'Second','{event}',$6)`,
      [firstHash, firstEmail, randomUUID(), secondHash, secondEmail, randomUUID()],
    );
    await query(
      `insert into communication_plans (id,event_slug,name,status)
       values ($1,$2,'Scheduler test plan','scheduled')`,
      [planId, eventSlug],
    );
    await query(
      `insert into communication_plan_stages
         (id,plan_id,stage_key,label,position,kind,audience,subject,body,send_at,
          late_join_hours,status,updated_at)
       values ($1,$2,'notice','Notice',0,'event_service','event_attendees',
               'The notice','The message',now() - interval '1 hour',24,'fanout',
               now() - interval '20 minutes')`,
      [stageId, planId],
    );

    const orphanedOutbox = await enqueueEmail(
      {
        channel: "communications",
        to: firstEmail,
        subject: "The notice",
        text: "The message",
      },
      {
        idempotencyKey: `communication-stage:${stageId}:${firstHash}`,
        kind: "communication-stage",
        source: "scheduled",
        context: { eventSlug, communicationId: stageId },
        communicationId: stageId,
        deliverNow: false,
      },
    );
    expect(orphanedOutbox.ok).toBe(true);
    await query(
      `insert into communication_stage_deliveries (stage_id,email_hash,email,status)
       values ($1,$2,$3,'queued')`,
      [stageId, firstHash, firstEmail],
    );

    await expect(expandDueCommunicationStages()).resolves.toBe(2);

    const [stage] = await query<{
      status: string;
      recipient_count: number;
      queued_count: number;
      last_error: string | null;
    }>(
      `select status,recipient_count,queued_count,last_error
         from communication_plan_stages where id = $1`,
      [stageId],
    );
    expect(stage).toEqual({
      status: "queued",
      recipient_count: 2,
      queued_count: 2,
      last_error: null,
    });
    const deliveries = await query<{ email_hash: string; outbox_id: string | null }>(
      `select email_hash,outbox_id from communication_stage_deliveries
        where stage_id = $1 order by email_hash`,
      [stageId],
    );
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((delivery) => delivery.outbox_id !== null)).toBe(true);
    const outbox = await query<{ count: string }>(
      `select count(*)::text as count from email_outbox where communication_id = $1`,
      [stageId],
    );
    expect(outbox[0]?.count).toBe("2");
  });
});
