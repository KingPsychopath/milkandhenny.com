import { Link, Outlet, createFileRoute, useMatchRoute } from "@tanstack/react-router";
import { SITE_BRAND, SITE_NAME } from "@/lib/shared/config";
import { THINGS } from "@/features/things/catalog";
import { useThingOfflineState } from "@/features/offline/client";
import type { Thing } from "@/features/things/catalog";

export const Route = createFileRoute("/things")({
  component: ThingsRoute,
  head: () => ({
    meta: [
      { title: `Things — ${SITE_NAME}` },
      {
        name: "description",
        content: "Small, useful tools and games made for people to use together.",
      },
    ],
  }),
});

function ThingsRoute() {
  const matchRoute = useMatchRoute();
  const isIndex = matchRoute({ to: "/things", fuzzy: false });

  if (!isIndex) return <Outlet />;

  return (
    <div className="min-h-screen bg-background">
      <header className="max-w-2xl mx-auto px-6 pt-16 pb-10">
        <nav aria-label="Breadcrumb" className="font-mono text-xs theme-muted">
          <Link to="/" className="hover:text-foreground transition-colors">
            {SITE_BRAND}
          </Link>
          <span aria-hidden="true"> / </span>
          <span aria-current="page">things</span>
        </nav>
        <p className="mt-14 font-mono text-micro uppercase tracking-[0.22em] theme-muted">
          the useful drawer
        </p>
        <h1 className="mt-3 font-serif text-5xl sm:text-6xl font-medium tracking-tight text-foreground">
          things<span className="theme-faint">+</span>
        </h1>
        <p className="mt-5 max-w-lg font-serif text-lg leading-relaxed theme-muted">
          Small tools, games, and experiments. Made to be opened, used, and passed around.
        </p>
      </header>

      <main id="main" className="max-w-2xl mx-auto px-6 pb-24">
        <ul className="border-t theme-border-strong">
          {THINGS.map((thing, index) => (
            <li key={thing.slug}>
              <Link
                to={thing.href}
                className="group grid grid-cols-[3rem_1fr_auto] gap-4 items-start py-7 border-b theme-border min-h-44 focus-visible:outline-offset-4"
              >
                <span
                  aria-hidden="true"
                  className="font-mono text-2xl theme-faint group-hover:text-foreground transition-colors"
                >
                  {thing.symbol}
                </span>
                <span>
                  <span className="block font-mono text-micro uppercase tracking-[0.16em] theme-muted">
                    {String(index + 1).padStart(2, "0")} · {thing.eyebrow}
                  </span>
                  <span className="block mt-3 font-serif text-3xl text-foreground">
                    {thing.name}
                  </span>
                  <span className="block mt-2 max-w-md text-sm leading-relaxed theme-muted">
                    {thing.description}
                  </span>
                  <ThingOfflineStatus thing={thing} />
                </span>
                <span
                  aria-hidden="true"
                  className="font-mono text-lg theme-muted transition-transform duration-300 group-hover:translate-x-1"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

function ThingOfflineStatus({ thing }: { thing: Thing }) {
  const state = useThingOfflineState(thing.slug);
  if (!thing.offline) return null;

  const mode = thing.slug === "spelling-bee" ? "say it aloud · " : "";
  const label =
    state === "ready"
      ? `${mode}offline ready`
      : state === "preparing"
        ? `${mode}preparing offline…`
        : `${mode}works offline`;
  const dotClass = state === "ready" ? "text-emerald-600 dark:text-emerald-300" : state === "preparing" ? "text-amber-600 dark:text-amber-300" : "theme-faint";

  return (
    <span
      className="mt-4 inline-flex min-h-6 items-center gap-2 font-mono text-micro uppercase tracking-[0.12em] theme-muted"
      aria-live="polite"
    >
      <span aria-hidden="true" className={`text-[0.65rem] ${dotClass}`}>{state === "ready" ? "●" : state === "preparing" ? "◌" : "○"}</span>
      {label}
    </span>
  );
}
