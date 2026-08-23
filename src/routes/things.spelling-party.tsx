import { createFileRoute } from "@tanstack/react-router";
import { PartySetupApp } from "@/features/things/spelling-party/PartySetupApp";
import { partyDeckCatalogFn } from "@/features/things/spelling-party/party-room.functions";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/spelling-party")({
  loader: () => partyDeckCatalogFn(),
  component: PartySetupRoute,
  head: () =>
    buildSeoHead({
      title: `Spelling Bee: Type Together — ${SITE_NAME}`,
      description: "A synchronized multiplayer spelling bee for a shared screen and player phones.",
      path: "/things/spelling-party",
      image: OG_IMAGES.spellingParty,
      imageAlt: "Type Together — a multiplayer spelling bee for a shared screen and phones",
    }),
});

function PartySetupRoute() {
  return <PartySetupApp decks={Route.useLoaderData()} />;
}
