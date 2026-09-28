import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireAuthWithPayload } from "@/features/auth/auth.server";
import { listAdminTicketInvitations } from "./ticket-operations.server";

export const getAdminTicketInvitationsFn = createServerFn({ method: "GET" })
  .validator((data: { eventSlug: string }) => ({ eventSlug: data.eventSlug.trim().slice(0, 160) }))
  .handler(async ({ data }) => {
    const auth = await requireAuthWithPayload(getRequest(), "admin");
    if (auth.error) throw new Error("Admin access required");
    return listAdminTicketInvitations(data.eventSlug);
  });
