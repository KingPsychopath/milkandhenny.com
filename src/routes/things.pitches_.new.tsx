import { createFileRoute } from "@tanstack/react-router";

import { listPublishedPitchesFn } from "@/features/things/pitches/pitches.functions";
import { NewPitch } from "@/features/things/pitches/ui/NewPitch";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/pitches_/new")({
  loader: () => listPublishedPitchesFn(),
  component: NewPitchRoute,
  head: () => ({ meta: [{ title: `New pitch — ${SITE_NAME}` }] }),
});

function NewPitchRoute() {
  return <NewPitch maximumSlides={Route.useLoaderData().maximumSlides} />;
}
