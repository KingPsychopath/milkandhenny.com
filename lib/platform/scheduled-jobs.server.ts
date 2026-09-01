import { randomUUID } from "node:crypto";
import { Cause, Data, Effect } from "effect";
import type { QueryResultRow } from "pg";

import { log } from "./logger.server";
import { query, transaction } from "./postgres.server";

interface ScheduledJobRow extends QueryResultRow {
  job_key: string;
  next_run_at: Date | string;
  lease_until: Date | string | null;
  last_started_at: Date | string | null;
  last_succeeded_at: Date | string | null;
  last_failed_at: Date | string | null;
  last_duration_ms: number | null;
  last_error: string | null;
  attempt_count: string | number;
  failure_count: string | number;
}

interface ScheduledJobOptions {
  jobKey: string;
  intervalMs: number;
  retryMs: number;
  leaseMs: number;
  force?: boolean;
}

interface RunScheduledJobEffectOptions<T, E, R> extends ScheduledJobOptions {
  run: Effect.Effect<T, E, R>;
}

export class ScheduledJobError extends Data.TaggedError("ScheduledJobError")<{
  readonly cause: unknown;
  readonly jobKey: string;
  readonly operation: "claim" | "finish" | "validate";
}> {}

export type ScheduledJobRun<T> = { ran: false } | { ran: true; durationMs: number; value: T };

export interface ScheduledJobSnapshot {
  jobKey: string;
  nextRunAt: string;
  leaseUntil: string | null;
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  attemptCount: number;
  failureCount: number;
}

function positiveMilliseconds(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive whole number of milliseconds`);
  }
  return value;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1_000);
}

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

async function claimScheduledJob(input: {
  jobKey: string;
  leaseToken: string;
  leaseMs: number;
  force: boolean;
}): Promise<boolean> {
  return transaction(async (client) => {
    await client.query(
      `insert into application_scheduled_jobs (job_key, next_run_at)
       values ($1, now())
       on conflict (job_key) do nothing`,
      [input.jobKey],
    );
    const claimed = await client.query<{ job_key: string }>(
      `update application_scheduled_jobs
          set lease_token = $2,
              lease_until = now() + make_interval(secs => $3::double precision / 1000),
              last_started_at = now(),
              attempt_count = attempt_count + 1,
              updated_at = now()
        where job_key = $1
          and ($4::boolean or next_run_at <= now())
          and (lease_until is null or lease_until <= now())
      returning job_key`,
      [input.jobKey, input.leaseToken, input.leaseMs, input.force],
    );
    return claimed.rowCount === 1;
  });
}

async function finishScheduledJob(input: {
  jobKey: string;
  leaseToken: string;
  delayMs: number;
  durationMs: number;
  error?: string;
}): Promise<void> {
  const failed = input.error !== undefined;
  const updated = await query<{ job_key: string }>(
    `update application_scheduled_jobs
        set next_run_at = now() + make_interval(secs => $3::double precision / 1000),
            lease_token = null,
            lease_until = null,
            last_succeeded_at = case when $5::boolean then last_succeeded_at else now() end,
            last_failed_at = case when $5::boolean then now() else last_failed_at end,
            last_duration_ms = $4,
            last_error = $6,
            failure_count = failure_count + case when $5::boolean then 1 else 0 end,
            updated_at = now()
      where job_key = $1 and lease_token = $2
    returning job_key`,
    [input.jobKey, input.leaseToken, input.delayMs, input.durationMs, failed, input.error ?? null],
  );
  if (!updated[0]) {
    throw new Error(`Scheduled job ${input.jobKey} lost its lease before completion`);
  }
}

function scheduledJobAttempt<A>(
  jobKey: string,
  operation: ScheduledJobError["operation"],
  run: () => Promise<A>,
) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new ScheduledJobError({ cause, jobKey, operation }),
  });
}

/** Effect-native leased execution for scoped schedulers and deterministic test Layers. */
export function runLeasedScheduledJobEffect<T, E, R>(
  options: RunScheduledJobEffectOptions<T, E, R>,
): Effect.Effect<ScheduledJobRun<T>, E | ScheduledJobError, R> {
  return Effect.gen(function* () {
    const timings = yield* Effect.try({
      try: () => ({
        intervalMs: positiveMilliseconds(options.intervalMs, "Scheduled job interval"),
        retryMs: positiveMilliseconds(options.retryMs, "Scheduled job retry delay"),
        leaseMs: positiveMilliseconds(options.leaseMs, "Scheduled job lease"),
      }),
      catch: (cause) =>
        new ScheduledJobError({ cause, jobKey: options.jobKey, operation: "validate" }),
    });
    const leaseToken = randomUUID();
    const claimed = yield* scheduledJobAttempt(options.jobKey, "claim", () =>
      claimScheduledJob({
        jobKey: options.jobKey,
        leaseToken,
        leaseMs: timings.leaseMs,
        force: options.force === true,
      }),
    );
    if (!claimed) return { ran: false } as const;

    const startedAt = Date.now();
    const value = yield* options.run.pipe(
      Effect.onError((cause) =>
        scheduledJobAttempt(options.jobKey, "finish", () =>
          finishScheduledJob({
            jobKey: options.jobKey,
            leaseToken,
            delayMs: timings.retryMs,
            durationMs: Date.now() - startedAt,
            error: safeError(Cause.squash(cause)),
          }),
        ).pipe(
          Effect.catch((finishError) =>
            Effect.sync(() =>
              log.error(
                "scheduler.lease",
                "Could not record scheduled job failure",
                { jobKey: options.jobKey },
                finishError,
              ),
            ),
          ),
          Effect.uninterruptible,
        ),
      ),
    );
    const durationMs = Date.now() - startedAt;
    yield* scheduledJobAttempt(options.jobKey, "finish", () =>
      finishScheduledJob({
        jobKey: options.jobKey,
        leaseToken,
        delayMs: timings.intervalMs,
        durationMs,
      }),
    );
    return { ran: true, durationMs, value } as const;
  }).pipe(
    Effect.withSpan(`scheduler.${options.jobKey}`, {
      attributes: { jobKey: options.jobKey },
    }),
  );
}

export async function describeScheduledJobs(): Promise<ScheduledJobSnapshot[]> {
  const rows = await query<ScheduledJobRow>(
    `select job_key, next_run_at, lease_until, last_started_at, last_succeeded_at,
            last_failed_at, last_duration_ms, last_error, attempt_count, failure_count
       from application_scheduled_jobs
      order by job_key`,
  );
  return rows.map((row) => ({
    jobKey: row.job_key,
    nextRunAt: iso(row.next_run_at) ?? new Date(0).toISOString(),
    leaseUntil: iso(row.lease_until),
    lastStartedAt: iso(row.last_started_at),
    lastSucceededAt: iso(row.last_succeeded_at),
    lastFailedAt: iso(row.last_failed_at),
    lastDurationMs: row.last_duration_ms,
    lastError: row.last_error,
    attemptCount: Number(row.attempt_count) || 0,
    failureCount: Number(row.failure_count) || 0,
  }));
}
