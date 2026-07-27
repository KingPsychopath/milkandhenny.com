import { createFileRoute } from "@tanstack/react-router";

import { SITE_NAME } from "@/lib/shared/config";
import { getEventsIndexFn } from "@/features/events/events.functions";
import { EventsIndexPage } from "@/features/events/ui/EventsIndexPage";

export const Route = createFileRoute("/events/")({
  loader: () => getEventsIndexFn(),
  component: EventsRoute,
  head: () => ({
    meta: [
      { title: `Events — ${SITE_NAME}` },
      {
        name: "description",
        content: "Upcoming nights, games and gatherings from milk & henny.",
      },
      { property: "og:title", content: `Events — ${SITE_NAME}` },
      { property: "og:type", content: "website" },
    ],
  }),
});

function EventsRoute() {
  const { upcoming, past } = Route.useLoaderData();
  return <EventsIndexPage upcoming={upcoming} past={past} />;
}
