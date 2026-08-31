import { createFileRoute, Link } from "@tanstack/react-router";

import {
  addEventIcebreakerEncounterFn,
  getEventIcebreakerFn,
} from "@/features/event-icebreaker/event-icebreaker.functions";
import { IcebreakerApp } from "@/features/things/icebreaker/IcebreakerApp";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/events/$slug_/icebreaker")({
  validateSearch: (search: Record<string, unknown>) => ({
    ticket: typeof search.ticket === "string" ? search.ticket : undefined,
  }),
  loaderDeps: ({ search }) => ({ ticket: search.ticket }),
  loader: ({ params, deps }) =>
    getEventIcebreakerFn({
      data: { eventSlug: params.slug, ticketReference: deps.ticket },
    }),
  component: EventIcebreakerRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: "Event icebreaker",
      description: "Reveal your event colour and meet someone new.",
      path: `/events/${params.slug}/icebreaker`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function EventIcebreakerRoute() {
  const launch = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { ticket } = Route.useSearch();
  if (!launch.ok) {
    return (
      <main
        id="main"
        className="mx-auto grid min-h-screen w-full max-w-md place-content-center px-6 py-16"
      >
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">icebreaker</p>
        <h1 className="mt-3 font-serif text-4xl text-foreground">Not quite yet.</h1>
        <p className="mt-4 font-serif text-lg leading-relaxed theme-subtle">{launch.error}</p>
        {ticket ? (
          <Link
            to="/ticket/$id"
            params={{ id: ticket }}
            className="mt-7 inline-flex min-h-12 items-center font-mono text-sm underline hover:opacity-70"
          >
            return to ticket
          </Link>
        ) : (
          <Link
            to="/events/$slug"
            params={{ slug }}
            className="mt-7 inline-flex min-h-12 items-center font-mono text-sm underline hover:opacity-70"
          >
            return to event
          </Link>
        )}
      </main>
    );
  }

  const ticketReference = launch.value.ticketReference;
  return (
    <IcebreakerApp
      experience={{
        player: launch.value.player,
        initialLedger: launch.value.ledger,
        pairingPath: `/events/${encodeURIComponent(slug)}/icebreaker`,
        backHref: `/ticket/${encodeURIComponent(ticketReference)}`,
        backLabel: "ticket",
        eventLabel: "event icebreaker",
        recordEncounter: async (partner) => {
          const result = await addEventIcebreakerEncounterFn({
            data: { eventSlug: slug, ticketReference, partnerCode: partner.id },
          });
          if (!result.ok) throw new Error(result.error);
          return result.value;
        },
      }}
    />
  );
}
