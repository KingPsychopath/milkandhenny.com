import { NextRequest, NextResponse } from "next/server";

/**
 * Health endpoint for uptime monitors.
 *
 * Intentionally does NOT check Redis/R2 to avoid:
 * - leaking infra detail to unauthenticated callers
 * - generating KV commands from frequent monitoring
 */
export async function GET(request: NextRequest) {
  const expected = process.env.HEALTHCHECK_TOKEN ?? "";
  if (!expected.trim()) {
    // Fail closed: don't accidentally ship an open endpoint if config is missing.
    return NextResponse.json(
      {
        ok: false,
        error: "Health endpoint not configured",
        hint: "Set HEALTHCHECK_TOKEN in the environment and send x-health-token.",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const provided = request.headers.get("x-health-token") ?? "";
  if (provided !== expected) {
    // Low-information response to discourage probing.
    return new NextResponse(null, {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

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

