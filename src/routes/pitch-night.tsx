import { createFileRoute } from "@tanstack/react-router";

import { getEventsIndexFn } from "@/features/events/events.functions";
import { PitchNightExperience } from "@/features/pitch-night/PitchNightExperience";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/pitch-night")({
  loader: async () => {
    const events = await getEventsIndexFn();
    const event = events.upcoming.find((candidate) => candidate.marketingPath === "/pitch-night");
    return { ticketHref: event ? `/events/${encodeURIComponent(event.slug)}` : "/events" };
  },
  component: PitchNightRoute,
  head: () => ({
    meta: [
      { title: `The Pitch Night — ${SITE_NAME}` },
      {
        name: "description",
        content:
          "Pitch night, spelling bee, board games, a live Apartment Life DJ set, catering and free parking.",
      },
      { property: "og:image", content: "/MAHLogo.svg" },
    ],
  }),
});

function PitchNightRoute() {
  return <PitchNightExperience ticketHref={Route.useLoaderData().ticketHref} />;
}
