import { createFileRoute } from "@tanstack/react-router";

import { getEvent } from "@/features/events/store.server";
import { buildEventIcs, buildTicketHolderIcsOptions } from "@/features/events/ics";
import { buildEventUrl, buildTicketUrl } from "@/features/events/routes";
import { getTicket } from "@/features/tickets/store.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

/**
 * Calendar download for one ticket.
 *
 * Authorised by the ticket id rather than the holder cookie, so the link
 * still carries the address when it is opened from a confirmation email on a
 * phone that has never loaded the ticket page. A cookie-gated link would
 * quietly hand that phone a calendar entry saying only "London".
 */
async function handleGET(request: Request, id: string) {
  try {
    const ticket = await getTicket(id);
    if (!ticket || ticket.status !== "valid") {
      return new Response("Not found", { status: 404 });
    }

    const event = await getEvent(ticket.eventSlug);
    if (!event) return new Response("Not found", { status: 404 });

    const origin = getBaseUrlForRequest(request);
    const ics = buildEventIcs(
      event,
      buildTicketHolderIcsOptions(event, {
        eventUrl: buildEventUrl(origin, event.slug),
        ticketUrl: buildTicketUrl(origin, ticket.id),
      }),
    );

    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${event.slug}.ics"`,
        // The ticket id is a bearer token; nothing shared may hold this body.
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    return apiErrorFromRequest(request, "tickets.ics", "Failed to build calendar file", error);
  }
}

export const Route = createFileRoute("/api/tickets/$id/ics")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.id),
    },
  },
});
