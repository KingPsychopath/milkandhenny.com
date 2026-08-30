import { createFileRoute, notFound } from "@tanstack/react-router";

import { readPublishedPitchFn } from "@/features/things/pitches/pitches.functions";
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
  loader: async ({ params, deps }) => {
    const result = await readPublishedPitchFn({
      data: { deckId: params.deckId, editionNumber: deps.edition },
    });
    if (!result.operationalStatus.canRead) return result;
    if (!result.pitch && !result.loadError) throw notFound();
    return result;
  },
  component: PublishedPitchRoute,
  head: ({ loaderData, params }) => {
    const title = loaderData?.pitch?.title ?? "Pitch";
    const thumbnail = loaderData?.pitch?.thumbnail;
    return buildSeoHead({
      title: `${title} — ${SITE_NAME}`,
      description: `A sealed six-slide pitch by ${loaderData?.pitch?.ownerName ?? "a Milk & Henny maker"}.`,
      path: `/things/pitches/${params.deckId}`,
      image: thumbnail?.src || OG_IMAGES.pitchStudio,
      imageAlt: `${title} — a sealed pitch from Milk & Henny`,
      robots: loaderData?.pitch ? "index, follow" : "noindex, nofollow",
    });
  },
});

function PublishedPitchRoute() {
  const data = Route.useLoaderData();
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
