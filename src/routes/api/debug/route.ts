import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { probeSystemCapabilities } from "@/features/system/capabilities.server";
import { describeEmailOutbox } from "@/lib/platform/email-outbox.server";
import { describeScheduledJobs } from "@/lib/platform/scheduled-jobs.server";
import { describeGamePoolOperations } from "@/features/things/pool/operations.server";
import { describeTransferMediaQueue } from "@/features/transfers/media-queue.server";
import { log } from "@/lib/platform/logger.server";
import { describeOfficialGameResultOutbox } from "@/features/game-results/outbox.server";
import { durableWorkSnapshot } from "@/features/system/durable-work";

async function inspectTransferMediaQueue() {
  try {
    return { available: true, ...(await describeTransferMediaQueue()) };
  } catch (error) {
    log.error("admin.system-health", "Could not inspect the transfer media queue", {}, error);
    return {
      available: false,
      enabled: false,
      queued: 0,
      leased: 0,
      permanentFailures: 0,
      backlogAgeMs: null,
      durableWork: durableWorkSnapshot({
        available: false,
        pending: 0,
        processing: 0,
        failed: 0,
        oldestPendingAt: null,
      }),
      reason: "The media queue could not be inspected.",
    };
  }
}

/**
 * Debug endpoint — system health/status snapshot.
 * Protected behind admin auth.
 */
async function handleGET(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const [health, emailOutbox, scheduledJobs, gamePools, mediaQueue, officialResults] =
    await Promise.all([
      probeSystemCapabilities(),
      describeEmailOutbox(),
      describeScheduledJobs(),
      describeGamePoolOperations(),
      inspectTransferMediaQueue(),
      describeOfficialGameResultOutbox(),
    ]);
  return Response.json(
    {
      ...health,
      emailOutbox,
      scheduledJobs,
      gamePools,
      mediaQueue,
      durableWork: {
        email: emailOutbox.durableWork,
        media: mediaQueue.durableWork,
        officialGameResults: officialResults.durableWork,
      },
      help: {
        forceReload: "DELETE /api/admin/guests/bootstrap to clear and reload from CSV",
        bootstrap: "POST /api/admin/guests/bootstrap to load from CSV if empty",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/debug")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
    },
  },
});
