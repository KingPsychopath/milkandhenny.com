import { describe, expect, it } from "vitest";

import {
  MEDIA_WORKER_BACKLOG_AFTER_MS,
  MEDIA_WORKER_STALE_AFTER_MS,
  mediaWorkerErrorIsActive,
  mediaWorkerOperationalIssue,
  summarizeMediaWorkerError,
} from "@/features/transfers/media-worker-health";

describe("media worker health", () => {
  it("turns Redis timeout stacks into concise recovery copy", () => {
    expect(
      summarizeMediaWorkerError(
        "Error: Command timed out\n    at Timeout.<anonymous> (ioredis.mjs:843:25)",
      ),
    ).toBe("Redis queue wait timed out; reconnecting automatically.");
  });

  it("keeps an interruption active until a newer heartbeat arrives", () => {
    const interruption = {
      lastErrorAt: "2026-09-01T05:06:29.000Z",
      lastErrorMessage: "Redis queue wait timed out; reconnecting automatically.",
    };

    expect(
      mediaWorkerErrorIsActive({
        ...interruption,
        lastHeartbeatAt: "2026-09-01T05:06:29.000Z",
      }),
    ).toBe(true);
    expect(
      mediaWorkerErrorIsActive({
        ...interruption,
        lastHeartbeatAt: "2026-09-01T05:06:30.000Z",
      }),
    ).toBe(false);
  });

  it("pages only after a heartbeat is genuinely stale", () => {
    const now = new Date("2026-09-01T12:00:00.000Z");
    const queue = {
      enabled: true,
      queued: 0,
      leased: 0,
      permanentFailures: 0,
      backlogAgeMs: null,
    };

    expect(
      mediaWorkerOperationalIssue({
        now,
        worker: {
          lastHeartbeatAt: new Date(now.getTime() - MEDIA_WORKER_STALE_AFTER_MS + 1).toISOString(),
          lastErrorMessage: "An earlier transient failure",
        },
        queue,
      }),
    ).toBeNull();
    expect(
      mediaWorkerOperationalIssue({
        now,
        worker: {
          lastHeartbeatAt: new Date(now.getTime() - MEDIA_WORKER_STALE_AFTER_MS).toISOString(),
        },
        queue,
      }),
    ).toMatchObject({ code: "heartbeat", severity: "warning" });
  });

  it("escalates stale queued work and permanent failures", () => {
    const now = new Date("2026-09-01T12:00:00.000Z");
    expect(
      mediaWorkerOperationalIssue({
        now,
        worker: {},
        queue: {
          enabled: true,
          queued: 1,
          leased: 0,
          permanentFailures: 0,
          backlogAgeMs: MEDIA_WORKER_BACKLOG_AFTER_MS,
          oldestPendingAt: "2026-09-01T11:45:00.000Z",
        },
      }),
    ).toMatchObject({ code: "heartbeat", severity: "critical" });
    expect(
      mediaWorkerOperationalIssue({
        now,
        worker: { lastHeartbeatAt: now.toISOString() },
        queue: {
          enabled: true,
          queued: 1,
          leased: 0,
          permanentFailures: 0,
          backlogAgeMs: MEDIA_WORKER_BACKLOG_AFTER_MS,
          oldestPendingAt: "2026-09-01T11:45:00.000Z",
        },
      }),
    ).toMatchObject({ code: "backlog", severity: "warning" });
    expect(
      mediaWorkerOperationalIssue({
        now,
        worker: { lastHeartbeatAt: now.toISOString() },
        queue: {
          enabled: true,
          queued: 0,
          leased: 0,
          permanentFailures: 1,
          backlogAgeMs: null,
          oldestPermanentFailureAt: "2026-09-01T11:30:00.000Z",
        },
      }),
    ).toMatchObject({ code: "permanent-failure", severity: "critical" });
  });
});
