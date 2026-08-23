import { createFileRoute, notFound } from "@tanstack/react-router";

import { readPublishedPitchFn } from "@/features/things/pitches/pitches.functions";
import { PitchViewer } from "@/features/things/pitches/ui/PitchViewer";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/pitches_/$deckId")({
  validateSearch: (search: Record<string, unknown>) => ({
    edition:
      typeof search.edition === "number" && Number.isInteger(search.edition) && search.edition > 0
        ? search.edition
        : undefined,
  }),
  loaderDeps: ({ search }) => ({ edition: search.edition }),
  loader: async ({ params, deps }) => {
    const pitch = await readPublishedPitchFn({
      data: { deckId: params.deckId, editionNumber: deps.edition },
    });
    if (!pitch) throw notFound();
    return pitch;
  },
  component: PublishedPitchRoute,
  head: ({ loaderData, params }) => {
    const title = loaderData?.title ?? "Pitch";
    const thumbnail = loaderData?.thumbnailUrl;
    return buildSeoHead({
      title: `${title} — ${SITE_NAME}`,
      description: `A sealed six-slide pitch by ${loaderData?.ownerName ?? "a Milk & Henny maker"}.`,
      path: `/things/pitches/${params.deckId}`,
      image: thumbnail || OG_IMAGES.pitchStudio,
      imageAlt: `${title} — a sealed pitch from Milk & Henny`,
    });
  },
});

function PublishedPitchRoute() {
  return <PitchViewer pitch={Route.useLoaderData()} />;
}
