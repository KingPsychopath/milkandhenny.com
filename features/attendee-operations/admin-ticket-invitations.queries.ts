import { queryOptions } from "@tanstack/react-query";
import { getAdminTicketInvitationsFn } from "./admin-ticket-invitations.functions";

export const adminTicketInvitationsQuery = (eventSlug: string) =>
  queryOptions({
    queryKey: ["admin", "events", eventSlug, "ticket-invitations"] as const,
    queryFn: () => getAdminTicketInvitationsFn({ data: { eventSlug } }),
    staleTime: 5_000,
    retry: false,
  });
