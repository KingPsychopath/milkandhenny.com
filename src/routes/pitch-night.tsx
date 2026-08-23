import { createFileRoute } from "@tanstack/react-router";

import { getEventsIndexFn } from "@/features/events/events.functions";
import { PitchNightExperience } from "@/features/pitch-night/PitchNightExperience";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

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
    ...buildSeoHead({
      title: `After School Club — ${SITE_NAME}`,
      description:
        "Pitches, unpopular opinions, conspiracies, a spelling bee, board games, music, food, and free parking from Milk & Henny.",
      path: "/pitch-night",
      image: OG_IMAGES.pitchNight,
      imageAlt: "After School Club — pitches, games, music, and food from Milk & Henny",
    }),
    scripts: [{ children: PREPARE_SCROLL_RESTORATION }],
  }),
});

function PitchNightRoute() {
  return <PitchNightExperience ticketHref={Route.useLoaderData().ticketHref} />;
}
