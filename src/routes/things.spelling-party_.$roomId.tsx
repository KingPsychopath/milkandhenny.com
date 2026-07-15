import { createFileRoute } from "@tanstack/react-router";
import { PartyPlayerApp } from "@/features/things/spelling-party/PartyPlayerApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/spelling-party_/$roomId")({ component: PartyPlayerRoute, head: () => ({ meta: [{ title: `Join Party Typing — ${SITE_NAME}` }] }) });
function PartyPlayerRoute() { return <PartyPlayerApp roomId={Route.useParams().roomId.toUpperCase()} />; }
