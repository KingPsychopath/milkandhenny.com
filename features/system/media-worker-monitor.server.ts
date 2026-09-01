import {
  emitDomainEvent,
  hasActiveAdminNotification,
  resolveAdminNotificationsByCategory,
} from "@/features/attendee-operations/notifications.server";
import { getMediaProcessorMode } from "@/features/media/config.server";
import { describeTransferMediaQueue } from "@/features/transfers/media-queue.server";
import {
  mediaWorkerOperationalIssue,
  type MediaWorkerOperationalIssue,
} from "@/features/transfers/media-worker-health";
import { getTransferMediaWorkerStatus } from "@/features/transfers/media-worker-status.server";

const MEDIA_WORKER_ALERT_CATEGORY = "media-worker-health";

type MediaWorkerMonitorResult = {
  state: "healthy" | "alerted" | "already-alerted";
  issue?: MediaWorkerOperationalIssue["code"] | "inspection";
  resolved: number;
};

async function inspectMediaWorker(now: Date): Promise<MediaWorkerOperationalIssue | null> {
  const [worker, queue] = await Promise.all([
    getTransferMediaWorkerStatus(),
    describeTransferMediaQueue(),
  ]);
  return mediaWorkerOperationalIssue({
    now,
    worker,
    queue: {
      ...queue,
      oldestPendingAt: queue.durableWork.oldestPendingAt,
    },
  });
}

async function monitorMediaWorkerHealth(now = new Date()): Promise<MediaWorkerMonitorResult> {
  let issue: MediaWorkerOperationalIssue | null;
  let inspectionFailed = false;
  try {
    issue = getMediaProcessorMode() === "local" ? null : await inspectMediaWorker(now);
  } catch {
    inspectionFailed = true;
    issue = {
      code: "heartbeat",
      severity: "warning",
      incidentKey: now.toISOString().slice(0, 10),
      body: "The media worker health check could not read its queue or heartbeat.",
    };
  }

  if (!issue) {
    const resolved = await resolveAdminNotificationsByCategory(
      MEDIA_WORKER_ALERT_CATEGORY,
      "Media worker heartbeat and queue recovered automatically.",
    );
    return { state: "healthy", resolved };
  }

  if (await hasActiveAdminNotification(MEDIA_WORKER_ALERT_CATEGORY)) {
    return {
      state: "already-alerted",
      issue: inspectionFailed ? "inspection" : issue.code,
      resolved: 0,
    };
  }

  await emitDomainEvent({
    kind: `media.worker.${inspectionFailed ? "inspection" : issue.code}`,
    deduplicationKey: `media-worker-health:${issue.code}:${issue.incidentKey}`,
    actorType: "system",
    entityRefs: { component: "media-worker" },
    severity: issue.severity,
    admin: {
      title: "Media processing needs attention",
      body: issue.body,
      deepLink: "/admin?view=transfers",
      category: MEDIA_WORKER_ALERT_CATEGORY,
      createCase: true,
    },
  });
  return {
    state: "alerted",
    issue: inspectionFailed ? "inspection" : issue.code,
    resolved: 0,
  };
}

export { MEDIA_WORKER_ALERT_CATEGORY, monitorMediaWorkerHealth };
export type { MediaWorkerMonitorResult };
