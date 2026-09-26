import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";

import { SITE_NAME } from "@/lib/shared/config";
import { eventsIndexQuery } from "@/features/events/events.queries";
import { EventsIndexPage } from "@/features/events/ui/EventsIndexPage";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/events/")({
  loader: async ({ context }) => {
    await context.queryClient.fetchQuery(eventsIndexQuery);
  },
  preloadStaleTime: 0,
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
  const {
    data: { upcoming, past },
  } = useSuspenseQuery(eventsIndexQuery);
  return <EventsIndexPage upcoming={upcoming} past={past} />;
}
