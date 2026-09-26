import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";

import { publishedPitchQuery } from "@/features/things/pitches/pitches.queries";
import { PitchViewer } from "@/features/things/pitches/ui/PitchViewer";
import { PitchOperationalNotice } from "@/features/things/pitches/ui/PitchOperationalNotice";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/pitches_/$deckId")({
  validateSearch: (search: Record<string, unknown>): { edition?: number } =>
    typeof search.edition === "number" && Number.isInteger(search.edition) && search.edition > 0
      ? { edition: search.edition }
      : {},
  loaderDeps: ({ search }) => ({ edition: search.edition }),
  loader: async ({ context, params, deps }) => {
    const result = await context.queryClient.fetchQuery(
      publishedPitchQuery(params.deckId, deps.edition),
    );
    if (!result.pitch && !result.loadError) throw notFound();
    return {
      title: result.pitch?.title,
      ownerName: result.pitch?.ownerName,
      thumbnail: result.pitch?.thumbnail,
      indexable: Boolean(result.pitch),
    };
  },
  preloadStaleTime: 0,
  component: PublishedPitchRoute,
  head: ({ loaderData, params }) => {
    const title = loaderData?.title ?? "Pitch";
    const thumbnail = loaderData?.thumbnail;
    return buildSeoHead({
      title: `${title} — ${SITE_NAME}`,
      description: `A sealed six-slide pitch by ${loaderData?.ownerName ?? "a Milk & Henny maker"}.`,
      path: `/things/pitches/${params.deckId}`,
      image: thumbnail?.src || OG_IMAGES.pitchStudio,
      imageAlt: `${title} — a sealed pitch from Milk & Henny`,
      robots: loaderData?.indexable ? "index, follow" : "noindex, nofollow",
    });
  },
});

function PublishedPitchRoute() {
  const { deckId } = Route.useParams();
  const { edition } = Route.useSearch();
  const { data } = useSuspenseQuery(publishedPitchQuery(deckId, edition));
  if (data.pitch) return <PitchViewer pitch={data.pitch} />;
  if (!data.operationalStatus.canRead) {
    return <PitchOperationalNotice status={data.operationalStatus} />;
  }
  return (
    <main id="main" className="mx-auto min-h-screen max-w-2xl px-6 py-20">
      <div
        className="border-y border-[var(--things-amber)] bg-[var(--selection-bg)] px-5 py-5 text-center"
        role="alert"
      >
        <h1 className="font-serif text-3xl text-[var(--selection-fg)]">
          The pitch could not open.
        </h1>
        <p className="mt-3 font-serif text-lg text-[var(--selection-fg)]">{data.loadError}</p>
      </div>
    </main>
  );
}
