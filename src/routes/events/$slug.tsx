import { createFileRoute, notFound } from "@tanstack/react-router";

import { SITE_NAME } from "@/lib/shared/config";
import { getEventPageFn } from "@/features/events/events.functions";
import { buildEventJsonLd } from "@/features/events/ics";
import { buildEventUrl } from "@/features/events/routes";
import { EventDetailPage } from "@/features/events/ui/EventDetailPage";
import { serializeJsonForHtml } from "@/lib/shared/serialize-json-for-html";

export const Route = createFileRoute("/events/$slug")({
  // Stripe's cancel URL lands here. Reading it is the difference between
  // "I backed out of checkout" and "did that just take my money?"
  // Stripe's cancel URL lands here. Reading it is the difference between
  // "I backed out of checkout" and "did that just take my money?"
  //
  // Optional key, not a key holding `undefined`: the latter would make
  // `search` a required prop on every existing link to an event page.
  validateSearch: (search: Record<string, unknown>): { checkout?: "cancelled" } =>
    search.checkout === "cancelled" ? { checkout: "cancelled" } : {},
  loader: async ({ params }) => {
    const result = await getEventPageFn({ data: { slug: params.slug } });
    if (!result.found) throw notFound();
    return result;
  },
  component: EventDetailRoute,
  head: ({ loaderData }) => {
    if (!loaderData?.found) return { meta: [{ title: `Event — ${SITE_NAME}` }] };
    const { event } = loaderData.data;
    const url = buildEventUrl(loaderData.origin, event.slug);
    const description = event.tagline ?? `${event.title} — ${event.area ?? "London"}`;
    const image = event.ogImage ?? event.heroImage;

    return {
      meta: [
        { title: `${event.title} — ${SITE_NAME}` },
        { name: "description", content: description },
        { property: "og:title", content: event.title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        ...(image ? [{ property: "og:image", content: image }] : []),
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
});

function EventDetailRoute() {
  const { data, origin } = Route.useLoaderData();
  const { checkout } = Route.useSearch();
  const { event, availability } = data;

  // Built from public fields only, so a gated address cannot leak into
  // structured data even when the viewer holds a ticket.
  const jsonLd = buildEventJsonLd(event, {
    url: buildEventUrl(origin, event.slug),
    imageUrl: event.ogImage ?? event.heroImage,
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
        checkoutCancelled={checkout === "cancelled"}
      />
    </>
  );
}
