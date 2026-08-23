import { createFileRoute } from "@tanstack/react-router";

import { SITE_NAME } from "@/lib/shared/config";
import { getEventsIndexFn } from "@/features/events/events.functions";
import { EventsIndexPage } from "@/features/events/ui/EventsIndexPage";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/events/")({
  loader: () => getEventsIndexFn(),
  component: EventsRoute,
  head: () =>
    buildSeoHead({
      title: `Events — ${SITE_NAME}`,
      description: "Upcoming nights, games, and gatherings from Milk & Henny.",
      path: "/events",
      image: OG_IMAGES.events,
      imageAlt: "Milk & Henny events — upcoming nights, games, and gatherings",
    }),
});

function EventsRoute() {
  const { upcoming, past } = Route.useLoaderData();
  return <EventsIndexPage upcoming={upcoming} past={past} />;
}
