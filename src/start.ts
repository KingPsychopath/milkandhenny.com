import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { BASE_URL } from "@/lib/shared/config";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' blob: https: ws: wss:",
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
    "accelerometer=(self), camera=(), geolocation=(), gyroscope=(self), microphone=(), payment=(), usb=()",
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

const csrfMiddleware = createCsrfMiddleware({
  filter: ({ request }) =>
    !SAFE_METHODS.has(request.method.toUpperCase()) && !request.headers.has("authorization"),
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

function applyCachePolicy(pathname: string, response: Response) {
  if (pathname === "/sw.js") {
    response.headers.set("Cache-Control", "no-cache, max-age=0, must-revalidate");
    response.headers.set("Service-Worker-Allowed", "/");
    return;
  }
  if (pathname.startsWith("/fonts/")) {
    response.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return;
  }
  if (pathname === "/manifest.json" || pathname === "/manifest-forehead.webmanifest") {
    response.headers.set("Cache-Control", "public, max-age=3600, must-revalidate");
    return;
  }
  if (pathname.startsWith("/things/")) {
    response.headers.set("Cache-Control", "no-cache");
    return;
  }
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/guestlist") ||
    pathname.startsWith("/upload") ||
    pathname.startsWith("/vault/") ||
    pathname.startsWith("/t/") ||
    response.headers.has("set-cookie")
  ) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("CDN-Cache-Control", "no-store");
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
  applyCachePolicy(pathname, response);

  return { ...result, response };
});

export const startInstance = createStart(() => ({
  requestMiddleware: [responseHeadersMiddleware, corsBoundaryMiddleware, csrfMiddleware],
}));
