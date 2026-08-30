import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { BASE_URL } from "@/lib/shared/config";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function requestOriginAllowed(origin: string, request: Request) {
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(request.url).origin);
    allowed.add(new URL(BASE_URL).origin);
  } catch {
    return false;
  }
  return allowed.has(origin);
}

/**
 * Paths that authenticate the request themselves and must be exempt from the
 * origin check.
 *
 * Stripe signs every webhook with an HMAC over the raw body, which is
 * strictly stronger evidence than an Origin header. Server-to-server callers
 * also send no Origin at all, so leaving the CSRF check in place rejects
 * every genuine delivery with a 403.
 */
const ORIGIN_CHECK_EXEMPT_PATHS = new Set(["/api/email/events/cloudflare", "/api/stripe/webhook"]);

export function isOriginCheckExempt(request: Request): boolean {
  try {
    return ORIGIN_CHECK_EXEMPT_PATHS.has(new URL(request.url).pathname);
  } catch {
    return false;
  }
}

const csrfMiddleware = createCsrfMiddleware({
  filter: ({ request }) =>
    !SAFE_METHODS.has(request.method.toUpperCase()) &&
    !request.headers.has("authorization") &&
    !isOriginCheckExempt(request),
  origin: (origin, { request }) => requestOriginAllowed(origin, request),
  secFetchSite: "same-origin",
  referer: (referer, { request }) => {
    try {
      return requestOriginAllowed(new URL(referer).origin, request);
    } catch {
      return false;
    }
  },
  allowRequestsWithoutOriginCheck: false,
  failureResponse: ({ pathname }) =>
    pathname.startsWith("/api/")
      ? Response.json(
          { error: "Cross-origin request rejected" },
          { status: 403, headers: { "Cache-Control": "private, no-store" } },
        )
      : new Response("Forbidden", {
          status: 403,
          headers: { "Cache-Control": "private, no-store" },
        }),
});

const corsBoundaryMiddleware = createMiddleware().server(async ({ next, pathname, request }) => {
  const origin = request.headers.get("origin");
  if (
    pathname.startsWith("/api/") &&
    request.method.toUpperCase() === "OPTIONS" &&
    origin &&
    !requestOriginAllowed(origin, request)
  ) {
    return Response.json(
      { error: "Cross-origin request rejected" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [corsBoundaryMiddleware, csrfMiddleware],
}));
