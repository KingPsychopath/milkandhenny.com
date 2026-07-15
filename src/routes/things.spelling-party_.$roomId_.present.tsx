import { createFileRoute } from "@tanstack/react-router";
import { PartyPresenterApp } from "@/features/things/spelling-party/PartyPresenterApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/spelling-party_/$roomId_/present")({ component: PartyPresenterRoute, head: () => ({ meta: [{ title: `Present Party Typing — ${SITE_NAME}` }] }) });
function PartyPresenterRoute() { return <PartyPresenterApp roomId={Route.useParams().roomId.toUpperCase()} />; }
