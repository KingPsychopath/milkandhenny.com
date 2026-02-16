import { NextResponse } from "next/server";

/**
 * Public health endpoint for uptime monitors.
 *
 * Intentionally does NOT check Redis/R2 to avoid:
 * - leaking infra detail to unauthenticated callers
 * - generating KV commands from frequent monitoring
 */
export async function GET() {
  return NextResponse.json(
    { ok: true, timestamp: new Date().toISOString() },
    {
      headers: {
        // Health checks should always be "live" (and not cached by CDNs/browsers).
        "Cache-Control": "no-store",
      },
    }
  );
}

