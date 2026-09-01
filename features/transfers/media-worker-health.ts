type MediaWorkerHealthSnapshot = {
  lastHeartbeatAt?: string;
  lastErrorAt?: string;
  lastErrorMessage?: string;
};

type MediaWorkerQueueHealthSnapshot = {
  enabled: boolean;
  queued: number;
  leased: number;
  permanentFailures: number;
  backlogAgeMs: number | null;
  oldestPendingAt?: string | null;
  oldestPermanentFailureAt?: string | null;
};

type MediaWorkerOperationalIssue = {
  code: "backlog" | "heartbeat" | "permanent-failure";
  severity: "warning" | "critical";
  incidentKey: string;
  body: string;
};

const MEDIA_WORKER_STALE_AFTER_MS = 12 * 60_000;
const MEDIA_WORKER_BACKLOG_AFTER_MS = 15 * 60_000;

function summarizeMediaWorkerError(raw: string): string {
  if (/command timed out/i.test(raw)) {
    return "Redis queue wait timed out; reconnecting automatically.";
  }
  if (/connection (?:is )?closed|connection closed/i.test(raw)) {
    return "Redis queue connection closed; reconnecting automatically.";
  }

  const firstLine = raw
    .split("\n", 1)[0]
    ?.replace(/^Error:\s*/i, "")
    .trim();
  return (firstLine || "The media worker was interrupted.").slice(0, 240);
}

function mediaWorkerErrorIsActive(worker: MediaWorkerHealthSnapshot): boolean {
  if (!worker.lastErrorMessage) return false;
  const errorAt = worker.lastErrorAt ? Date.parse(worker.lastErrorAt) : Number.NaN;
  const heartbeatAt = worker.lastHeartbeatAt ? Date.parse(worker.lastHeartbeatAt) : Number.NaN;
  if (!Number.isFinite(errorAt) || !Number.isFinite(heartbeatAt)) return true;
  return heartbeatAt <= errorAt;
}

function minutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

function mediaWorkerOperationalIssue(input: {
  now: Date;
  worker: MediaWorkerHealthSnapshot;
  queue: MediaWorkerQueueHealthSnapshot;
}): MediaWorkerOperationalIssue | null {
  if (!input.queue.enabled) return null;

  if (input.queue.permanentFailures > 0) {
    return {
      code: "permanent-failure",
      severity: "critical",
      incidentKey: input.queue.oldestPermanentFailureAt ?? String(input.queue.permanentFailures),
      body: `${input.queue.permanentFailures} media job${input.queue.permanentFailures === 1 ? " has" : "s have"} exhausted automatic retries.`,
    };
  }

  const heartbeatAt = input.worker.lastHeartbeatAt
    ? Date.parse(input.worker.lastHeartbeatAt)
    : Number.NaN;
  const heartbeatAgeMs = Number.isFinite(heartbeatAt)
    ? Math.max(0, input.now.getTime() - heartbeatAt)
    : null;
  const workWaiting = input.queue.queued + input.queue.leased > 0;
  if (
    (heartbeatAgeMs !== null && heartbeatAgeMs >= MEDIA_WORKER_STALE_AFTER_MS) ||
    (heartbeatAgeMs === null && workWaiting)
  ) {
    return {
      code: "heartbeat",
      severity: workWaiting ? "critical" : "warning",
      incidentKey: input.worker.lastHeartbeatAt ?? input.queue.oldestPendingAt ?? "missing",
      body:
        heartbeatAgeMs === null
          ? "Media work is waiting, but the worker has never reported a heartbeat."
          : `The media worker has not reported for ${minutes(heartbeatAgeMs)} minutes${workWaiting ? ` while ${input.queue.queued + input.queue.leased} job${input.queue.queued + input.queue.leased === 1 ? " is" : "s are"} waiting` : ""}.`,
    };
  }

  if (
    input.queue.queued > 0 &&
    input.queue.backlogAgeMs !== null &&
    input.queue.backlogAgeMs >= MEDIA_WORKER_BACKLOG_AFTER_MS
  ) {
    return {
      code: "backlog",
      severity: "warning",
      incidentKey: input.queue.oldestPendingAt ?? String(input.queue.backlogAgeMs),
      body: `${input.queue.queued} media job${input.queue.queued === 1 ? " has" : "s have"} waited for ${minutes(input.queue.backlogAgeMs)} minutes.`,
    };
  }

  return null;
}

export {
  MEDIA_WORKER_BACKLOG_AFTER_MS,
  MEDIA_WORKER_STALE_AFTER_MS,
  mediaWorkerErrorIsActive,
  mediaWorkerOperationalIssue,
  summarizeMediaWorkerError,
};
export type {
  MediaWorkerHealthSnapshot,
  MediaWorkerOperationalIssue,
  MediaWorkerQueueHealthSnapshot,
};
