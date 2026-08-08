import { Link, Outlet, createFileRoute, useMatchRoute } from "@tanstack/react-router";
import { SITE_BRAND, SITE_NAME } from "@/lib/shared/config";
import { THINGS } from "@/features/things/catalog";
import { isOfflineThingSlug } from "@/features/things/offline";
import type { OfflineThingSlug } from "@/features/things/offline";
import { useThingOfflineState } from "@/features/offline/client";
import type { Thing } from "@/features/things/catalog";

function ThingMark({ mark }: { mark: Thing["mark"] }) {
  if (mark.kind === "symbol") return mark.value;

  if (mark.value === "brain") {
    return (
      <svg viewBox="0 0 28 28" className="size-7 fill-none stroke-current" strokeWidth="1.6">
        <path
          d="M13.8 6.2c-1.1-2.8-5.3-2.2-5.3.9-2.9-.2-4.4 3.4-2.2 5.3-2.5 2.4-.7 6.3 2.6 6.2.5 3.2 4.8 3.7 5.1.3V7.8m.2-1.6c1.1-2.8 5.3-2.2 5.3.9 2.9-.2 4.4 3.4 2.2 5.3 2.5 2.4.7 6.3-2.6 6.2-.5 3.2-4.8 3.7-5.1.3V7.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8.5 7.1c.2 1.5 1 2.4 2.4 2.7m8.6-2.7c-.2 1.5-1 2.4-2.4 2.7M6.3 12.4c1.4-.1 2.5.5 3.1 1.7m12.3-1.7c-1.4-.1-2.5.5-3.1 1.7m-9.7 4.5c.7-1.1 1.7-1.7 3-1.7m7.2 1.7c-.7-1.1-1.7-1.7-3-1.7"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 28 28" className="size-7 fill-none stroke-current" strokeWidth="1.6">
      <circle cx="10" cy="9" r="3.25" />
      <circle cx="19" cy="10" r="2.75" />
      <path
        d="M3.8 22c.2-4.4 2.6-7 6.2-7s6 2.6 6.2 7m-.8-5.6c1-.8 2.2-1.2 3.6-1.2 3.2 0 5.2 2.3 5.4 6"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
          Things are made to be used. Small tools, games and experiments.
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
                  <ThingMark mark={thing.mark} />
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
  // Online-only things carry no offline bundle, so there is no state to subscribe to.
  if (!thing.offline || !isOfflineThingSlug(thing.slug)) return null;
  return <OfflineThingStatus slug={thing.slug} />;
}

function OfflineThingStatus({ slug }: { slug: OfflineThingSlug }) {
  const state = useThingOfflineState(slug);
  const mode = slug === "spelling-bee" ? "say it aloud · " : "";
  const label =
    state === "ready"
      ? `${mode}offline ready`
      : state === "preparing"
        ? `${mode}preparing offline…`
        : `${mode}works offline`;
  const dotClass =
    state === "ready"
      ? "text-emerald-600 dark:text-emerald-300"
      : state === "preparing"
        ? "text-amber-600 dark:text-amber-300"
        : "theme-faint";

  return (
    <span
      className="mt-4 inline-flex min-h-6 items-center gap-2 font-mono text-micro uppercase tracking-[0.12em] theme-muted"
      aria-live="polite"
    >
      <span aria-hidden="true" className={`text-[0.65rem] ${dotClass}`}>
        {state === "ready" ? "●" : state === "preparing" ? "◌" : "○"}
      </span>
      {label}
    </span>
  );
}
