import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Add a stable request id for correlation across:
 * - client-reported issues ("what request failed?")
 * - Vercel logs / log drains
 *
 * We keep this scoped to `/api/*` so we don't add overhead to static pages.
 */
export function middleware(request: NextRequest) {
  const fromClient = request.headers.get("x-request-id");
  const fromVercel = request.headers.get("x-vercel-id");
  const requestId =
    (fromClient && fromClient.trim()) || (fromVercel && fromVercel.trim()) || crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const res = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Echo back so clients and uptime monitors can report it.
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};

