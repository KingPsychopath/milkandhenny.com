import { createFileRoute } from "@tanstack/react-router";

import { getEventsIndexFn } from "@/features/events/events.functions";
import { PitchNightExperience } from "@/features/pitch-night/PitchNightExperience";
import { SITE_NAME } from "@/lib/shared/config";

const PREPARE_SCROLL_RESTORATION =
  'if("scrollRestoration" in history){history.scrollRestoration="manual";const n=performance.getEntriesByType("navigation")[0];if(n?.type==="reload"&&!location.hash)scrollTo(0,0)}';

export const Route = createFileRoute("/pitch-night")({
  loader: async () => {
    const events = await getEventsIndexFn();
    const event = events.upcoming.find((candidate) => candidate.marketingPath === "/pitch-night");
    return { ticketHref: event ? `/events/${encodeURIComponent(event.slug)}` : "/events" };
  },
  component: PitchNightRoute,
  head: () => ({
    meta: [
      { title: `After School Club — ${SITE_NAME}` },
      {
        name: "description",
        content:
          "Milk & Henny: After School Club. Pitch night, spelling bee, board games, a live Apartment Life DJ set, catering and free parking.",
      },
      { property: "og:image", content: "/MAHLogo.svg" },
    ],
    scripts: [{ children: PREPARE_SCROLL_RESTORATION }],
  }),
});

function PitchNightRoute() {
  return <PitchNightExperience ticketHref={Route.useLoaderData().ticketHref} />;
}
