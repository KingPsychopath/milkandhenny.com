const baseUrl = (process.env.APP_BASE_URL || process.env.VITE_BASE_URL || "").replace(/\/$/, "");
const secret = process.env.CRON_SECRET?.trim();

if (!baseUrl) throw new Error("APP_BASE_URL or VITE_BASE_URL is required");
if (!secret) throw new Error("CRON_SECRET is required");

const paths = [
  "/api/cron/cleanup-transfers",
  "/api/cron/cleanup-word-shares",
  "/api/cron/cleanup-word-media-orphans",
];

let failed = false;

for (const path of paths) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
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
