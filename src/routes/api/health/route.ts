import { createFileRoute } from "@tanstack/react-router";
import { probeSystemCapabilities } from "@/features/system/capabilities.server";

/**
 * Provider-neutral readiness endpoint for Railway, Docker, a VPS, or an
 * external uptime monitor. It checks every required dependency and refuses
 * traffic when boot migrations did not complete.
 */
async function handleGET() {
  const health = await probeSystemCapabilities();
  return Response.json(
    {
      ok: health.status !== "unhealthy",
      status: health.status,
      timestamp: health.timestamp,
      version: health.runtime.version,
      commit: health.runtime.commit,
    },
    {
      status: health.status === "unhealthy" ? 503 : 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => handleGET(),
    },
  },
});
