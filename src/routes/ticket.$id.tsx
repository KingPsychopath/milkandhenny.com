import { createFileRoute, notFound } from "@tanstack/react-router";

import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";
import { getTicketPageFn } from "@/features/event-operations/ticket-page.functions";
import { TicketPage } from "@/features/tickets/ui/TicketPage";

export const Route = createFileRoute("/ticket/$id")({
  loader: async ({ params }) => {
    const result = await getTicketPageFn({ data: { id: params.id } });
    if (!result.found) throw notFound();
    return result;
  },
  component: TicketRoute,
  head: ({ loaderData, params }) =>
    buildSeoHead({
      title: loaderData?.found ? `Ticket — ${loaderData.event.title}` : `Ticket — ${SITE_NAME}`,
      description: "A private Milk & Henny event ticket.",
      path: `/ticket/${params.id}`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function TicketRoute() {
  const data = Route.useLoaderData();
  return (
    <TicketPage
      ticket={data.ticket}
      event={data.event}
      qrPayload={data.qrPayload}
      orderTickets={data.orderTickets}
      orderSize={data.orderSize}
      orderPosition={data.orderPosition}
      canManageOrder={data.canManageOrder}
      managerTicketId={data.managerTicketId}
      checkpointNames={data.checkpointNames}
      album={data.album}
      score={data.score}
    />
  );
}
