import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { ATTENDEE_SESSION_COOKIE_NAME } from "@/features/event-scoring/session-cookie";
import { getCookie } from "@/lib/http/cookies";
import { BASE_URL } from "@/lib/shared/config";
import {
  DYNAMIC_DOCUMENT_CACHE_CONTROL,
  STATIC_IMAGE_CACHE_CONTROL,
  STATIC_ROOT_IMAGE_PATHS,
} from "@/lib/shared/media-cache";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // 'unsafe-inline' stays because TanStack Start streams per-request $_TSR
  // hydration payloads as executable inline scripts, which rules out static
  // hashes, and the framework offers no way to thread a per-request nonce
  // into them. script-src-attr 'none' below still blocks inline handlers,
  // which is where injected markup would otherwise land.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' https://esm.sh",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  process.env.NODE_ENV === "production"
    ? "connect-src 'self' blob: https: ws: wss:"
    : "connect-src 'self' blob: http://127.0.0.1:* http://localhost:* https: ws: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
].join("; ");

const SECURITY_HEADERS = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-site",
  "Origin-Agent-Cluster": "?1",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Permissions-Policy":
    "accelerometer=(self), camera=(self), geolocation=(), gyroscope=(self), microphone=(self), on-device-speech-recognition=(self), payment=(), usb=()",
} as const;

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

export function applyCachePolicy(pathname: string, request: Request, response: Response) {
  if (pathname === "/sw.js") {
    response.headers.set("Cache-Control", "no-cache, max-age=0, must-revalidate");
    response.headers.set("Service-Worker-Allowed", "/");
    return;
  }
  if (pathname.startsWith("/fonts/") || pathname.startsWith("/audio/")) {
    response.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return;
  }
  if (pathname.startsWith("/og/")) {
    response.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return;
  }
  if ((STATIC_ROOT_IMAGE_PATHS as readonly string[]).includes(pathname)) {
    response.headers.set("Cache-Control", STATIC_IMAGE_CACHE_CONTROL);
    return;
  }
  if (pathname === "/manifest.json" || pathname === "/manifest-forehead.webmanifest") {
    response.headers.set("Cache-Control", "public, max-age=3600, must-revalidate");
    return;
  }
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/action/") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/drop/") ||
    (pathname.startsWith("/events/") && pathname.includes("/staff/")) ||
    pathname.startsWith("/organize/") ||
    pathname.startsWith("/play/") ||
    pathname.startsWith("/scan") ||
    pathname.startsWith("/ticket/") ||
    pathname.startsWith("/things/pitches/present") ||
    /^\/things\/pitches\/[^/]+\/edit$/.test(pathname) ||
    pathname.startsWith("/upload") ||
    pathname.startsWith("/vault/") ||
    pathname.startsWith("/t/") ||
    pathname === "/access" ||
    pathname.startsWith("/access/") ||
    pathname === "/my" ||
    pathname === "/best-dressed" ||
    pathname === "/health" ||
    pathname.endsWith("/bought") ||
    Boolean(getCookie(request, ATTENDEE_SESSION_COOKIE_NAME)) ||
    response.headers.has("set-cookie")
  ) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("CDN-Cache-Control", "no-store");
    return;
  }
  if (pathname.startsWith("/things/")) {
    response.headers.set("Cache-Control", DYNAMIC_DOCUMENT_CACHE_CONTROL);
    return;
  }
  if (!response.headers.has("Cache-Control")) {
    response.headers.set("Cache-Control", DYNAMIC_DOCUMENT_CACHE_CONTROL);
  }
}

const responseHeadersMiddleware = createMiddleware().server(async ({ next, pathname, request }) => {
  let requestId: string | undefined;

  if (pathname.startsWith("/api/")) {
    const suppliedRequestId = request.headers.get("x-request-id")?.trim();
    requestId =
      suppliedRequestId && /^[A-Za-z0-9._-]{1,64}$/.test(suppliedRequestId)
        ? suppliedRequestId
        : crypto.randomUUID();
    request.headers.set("x-request-id", requestId);
  }

  const result = await next();
  const response = new Response(result.response.body, result.response);

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }

  if (requestId) response.headers.set("x-request-id", requestId);
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (pathname === "/access" || pathname.startsWith("/access/")) {
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  applyCachePolicy(pathname, request, response);

  return { ...result, response };
});

export const startInstance = createStart(() => ({
  requestMiddleware: [responseHeadersMiddleware, corsBoundaryMiddleware, csrfMiddleware],
}));
