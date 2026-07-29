import { createFileRoute, notFound } from "@tanstack/react-router";

import { readPublishedPitchFn } from "@/features/things/pitches/pitches.functions";
import { PitchViewer } from "@/features/things/pitches/ui/PitchViewer";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/pitches_/$deckId")({
  loader: async ({ params }) => {
    const pitch = await readPublishedPitchFn({ data: { deckId: params.deckId } });
    if (!pitch) throw notFound();
    return pitch;
  },
  component: PublishedPitchRoute,
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.title ?? "Pitch"} — ${SITE_NAME}` }],
  }),
});

function PublishedPitchRoute() {
  return <PitchViewer pitch={Route.useLoaderData()} />;
}
