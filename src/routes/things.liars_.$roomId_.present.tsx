import { createFileRoute } from "@tanstack/react-router";
import { LiarsPresenterApp } from "@/features/things/liars/LiarsPresenterApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/liars_/$roomId_/present")({
  component: LiarsPresenterRoute,
  head: () => ({ meta: [{ title: `Liars — big screen — ${SITE_NAME}` }] }),
});

function LiarsPresenterRoute() {
  return <LiarsPresenterApp roomId={Route.useParams().roomId.toUpperCase()} />;
}
