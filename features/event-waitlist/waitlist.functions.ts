import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestIP } from "@tanstack/react-start/server";

import { getBaseUrlForRequest } from "@/lib/shared/config";
import type { WaitlistScope } from "./types";
import {
  getWaitlistManagement,
  requestEventWaitlist,
  updateWaitlistManagement,
} from "./waitlist.server";

export const requestEventWaitlistFn = createServerFn({ method: "POST" })
  .validator((data: { eventSlug: string; email: string; scope: WaitlistScope }) => data)
  .handler(async ({ data }) => {
    const request = getRequest();
    return requestEventWaitlist({
      ...data,
      origin: getBaseUrlForRequest(request),
      ip: getRequestIP() || "unknown",
    });
  });

export const getWaitlistManagementFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(({ data }) => getWaitlistManagement(data.token));

export const updateWaitlistManagementFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; action: "confirm" | "leave" }) => data)
  .handler(({ data }) => {
    const request = getRequest();
    return updateWaitlistManagement({
      ...data,
      origin: getBaseUrlForRequest(request),
    });
  });
