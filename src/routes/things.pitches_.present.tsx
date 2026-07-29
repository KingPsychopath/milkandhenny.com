import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { authenticateRequest } from "@/features/auth/auth.server";
import { PresentationSetup } from "@/features/things/pitches/ui/PresentationSetup";
import { SITE_NAME } from "@/lib/shared/config";

const getPresentationAccess = createServerFn({ method: "GET" }).handler(() =>
  authenticateRequest(getRequest(), "admin"),
);

export const Route = createFileRoute("/things/pitches_/present")({
  loader: () => getPresentationAccess(),
  component: PresentationSetupRoute,
  head: () => ({ meta: [{ title: `Present pitches — ${SITE_NAME}` }] }),
});

function PresentationSetupRoute() {
  return <PresentationSetup authorised={Route.useLoaderData().ok} />;
}
