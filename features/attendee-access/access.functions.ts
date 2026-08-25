import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { getAttendeeSession } from "@/features/event-scoring/session.server";
import { attendeeSignInHref, safeReturnTo } from "./types";

export const requireAttendeeIdentityFn = createServerFn({ method: "GET" })
  .validator((returnTo: unknown) => safeReturnTo(returnTo))
  .handler(async ({ data: returnTo }) => {
    const session = await getAttendeeSession();
    if (!session?.personId) throw redirect({ href: attendeeSignInHref(returnTo) });
    return { authenticated: true as const };
  });
