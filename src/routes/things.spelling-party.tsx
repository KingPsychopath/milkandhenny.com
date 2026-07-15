import { createFileRoute } from "@tanstack/react-router";
import { PartySetupApp } from "@/features/things/spelling-party/PartySetupApp";
import { partyDeckCatalogFn } from "@/features/things/spelling-party/party-room.functions";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/spelling-party")({
  loader: () => partyDeckCatalogFn(),
  component: PartySetupRoute,
  head: () => ({ meta: [{ title: `Spelling Bee: Type Together — ${SITE_NAME}` }, { name: "description", content: "A synchronized multiplayer spelling bee for a shared screen and player phones." }] }),
});

function PartySetupRoute() { return <PartySetupApp decks={Route.useLoaderData()} />; }
