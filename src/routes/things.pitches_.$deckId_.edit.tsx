import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { listPublishedPitchesFn } from "@/features/things/pitches/pitches.functions";
import { SITE_NAME } from "@/lib/shared/config";
import { PitchOperationalNotice } from "@/features/things/pitches/ui/PitchOperationalNotice";
import { buildSeoHead } from "@/lib/shared/seo";

const PitchEditor = lazy(() =>
  import("@/features/things/pitches/ui/PitchEditor").then((module) => ({
    default: module.PitchEditor,
  })),
);

export const Route = createFileRoute("/things/pitches_/$deckId_/edit")({
  ssr: false,
  loader: () => listPublishedPitchesFn(),
  component: PitchEditorRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Pitch studio — ${SITE_NAME}`,
      description: "Edit a private Milk & Henny pitch.",
      path: `/things/pitches/${params.deckId}/edit`,
      robots: "noindex, nofollow",
    }),
});

function PitchEditorRoute() {
  const { deckId } = Route.useParams();
  const data = Route.useLoaderData();
  if (!data.operationalStatus.canRead) {
    return <PitchOperationalNotice status={data.operationalStatus} />;
  }
  const fallback = (
    <main id="main" className="p-8 font-mono text-sm theme-muted">
      opening your studio…
    </main>
  );
  return (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <PitchEditor
          key={deckId}
          session={{ kind: "owned", deckId }}
          maximumSlides={data.maximumSlides}
          operationalStatus={data.operationalStatus}
          creatorIdentity={data.creatorIdentity}
        />
      </Suspense>
    </ClientOnly>
  );
}
