import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteFooter, SiteFooterBar } from "@/components/SiteFooter";
import { getSystemCapabilities } from "@/features/system/capabilities.server";
import type { CapabilityStatus } from "@/features/system/capabilities";
import { SITE_BRAND } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

const getCapabilities = createServerFn({ method: "GET" }).handler(() => getSystemCapabilities());

const STATUS_MARK: Record<CapabilityStatus, string> = {
  available: "●",
  degraded: "◐",
  unavailable: "○",
  disabled: "–",
};

function formatHealthTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? timestamp
    : date
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC");
}

export const Route = createFileRoute("/health")({
  component: HealthPage,
  loader: () => getCapabilities(),
  head: () =>
    buildSeoHead({
      title: `System health · ${SITE_BRAND}`,
      description: "Current availability of the capabilities that power Milk & Henny.",
      path: "/health",
      robots: "noindex, nofollow",
    }),
});

function HealthPage() {
  const health = Route.useLoaderData();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="max-w-2xl mx-auto px-6 pt-16 pb-10">
        <Link
          to="/"
          className="font-mono text-sm font-bold tracking-tighter hover:opacity-70 transition-opacity"
        >
          {SITE_BRAND}
        </Link>
        <p className="mt-10 font-mono text-micro uppercase tracking-widest theme-muted">
          system health
        </p>
        <div className="mt-3 flex items-baseline justify-between gap-4 border-b theme-border-strong pb-6">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">capabilities</h1>
          <span className="font-mono text-xs theme-muted">{health.status}</span>
        </div>
      </header>

      <main id="main" className="max-w-2xl mx-auto flex-1 px-6 pb-24">
        <p className="font-serif text-base leading-relaxed theme-muted mb-10 max-w-xl">
          A configuration-level view of the services the application needs. Optional functions can
          be disabled without affecting the core site.
        </p>

        <ul className="border-t theme-border">
          {health.capabilities.map((capability) => (
            <li
              key={capability.id}
              className="grid grid-cols-[1.25rem_1fr] gap-3 py-5 border-b theme-border"
            >
              <span aria-hidden="true" className="font-mono text-sm theme-muted pt-0.5">
                {STATUS_MARK[capability.status]}
              </span>
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="font-mono text-sm font-semibold lowercase">{capability.label}</h2>
                  <span className="font-mono text-micro uppercase tracking-wider theme-muted">
                    {capability.status}
                  </span>
                </div>
                <p className="mt-1.5 font-serif text-sm leading-relaxed theme-muted">
                  {capability.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <dl className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-5 font-mono text-micro theme-muted">
          <div>
            <dt className="uppercase tracking-wider theme-faint">environment</dt>
            <dd className="mt-1">{health.runtime.environment}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wider theme-faint">version</dt>
            <dd className="mt-1">{health.runtime.version}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wider theme-faint">checked</dt>
            <dd className="mt-1">
              <time dateTime={health.timestamp}>{formatHealthTimestamp(health.timestamp)}</time>
            </dd>
          </div>
        </dl>
      </main>
      <SiteFooter>
        <SiteFooterBar
          leading={
            <span className="whitespace-nowrap">
              © {new Date().getFullYear()} {SITE_BRAND}
            </span>
          }
          trailing={
            <nav
              aria-label="Footer"
              className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 md:justify-end"
            >
              <Link to="/privacy" className="hover:text-foreground transition-colors">
                privacy
              </Link>
              <Link to="/contact" className="hover:text-foreground transition-colors">
                contact
              </Link>
              <Link to="/" className="hover:text-foreground transition-colors">
                ← home
              </Link>
            </nav>
          }
        />
      </SiteFooter>
    </div>
  );
}
