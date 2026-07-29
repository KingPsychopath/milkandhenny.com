import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { listPublishedPitchesFn } from "@/features/things/pitches/pitches.functions";
import { SITE_NAME } from "@/lib/shared/config";

const PitchEditor = lazy(() =>
  import("@/features/things/pitches/ui/PitchEditor").then((module) => ({
    default: module.PitchEditor,
  })),
);

export const Route = createFileRoute("/things/pitches_/demo")({
  loader: () => listPublishedPitchesFn(),
  component: PitchDemoRoute,
  head: () => ({ meta: [{ title: `Explore the pitch studio — ${SITE_NAME}` }] }),
});

function PitchDemoRoute() {
  const fallback = (
    <main id="main" className="p-8 font-mono text-sm theme-muted">
      opening the rehearsal studio…
    </main>
  );
  return (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <PitchEditor
          session={{ kind: "demo" }}
          maximumSlides={Route.useLoaderData().maximumSlides}
        />
      </Suspense>
    </ClientOnly>
  );
}
