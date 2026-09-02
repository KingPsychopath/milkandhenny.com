import { Link } from "@tanstack/react-router";

export function ScoringRetiredPage({ eventSlug }: { eventSlug: string }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl items-center px-6 py-16">
      <section className="w-full border-y theme-border py-10">
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">event games</p>
        <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tight">
          This points link has finished.
        </h1>
        <p className="mt-4 max-w-lg font-serif text-lg leading-relaxed theme-subtle">
          You do not need to reconnect a ticket or retry this code. Your event ticket and the games
          themselves still work normally.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            to="/events/$slug"
            params={{ slug: eventSlug }}
            className="inline-flex min-h-12 items-center rounded-full bg-foreground px-6 font-mono text-sm font-semibold text-background"
          >
            back to the event
          </Link>
          <Link
            to="/things"
            className="inline-flex min-h-12 items-center rounded-full border theme-border-strong px-6 font-mono text-sm"
          >
            browse games
          </Link>
        </div>
      </section>
    </main>
  );
}
