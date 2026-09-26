import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";

import { SITE_NAME } from "@/lib/shared/config";
import { eventPageQuery } from "@/features/events/events.queries";
import { buildEventJsonLd } from "@/features/events/ics";
import { buildEventUrl } from "@/features/events/routes";
import { EventDetailPage } from "@/features/events/ui/EventDetailPage";
import { serializeJsonForHtml } from "@/lib/shared/serialize-json-for-html";
import { absoluteUrl, OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/events/$slug")({
  // Stripe's cancel URL lands here. Reading it is the difference between
  // "I backed out of checkout" and "did that just take my money?"
  //
  // Optional key, not a key holding `undefined`: the latter would make
  // `search` a required prop on every existing link to an event page.
  validateSearch: (search: Record<string, unknown>): { checkout?: "cancelled" } =>
    search.checkout === "cancelled" ? { checkout: "cancelled" } : {},
  loader: async ({ context, params }) => {
    const result = await context.queryClient.fetchQuery(eventPageQuery(params.slug));
    if (!result.found) throw notFound();
    const { event } = result.data;
    return {
      title: event.title,
      tagline: event.tagline,
      area: event.area,
      slug: event.slug,
      ogImage: event.ogImage,
      heroImage: event.heroImage,
      origin: result.origin,
    };
  },
  preloadStaleTime: 0,
  component: EventDetailRoute,
  head: ({ loaderData }) => {
    if (!loaderData) {
      return buildSeoHead({
        title: `Event — ${SITE_NAME}`,
        description: "An event from Milk & Henny.",
        path: "/events",
        robots: "noindex, nofollow",
      });
    }
    const event = loaderData;
    const url = buildEventUrl(event.origin, event.slug);
    const description = event.tagline ?? `${event.title} — ${event.area ?? "London"}`;
    const image = event.ogImage ?? event.heroImage ?? OG_IMAGES.events;

    return buildSeoHead({
      title: `${event.title} — ${SITE_NAME}`,
      description,
      path: url,
      image,
      imageAlt: `${event.title} — Milk & Henny event`,
    });
  },
});

function EventDetailRoute() {
  const { data: result } = useSuspenseQuery(eventPageQuery(Route.useParams().slug));
  if (!result.found) throw notFound();
  const { data, origin, waitlistEmail } = result;
  const { checkout } = Route.useSearch();
  const { event, availability } = data;

  // Built from public fields only, so a gated address cannot leak into
  // structured data even when the viewer holds a ticket.
  const jsonLd = buildEventJsonLd(event, {
    url: buildEventUrl(origin, event.slug),
    imageUrl: absoluteUrl(event.ogImage ?? event.heroImage ?? OG_IMAGES.events),
    soldOutTicketTypeIds: new Set(
      availability.filter((entry) => entry.remaining === 0).map((entry) => entry.type.id),
    ),
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonForHtml(jsonLd) }}
      />
      <EventDetailPage
        event={event}
        availability={availability}
        soldOut={data.soldOut}
        pitchShowcase={data.pitchShowcase}
        heroImage={data.heroImage}
        descriptionImages={data.descriptionImages}
        checkoutCancelled={checkout === "cancelled"}
        waitlistEmail={waitlistEmail}
      />
    </>
  );
}
