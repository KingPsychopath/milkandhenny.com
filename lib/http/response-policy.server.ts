import {
  DYNAMIC_DOCUMENT_CACHE_CONTROL,
  MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL,
  PRIVATE_MEDIA_CACHE_CONTROL,
  STATIC_IMAGE_CACHE_CONTROL,
  STATIC_ROOT_IMAGE_PATHS,
  VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL,
} from "@/lib/shared/media-cache";

const SAFE_CACHE_METHODS = new Set(["GET", "HEAD"]);
const MANIFEST_CACHE_CONTROL = "public, max-age=3600, must-revalidate";
const SERVICE_WORKER_CACHE_CONTROL = "no-cache, max-age=0, must-revalidate";

const PRIVATE_PATH_PREFIXES = [
  "/_server",
  "/access",
  "/action",
  "/admin",
  "/api",
  "/best-dressed",
  "/drop",
  "/exam",
  "/health",
  "/my",
  "/organize",
  "/play",
  "/scan",
  "/t",
  "/ticket",
  "/upload",
  "/vault",
] as const;

const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "code",
  "key",
  "share",
  "sig",
  "signature",
  "ticket",
  "token",
]);

const PRIVATE_THINGS_PATHS = [
  /^\/things\/(?:centre|draw-country|liars|same-brain|spelling-party|twin)\/(?!solo(?:\/|$)|phone(?:\/|$)|one-screen(?:\/|$)|dev(?:\/|$))[^/]+/,
  /^\/things\/hot-and-cold\/(?!daily(?:\/|$))[^/]+/,
  /^\/things\/(?:judge|play)\//,
  /^\/things\/pitches\/(?:new|present|remote)(?:\/|$)/,
  /^\/things\/pitches\/[^/]+\/edit(?:\/|$)/,
] as const;

type PolicyRequest = {
  headers: Headers;
  method: string;
  url: string;
};

function buildContentSecurityPolicy(pathname = "/"): string {
  const isFontTest = pathname === "/font-test";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    // TanStack Start streams per-request hydration payloads as executable inline
    // scripts and does not expose a nonce hook for them. Attribute handlers stay
    // disabled, which still closes the usual injected-markup execution path.
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "script-src-attr 'none'",
    isFontTest
      ? "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
      : "style-src 'self' 'unsafe-inline'",
    isFontTest ? "font-src 'self' https://fonts.gstatic.com" : "font-src 'self'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    process.env.NODE_ENV === "production"
      ? "connect-src 'self' blob: https: wss:"
      : "connect-src 'self' blob: http://127.0.0.1:* http://localhost:* https: ws: wss:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

const CONTENT_SECURITY_POLICY = buildContentSecurityPolicy();

const SECURITY_HEADERS = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-site",
  "Origin-Agent-Cluster": "?1",
  "Permissions-Policy":
    "accelerometer=(self), browsing-topics=(), camera=(self), display-capture=(), geolocation=(), gyroscope=(self), microphone=(self), on-device-speech-recognition=(self), payment=(), usb=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-XSS-Protection": "0",
} as const;

function hasPathPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function hasSensitiveQuery(request: PolicyRequest): boolean {
  try {
    const searchParams = new URL(request.url).searchParams;
    return [...SENSITIVE_QUERY_KEYS].some((key) => searchParams.has(key));
  } catch {
    return true;
  }
}

function isPrivatePath(pathname: string): boolean {
  if (PRIVATE_PATH_PREFIXES.some((prefix) => hasPathPrefix(pathname, prefix))) return true;
  if (pathname.startsWith("/events/") && /\/(?:discoveries|score|staff)(?:\/|$)/.test(pathname)) {
    return true;
  }
  if (pathname.endsWith("/bought")) return true;
  return PRIVATE_THINGS_PATHS.some((pattern) => pattern.test(pathname));
}

function isSensitiveRequest(pathname: string, request: PolicyRequest, response: Response): boolean {
  return (
    !SAFE_CACHE_METHODS.has(request.method.toUpperCase()) ||
    request.headers.has("authorization") ||
    request.headers.has("cookie") ||
    response.headers.has("set-cookie") ||
    isPrivatePath(pathname) ||
    hasSensitiveQuery(request)
  );
}

function setPrivateNoStore(response: Response): void {
  response.headers.set("Cache-Control", PRIVATE_MEDIA_CACHE_CONTROL);
  response.headers.set("CDN-Cache-Control", "no-store");
}

function isVersionedStaticPath(pathname: string): boolean {
  return ["/_build/", "/assets/", "/audio/", "/fonts/", "/og/"].some((prefix) =>
    pathname.startsWith(prefix),
  );
}

function isPublicStaticPath(pathname: string): boolean {
  return (
    pathname === "/sw.js" ||
    pathname === "/manifest.json" ||
    pathname === "/manifest-forehead.webmanifest" ||
    isVersionedStaticPath(pathname) ||
    pathname.startsWith("/excalidraw/fonts/") ||
    pathname.startsWith("/media/") ||
    (STATIC_ROOT_IMAGE_PATHS as readonly string[]).includes(pathname)
  );
}

function isPrivateCrawlerPath(pathname: string, request: PolicyRequest): boolean {
  return isPrivatePath(pathname) || hasSensitiveQuery(request);
}

export function applyCachePolicy(
  pathname: string,
  request: PolicyRequest,
  response: Response,
): void {
  if (response.status >= 400) {
    setPrivateNoStore(response);
    return;
  }

  if (pathname === "/sw.js") {
    response.headers.set("Cache-Control", SERVICE_WORKER_CACHE_CONTROL);
    response.headers.set("Service-Worker-Allowed", "/");
    return;
  }

  if (isVersionedStaticPath(pathname)) {
    response.headers.set("Cache-Control", VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL);
    return;
  }

  if ((STATIC_ROOT_IMAGE_PATHS as readonly string[]).includes(pathname)) {
    response.headers.set("Cache-Control", STATIC_IMAGE_CACHE_CONTROL);
    return;
  }

  if (pathname.startsWith("/excalidraw/fonts/")) {
    response.headers.set("Cache-Control", STATIC_IMAGE_CACHE_CONTROL);
    return;
  }

  if (pathname.startsWith("/media/")) {
    response.headers.set("Cache-Control", MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL);
    return;
  }

  if (pathname === "/manifest.json" || pathname === "/manifest-forehead.webmanifest") {
    response.headers.set("Cache-Control", MANIFEST_CACHE_CONTROL);
    return;
  }

  if (isSensitiveRequest(pathname, request, response)) {
    setPrivateNoStore(response);
    return;
  }

  if (!response.headers.has("Cache-Control")) {
    response.headers.set("Cache-Control", DYNAMIC_DOCUMENT_CACHE_CONTROL);
  }
}

export function applyResponsePolicy(
  pathname: string,
  request: PolicyRequest,
  response: Response,
): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  response.headers.set("Content-Security-Policy", buildContentSecurityPolicy(pathname));

  response.headers.delete("Server");
  response.headers.delete("X-Powered-By");

  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  if (
    response.status >= 400 ||
    isPrivateCrawlerPath(pathname, request) ||
    (!isPublicStaticPath(pathname) && isSensitiveRequest(pathname, request, response))
  ) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }

  if (isPrivateCrawlerPath(pathname, request)) {
    response.headers.set("Referrer-Policy", "no-referrer");
  }

  applyCachePolicy(pathname, request, response);
}

export { buildContentSecurityPolicy, CONTENT_SECURITY_POLICY, SECURITY_HEADERS };
