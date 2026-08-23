import { createFileRoute, notFound } from "@tanstack/react-router";

import { readPublishedPitchFn } from "@/features/things/pitches/pitches.functions";
import { PitchViewer } from "@/features/things/pitches/ui/PitchViewer";
import { PitchOperationalNotice } from "@/features/things/pitches/ui/PitchOperationalNotice";
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
    const result = await readPublishedPitchFn({
      data: { deckId: params.deckId, editionNumber: deps.edition },
    });
    if (!result.operationalStatus.canRead) return result;
    if (!result.pitch) throw notFound();
    return result;
  },
  component: PublishedPitchRoute,
  head: ({ loaderData, params }) => {
    const title = loaderData?.pitch?.title ?? "Pitch";
    const thumbnail = loaderData?.pitch?.thumbnailUrl;
    return buildSeoHead({
      title: `${title} — ${SITE_NAME}`,
      description: `A sealed six-slide pitch by ${loaderData?.pitch?.ownerName ?? "a Milk & Henny maker"}.`,
      path: `/things/pitches/${params.deckId}`,
      image: thumbnail || OG_IMAGES.pitchStudio,
      imageAlt: `${title} — a sealed pitch from Milk & Henny`,
    });
  },
});

function PublishedPitchRoute() {
  const data = Route.useLoaderData();
  return data.pitch ? (
    <PitchViewer pitch={data.pitch} />
  ) : (
    <PitchOperationalNotice status={data.operationalStatus} />
  );
}
