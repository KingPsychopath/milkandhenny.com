const baseUrl = (process.env.APP_BASE_URL || process.env.VITE_BASE_URL || "").replace(/\/$/, "");
const secret = process.env.CRON_SECRET?.trim();

if (!baseUrl) throw new Error("APP_BASE_URL or VITE_BASE_URL is required");
if (!secret) throw new Error("CRON_SECRET is required");

const jobs = [
  { path: "/api/cron/send-pitch-reminders" },
  { path: "/api/cron/deliver-email", method: "POST" },
  { path: "/api/cron/cleanup-transfers" },
  { path: "/api/cron/cleanup-pitches" },
  { path: "/api/cron/cleanup-game-pools" },
  { path: "/api/cron/process-official-game-results", method: "POST" },
  { path: "/api/cron/send-operations-digests", method: "POST" },
  { path: "/api/cron/cleanup-communication-links" },
  { path: "/api/cron/cleanup-email" },
  { path: "/api/cron/cleanup-attendee-access" },
  { path: "/api/cron/cleanup-word-shares" },
  { path: "/api/cron/cleanup-word-media-orphans" },
  // Reconcile media the worker never finished. The worker sweeps for this
  // itself on a reconciliation timer; this is the backstop for the worker
  // being down. Both share a Redis lock, so overlap is harmless.
  { path: "/api/cron/process-transfer-media", method: "POST" },
];

let failed = false;

for (const { path, method = "GET" } of jobs) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        "x-request-id": crypto.randomUUID(),
      },
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    const body = await response.text();
    console.log(
      JSON.stringify({
        event: "maintenance.request",
        path,
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt,
        response: body.slice(0, 2_000),
      }),
    );
    if (!response.ok) failed = true;
  } catch (error) {
    failed = true;
    console.error(
      JSON.stringify({
        event: "maintenance.request",
        path,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

if (failed) process.exitCode = 1;
