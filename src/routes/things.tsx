import { Link, Outlet, createFileRoute, useMatchRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { SITE_BRAND, SITE_NAME } from "@/lib/shared/config";
import { THINGS } from "@/features/things/catalog";
import { isOfflineThingSlug } from "@/features/things/offline";
import type { OfflineThingSlug } from "@/features/things/offline";
import {
  activateSiteUpdate,
  updateThingOffline,
  useSiteUpdateState,
  useThingOfflineState,
} from "@/features/offline/client";
import type { Thing } from "@/features/things/catalog";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";
import { ThingsConcierge } from "@/features/things/shared/ThingsConcierge";

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

  if (mark.value === "maze") {
    return (
      <svg viewBox="0 0 28 28" className="size-7 fill-none stroke-current" strokeWidth="1.6">
        <path
          d="M10.3 3.4A11.2 11.2 0 1 1 9 24M8.1 8.1A7.9 7.9 0 1 1 20.7 17.8M14 10.2a3.8 3.8 0 1 1-3.5 5.3"
          strokeLinecap="round"
        />
        <path d="M14 25.2v-3.3m7.8-7.9h-3.4M14 6.1v4.1" />
        <circle cx="14" cy="14" r="0.9" className="fill-current stroke-none" />
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
  head: () =>
    buildSeoHead({
      title: `Things — ${SITE_NAME}`,
      description: "Small tools, games, and experiments made for people to use together.",
      path: "/things",
      image: OG_IMAGES.things,
      imageAlt: "Things — small tools, games, and experiments from Milk & Henny",
    }),
});

function ThingsRoute() {
  const matchRoute = useMatchRoute();
  const isIndex = matchRoute({ to: "/things", fuzzy: false });
  const siteUpdateState = useSiteUpdateState();
  const [query, setQuery] = useState("");
  const filteredThings = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return THINGS;
    return THINGS.filter((thing) => {
      const searchText = `${thing.name} ${thing.description} ${thing.eyebrow}`.toLowerCase();
      return tokens.every((token) => searchText.includes(token));
    });
  }, [query]);

  if (!isIndex) return <Outlet />;

  return (
    <div className="min-h-screen bg-background">
      <header className="relative max-w-2xl mx-auto px-6 pt-16 pb-10">
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
        <div className="mt-10 grid items-end gap-6 md:grid-cols-[minmax(0,1fr)_9rem]">
          <div className="min-w-0">
            <div className="relative">
              <label htmlFor="things-search" className="sr-only">
                Search things
              </label>
              <input
                id="things-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="what do you feel like playing?"
                autoComplete="off"
                className="w-full bg-transparent py-3 pr-12 font-mono text-sm theme-muted outline-none border-b theme-border placeholder:theme-faint focus:border-[var(--foreground)]"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute inset-y-0 right-0 flex min-h-11 w-11 items-center justify-center font-mono text-lg theme-faint hover:text-foreground"
                >
                  ×
                </button>
              ) : null}
            </div>
            {query ? (
              <p className="mt-1.5 font-mono text-micro theme-faint" aria-live="polite">
                {filteredThings.length === 0
                  ? "no matches"
                  : `${filteredThings.length} thing${filteredThings.length === 1 ? "" : "s"}`}
              </p>
            ) : null}
          </div>
          <ThingsConcierge />
        </div>
        {siteUpdateState === "ready" ||
        siteUpdateState === "activating" ||
        siteUpdateState === "failed" ? (
          <div
            className="mt-6 flex min-h-11 items-center justify-between gap-4 border-y theme-border py-2 font-mono text-micro uppercase tracking-[0.12em] theme-muted"
            aria-live="polite"
          >
            <span>
              {siteUpdateState === "ready"
                ? "new version available"
                : siteUpdateState === "activating"
                  ? "refreshing…"
                  : "could not refresh"}
            </span>
            {siteUpdateState === "ready" || siteUpdateState === "failed" ? (
              <button
                type="button"
                onClick={() => void activateSiteUpdate()}
                className="min-h-11 shrink-0 px-2 underline decoration-dotted underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {siteUpdateState === "failed" ? "try again" : "refresh"}
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      <main id="main" className="max-w-2xl mx-auto px-6 pb-24">
        {filteredThings.length === 0 ? (
          <div className="border-t theme-border-strong py-16 text-center">
            <p className="font-serif text-foreground/80 italic">nothing here feels right yet.</p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-4 font-mono text-xs theme-muted hover:text-foreground"
            >
              show everything
            </button>
          </div>
        ) : (
          <ul className="border-t theme-border-strong">
            {filteredThings.map((thing, index) => (
              <li key={thing.slug} className="border-b theme-border">
                <Link
                  to={thing.href}
                  className="group grid grid-cols-[3rem_1fr_auto] gap-4 items-start py-7 min-h-44 focus-visible:outline-offset-4"
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
                  </span>
                  <span
                    aria-hidden="true"
                    className="font-mono text-lg theme-muted transition-transform duration-300 group-hover:translate-x-1"
                  >
                    →
                  </span>
                </Link>
                <ThingOfflineStatus thing={thing} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function ThingOfflineStatus({ thing }: { thing: Thing }) {
  // Online-only things carry no offline bundle, so there is no state to subscribe to.
  if (!thing.offline || !isOfflineThingSlug(thing.slug)) return null;
  return <OfflineThingStatus name={thing.name} slug={thing.slug} />;
}

function OfflineThingStatus({ name, slug }: { name: string; slug: OfflineThingSlug }) {
  const state = useThingOfflineState(slug);
  const mode = slug === "spelling-bee" ? "say it aloud · " : "";
  const label =
    state === "ready"
      ? `${mode}offline ready`
      : state === "update-available"
        ? `${mode}offline update available`
        : state === "preparing"
          ? `${mode}updating offline…`
          : state === "failed"
            ? `${mode}offline update failed`
            : `${mode}works offline`;
  const dotClass =
    state === "ready"
      ? "text-emerald-600 dark:text-emerald-300"
      : state === "preparing" || state === "update-available" || state === "failed"
        ? "text-amber-600 dark:text-amber-300"
        : "theme-faint";
  const canUpdate = state === "update-available" || state === "failed";

  return (
    <div className="grid grid-cols-[3rem_1fr_auto] gap-4">
      <div className="col-start-2 col-span-2 -mt-2 flex min-h-11 flex-wrap items-center justify-between gap-3 pb-5 font-mono text-micro uppercase tracking-[0.12em] theme-muted">
        <span className="inline-flex min-w-0 items-center gap-2" aria-live="polite">
          <span aria-hidden="true" className={`text-[0.65rem] ${dotClass}`}>
            {state === "ready" ? "●" : state === "preparing" ? "◌" : "○"}
          </span>
          {label}
        </span>
        {canUpdate ? (
          <button
            type="button"
            onClick={() => void updateThingOffline(slug)}
            className="min-h-11 shrink-0 px-2 underline decoration-dotted underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
            aria-label={`${state === "failed" ? "Try again" : "Update"} ${name} for offline use`}
          >
            {state === "failed" ? "try again" : "update"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
