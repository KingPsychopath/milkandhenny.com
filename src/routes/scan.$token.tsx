import { useEffect } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { SITE_NAME } from "@/lib/shared/config";
import { getScannerPageFn } from "@/features/tickets/scanner.functions";
import { forgetScanner, rememberScanner } from "@/features/tickets/scanner-memory";
import { DoorScanner } from "@/features/tickets/ui/DoorScanner";
import { CheckpointScanner } from "@/features/tickets/ui/CheckpointScanner";

/**
 * Shared-link scanner.
 *
 * The token in the URL is the credential: the admin makes a link per person
 * per station and sends it over chat. No PIN, no sign-in — open it and
 * scan. Revoking the link in admin kills it on the next scan.
 */
export const Route = createFileRoute("/scan/$token")({
  loader: ({ params }) => getScannerPageFn({ data: { token: params.token } }),
  component: ScanRoute,
  head: () => ({
    meta: [{ title: `Scanner — ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function DeadLink({ token }: { token: string }) {
  // A dead link must not keep resurfacing in the resume prompt.
  useEffect(() => {
    forgetScanner(token);
  }, [token]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <main id="main" className="w-full max-w-xs text-center">
        <p className="font-mono text-micro theme-muted tracking-widest uppercase">scanner</p>
        <h1 className="mt-2 font-serif text-2xl text-foreground">This link isn't active</h1>
        <p className="mt-4 font-mono text-xs theme-muted leading-relaxed">
          It may have been turned off or expired. Ask the organiser to send you a fresh scanner
          link.
        </p>
        <p className="mt-6">
          <Link to="/scan" className="font-mono text-micro theme-muted underline">
            other scanners on this phone
          </Link>
        </p>
      </main>
    </div>
  );
}

function ScanRoute() {
  const data = Route.useLoaderData();
  const { token } = Route.useParams();

  // Opening a live link earns a spot in this device's memory, so losing the
  // tab never means losing access.
  useEffect(() => {
    if (!data.found) return;
    rememberScanner({
      token: data.token,
      label: data.label,
      station: data.mode === "door" ? "door" : data.checkpoint.name,
      eventTitle: data.eventTitle,
    });
  }, [data]);

  if (!data.found) return <DeadLink token={token} />;

  if (data.mode === "door") {
    return (
      <DoorScanner
        eventSlug={data.eventSlug}
        eventTitle={data.eventTitle}
        initialManifest={data.door.manifestHashes}
        initialTickets={data.door.tickets}
        initialSummary={data.door.summary}
        scannerToken={data.token}
        scannerRole={data.role}
        scannerPermissions={data.permissions}
        initialRequests={data.requests}
      />
    );
  }

  return (
    <CheckpointScanner
      token={data.token}
      eventSlug={data.eventSlug}
      eventTitle={data.eventTitle}
      label={data.label}
      checkpoint={data.checkpoint}
      initialSummary={data.summary}
      initialTickets={data.tickets}
    />
  );
}
