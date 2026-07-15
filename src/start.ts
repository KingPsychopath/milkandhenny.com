import { createMiddleware, createStart } from "@tanstack/react-start";

const SECURITY_HEADERS = {
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
} as const;

const responseHeadersMiddleware = createMiddleware().server(async ({ next, pathname, request }) => {
  let requestId: string | undefined;

  if (pathname.startsWith("/api/")) {
    requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
    request.headers.set("x-request-id", requestId);
  }

  const result = await next();
  const response = new Response(result.response.body, result.response);

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }

  if (requestId) response.headers.set("x-request-id", requestId);

  if (pathname.startsWith("/t/")) {
    response.headers.set("CDN-Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    response.headers.set("Cache-Control", "no-cache");
  }

  return { ...result, response };
});

export const startInstance = createStart(() => ({
  requestMiddleware: [responseHeadersMiddleware],
}));
