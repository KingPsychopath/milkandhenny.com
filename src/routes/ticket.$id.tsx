import { createFileRoute, notFound } from "@tanstack/react-router";

import { SITE_NAME } from "@/lib/shared/config";
import { getTicketPageFn } from "@/features/tickets/tickets.functions";
import { TicketPage } from "@/features/tickets/ui/TicketPage";

export const Route = createFileRoute("/ticket/$id")({
  loader: async ({ params }) => {
    const result = await getTicketPageFn({ data: { id: params.id } });
    if (!result.found) throw notFound();
    return result;
  },
  component: TicketRoute,
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.found ? `Ticket — ${loaderData.event.title}` : `Ticket — ${SITE_NAME}`,
      },
      // A ticket is a bearer token in a URL. Keep it out of search results.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function TicketRoute() {
  const data = Route.useLoaderData();
  return <TicketPage ticket={data.ticket} event={data.event} qrPayload={data.qrPayload} />;
}
