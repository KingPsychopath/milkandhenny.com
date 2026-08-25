import { createServerFn } from "@tanstack/react-start";

import { getAttendeeSession } from "@/features/event-scoring/session.server";

export const getAttendeeIdentityStateFn = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getAttendeeSession();
  return { authenticated: Boolean(session?.personId) };
});
