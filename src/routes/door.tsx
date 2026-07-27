import { Link, createFileRoute } from "@tanstack/react-router";

import { SITE_NAME } from "@/lib/shared/config";
import { signInStaff } from "@/features/auth/auth.functions";
import { getDoorPageFn } from "@/features/tickets/tickets.functions";
import { DoorScanner } from "@/features/tickets/ui/DoorScanner";

/**
 * Door check-in.
 *
 * Replaces `/guestlist`. Same staff PIN gate, but scanner-first rather than
 * search-first, and it keeps working when the venue wifi does not.
 */
export const Route = createFileRoute("/door")({
  validateSearch: (search: Record<string, unknown>) => ({
    auth: search.auth === "failed" ? ("failed" as const) : undefined,
    event: typeof search.event === "string" ? search.event : undefined,
  }),
  loaderDeps: ({ search }) => ({ event: search.event }),
  loader: ({ deps }) => getDoorPageFn({ data: { eventSlug: deps.event } }),
  component: DoorRoute,
  head: () => ({
    meta: [{ title: `Door — ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function StaffGate({ failed }: { failed: boolean }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <main id="main" className="w-full max-w-xs">
        <p className="text-center font-mono text-micro theme-muted tracking-widest uppercase">
          door
        </p>
        <h1 className="mt-2 text-center font-serif text-2xl text-foreground">Staff only</h1>

        {failed && (
          <p
            role="alert"
            className="mt-4 text-center font-mono text-xs text-[var(--things-country-outside)]"
          >
            Incorrect PIN
          </p>
        )}

        <form
          action={signInStaff.url}
          method="post"
          encType="multipart/form-data"
          className="mt-6 space-y-3"
        >
          <label htmlFor="door-pin" className="sr-only">
            Staff PIN
          </label>
          <input
            id="door-pin"
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            placeholder="••••"
            autoFocus
            required
            className="w-full min-h-14 rounded-lg border theme-border-strong bg-transparent px-4 text-center font-mono text-2xl tracking-pin text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
          />
          <button
            type="submit"
            className="w-full min-h-12 rounded-lg bg-foreground font-mono text-sm text-background"
          >
            enter
          </button>
        </form>

        <p className="mt-8 text-center">
          <Link
            to="/events"
            className="font-mono text-micro theme-muted hover:text-foreground transition-colors"
          >
            ← events
          </Link>
        </p>
      </main>
    </div>
  );
}

function EventPicker({ events }: { events: { slug: string; title: string }[] }) {
  return (
    <div className="min-h-screen bg-background">
      <main id="main" className="mx-auto max-w-md px-6 pt-16">
        <p className="font-mono text-micro theme-muted tracking-widest uppercase">door</p>
        <h1 className="mt-2 font-serif text-2xl text-foreground">Which door?</h1>

        {events.length === 0 ? (
          <p className="mt-6 font-mono text-sm theme-muted">
            No events to work yet. Create one in the admin panel.
          </p>
        ) : (
          <ul className="mt-6 divide-y theme-border border-y theme-border">
            {events.map((event) => (
              <li key={event.slug}>
                <Link
                  to="/door"
                  search={{ event: event.slug, auth: undefined }}
                  className="block py-4 font-mono text-sm text-foreground hover:opacity-70 transition-opacity"
                >
                  {event.title} →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function DoorRoute() {
  const data = Route.useLoaderData();
  const { auth } = Route.useSearch();

  if (!data.isAuthed) return <StaffGate failed={auth === "failed"} />;
  if (!data.door) return <EventPicker events={data.events} />;

  return (
    <DoorScanner
      eventSlug={data.door.eventSlug}
      eventTitle={data.door.eventTitle}
      initialManifest={data.door.manifestHashes}
      initialTickets={data.door.tickets}
      initialSummary={data.door.summary}
    />
  );
}
