import { createFileRoute } from "@tanstack/react-router";

import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";
import { getCheckoutOutcomeFn } from "@/features/tickets/tickets.functions";
import { PurchaseCompletePage } from "@/features/tickets/ui/PurchaseCompletePage";

/**
 * Where Stripe returns a buyer. The session id in the query is the
 * credential, so this page is treated like a ticket: out of search results,
 * and no referrer carried to whatever they click next.
 */
export const Route = createFileRoute("/events/$slug_/bought")({
  validateSearch: (search: Record<string, unknown>) => ({
    session: typeof search.session === "string" ? search.session : "",
  }),
  loaderDeps: ({ search }) => ({ session: search.session }),
  loader: {
    handler: async ({ deps }) => {
      if (!deps.session) return { outcome: { state: "unknown" as const } };
      return { outcome: await getCheckoutOutcomeFn({ data: { sessionId: deps.session } }) };
    },
    staleReloadMode: "blocking",
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
  component: PurchaseCompleteRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Tickets confirmed — ${SITE_NAME}`,
      description: "Your Milk & Henny ticket purchase is being confirmed.",
      path: `/events/${params.slug}/bought`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function PurchaseCompleteRoute() {
  const { slug } = Route.useParams();
  const { session } = Route.useSearch();
  const { outcome } = Route.useLoaderData();

  return <PurchaseCompletePage slug={slug} sessionId={session} initialOutcome={outcome} />;
}
