import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { listPublishedPitchesFn } from "@/features/things/pitches/pitches.functions";
import { SITE_NAME } from "@/lib/shared/config";

const PitchEditor = lazy(() =>
  import("@/features/things/pitches/ui/PitchEditor").then((module) => ({
    default: module.PitchEditor,
  })),
);

export const Route = createFileRoute("/things/pitches_/$deckId_/edit")({
  loader: () => listPublishedPitchesFn(),
  component: PitchEditorRoute,
  head: () => ({ meta: [{ title: `Pitch studio — ${SITE_NAME}` }] }),
});

function PitchEditorRoute() {
  const { deckId } = Route.useParams();
  const fallback = (
    <main id="main" className="p-8 font-mono text-sm theme-muted">
      opening your studio…
    </main>
  );
  return (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <PitchEditor deckId={deckId} maximumSlides={Route.useLoaderData().maximumSlides} />
      </Suspense>
    </ClientOnly>
  );
}
