import { definePlugin } from "nitro";

import { applyResponsePolicy } from "@/lib/http/response-policy.server";

const API_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

function requestPath(request: { url: string }): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "/";
  }
}

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("request", (event) => {
    if (!requestPath(event.req).startsWith("/api/")) return;

    const supplied = event.req.headers.get("x-request-id")?.trim();
    event.req.headers.set(
      "x-request-id",
      supplied && API_REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID(),
    );
  });

  nitroApp.hooks.hook("response", (response, event) => {
    const pathname = requestPath(event.req);
    applyResponsePolicy(pathname, event.req, response);

    if (pathname.startsWith("/api/")) {
      const requestId = event.req.headers.get("x-request-id");
      if (requestId) response.headers.set("x-request-id", requestId);
    }
  });
});
