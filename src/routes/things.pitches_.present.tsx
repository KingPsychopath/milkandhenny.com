import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { authenticateRequest } from "@/features/auth/auth.server";
import { PresentationSetup } from "@/features/things/pitches/ui/PresentationSetup";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

const getPresentationAccess = createServerFn({ method: "GET" }).handler(() =>
  authenticateRequest(getRequest(), "admin"),
);

export const Route = createFileRoute("/things/pitches_/present")({
  loader: () => getPresentationAccess(),
  component: PresentationSetupRoute,
  head: () =>
    buildSeoHead({
      title: `Present pitches — ${SITE_NAME}`,
      description: "Choose a private pitch and present it on the big screen.",
      path: "/things/pitches/present",
      image: OG_IMAGES.pitchStudio,
      robots: "noindex, nofollow",
    }),
});

function PresentationSetupRoute() {
  return <PresentationSetup authorised={Route.useLoaderData().ok} />;
}
