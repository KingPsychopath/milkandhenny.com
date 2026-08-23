import { createFileRoute } from "@tanstack/react-router";

import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";
import { getDropPageFn } from "@/features/events/drop.functions";
import { DropPage } from "@/features/events/ui/DropPage";

/**
 * Guest media drop — the QR on the wall at the party.
 *
 * The token in the URL is the whole credential; the admin can kill it any
 * time from the event's manage panel.
 */
export const Route = createFileRoute("/drop/$token")({
  loader: ({ params }) => getDropPageFn({ data: { token: params.token } }),
  component: DropRoute,
  head: ({ params }) =>
    buildSeoHead({
      title: `Share your photos — ${SITE_NAME}`,
      description: "Upload photos to a private Milk & Henny event gallery.",
      path: `/drop/${params.token}`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function DeadDrop() {
  return (
    <div className="min-h-dvh bg-background flex items-center justify-center p-6">
      <main id="main" className="w-full max-w-xs text-center">
        <p className="font-mono text-micro theme-muted tracking-widest uppercase">uploads</p>
        <h1 className="mt-2 font-serif text-2xl text-foreground">This link isn't active</h1>
        <p className="mt-4 font-mono text-xs theme-muted leading-relaxed">
          Uploads for this event have closed or the link was turned off. Ask the organiser if
          they've got a fresh one.
        </p>
      </main>
    </div>
  );
}

function DropRoute() {
  const data = Route.useLoaderData();
  if (!data.found) return <DeadDrop />;
  return (
    <DropPage
      token={data.token}
      eventTitle={data.eventTitle}
      initialFileCount={data.fileCount}
      albumPath={data.albumPath}
    />
  );
}
