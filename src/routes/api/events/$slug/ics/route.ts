import { createFileRoute } from "@tanstack/react-router";

import { getEvent } from "@/features/events/store.server";
import { buildEventIcs } from "@/features/events/ics";
import { buildEventUrl } from "@/features/events/routes";
import { isPubliclyVisible } from "@/features/events/types";
import { readTicketHolderSlugs } from "@/features/tickets/holder-cookie.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

/**
 * Calendar download.
 *
 * Ticket holders get the real address in the LOCATION field; everyone else
 * gets the public area, matching the gating on the event page itself.
 */
async function handleGET(request: Request, slug: string) {
  try {
    const event = await getEvent(slug);
    if (!event || !isPubliclyVisible(event)) {
      return new Response("Not found", { status: 404 });
    }

    const revealed = readTicketHolderSlugs().includes(slug);
    const location = revealed
      ? [event.venueName, event.address].filter(Boolean).join(", ") || event.area
      : event.area;

    const ics = buildEventIcs(event, {
      url: buildEventUrl(getBaseUrlForRequest(request), slug),
      location: location || undefined,
    });

    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}.ics"`,
        // Private: the body differs per viewer depending on ticket ownership.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiErrorFromRequest(request, "events.ics", "Failed to build calendar file", error);
  }
}

export const Route = createFileRoute("/api/events/$slug/ics")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.slug),
    },
  },
});
