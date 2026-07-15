import { createFileRoute } from "@tanstack/react-router";
import { getSystemCapabilities } from "@/features/system/capabilities.server";

/**
 * Cheap provider-neutral readiness endpoint for Railway, Docker, a VPS, or an
 * external uptime monitor. It validates configuration without spending Redis
 * or object-storage operations.
 */
function handleGET() {
  const health = getSystemCapabilities();
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
