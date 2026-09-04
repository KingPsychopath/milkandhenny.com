import { Link, createFileRoute } from "@tanstack/react-router";
import { SiteFooter, SiteFooterBar } from "@/components/SiteFooter";
import {
  describeTransferFiles,
  inferTransferTitle,
  totalTransferBytes,
} from "@/features/transfers/presentation";
import { getTransferPageFn } from "@/features/transfers/transfer.functions";
import { SITE_NAME, SITE_BRAND } from "@/lib/shared/config";
import { formatBytes } from "@/lib/shared/format";
import { buildSeoHead } from "@/lib/shared/seo";
import { TransferGallery } from "@/features/transfers/ui/transfer/TransferGallery";
import { CountdownTimer } from "@/features/transfers/ui/transfer/CountdownTimer";
import { TakedownButton } from "@/features/transfers/ui/transfer/TakedownButton";

export const Route = createFileRoute("/t/$id")({
  component: TransferPage,
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    typeof search.token === "string" ? { token: search.token } : {},
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: {
    handler: ({ params, deps }) =>
      getTransferPageFn({ data: { id: params.id, token: deps.token } }),
    staleReloadMode: "blocking",
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
  head: ({ loaderData }) => {
    const transfer = loaderData?.transfer;
    if (!transfer) {
      return buildSeoHead({
        title: `Transfer not found — ${SITE_NAME}`,
        description: "This private transfer has expired or does not exist.",
        path: "/t/not-found",
        robots: "noindex, nofollow",
        referrer: "no-referrer",
      });
    }
    const displayTitle = inferTransferTitle(transfer.title, transfer.files);
    const contents = describeTransferFiles(transfer.files);
    const totalSize = formatBytes(totalTransferBytes(transfer.files));
    const description = `${contents} · ${totalSize} · available until ${formatDate(transfer.expiresAt)}. Shared privately via ${SITE_NAME}.`;
    return buildSeoHead({
      title: `${displayTitle} — ${SITE_NAME}`,
      description,
      path: `/t/${transfer.id}`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
      imageAlt: `Private transfer shared via ${SITE_NAME}`,
    });
  },
});

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

function TransferPage() {
  const { transfer, remainingSeconds, managementMode } = Route.useLoaderData();
  const { token } = Route.useSearch();

  /* ─── Not found / expired ─── */
  if (!transfer) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <main id="main" className="text-center max-w-md space-y-6">
          <p className="font-mono text-7xl font-bold text-foreground opacity-10 leading-none">
            gone
          </p>
          <p className="font-serif text-xl text-foreground">this transfer has expired</p>
          <p className="theme-muted text-sm">
            the link you followed is no longer active. transfers are temporary — they self-destruct
            after their expiry window.
          </p>
          <div className="pt-2">
            <Link
              to="/"
              className="font-mono text-sm theme-muted hover:text-foreground transition-colors"
            >
              ← milkandhenny.com
            </Link>
          </div>
        </main>
      </div>
    );
  }

  /* ─── Expired (data still in Redis but past expiry) ─── */
  if (remainingSeconds <= 0) {
    const displayTitle = inferTransferTitle(transfer.title, transfer.files);
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <main id="main" className="text-center max-w-md space-y-6">
          <p className="font-mono text-7xl font-bold text-foreground opacity-10 leading-none">
            gone
          </p>
          <p className="font-serif text-xl text-foreground">this transfer has expired</p>
          <p className="theme-muted text-sm">
            &ldquo;{displayTitle}&rdquo; expired on {formatDate(transfer.expiresAt)}. transfers
            self-destruct automatically.
          </p>
          <div className="pt-2">
            <Link
              to="/"
              className="font-mono text-sm theme-muted hover:text-foreground transition-colors"
            >
              ← milkandhenny.com
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const displayTitle = inferTransferTitle(transfer.title, transfer.files);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="w-full max-w-4xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between gap-3 font-mono text-sm">
          <span className="theme-muted tracking-tight">shared via</span>
          <Link
            to="/"
            className="font-bold text-foreground tracking-tighter hover:opacity-70 transition-opacity"
          >
            {SITE_BRAND}
          </Link>
        </div>
      </header>

      <div className="w-full max-w-4xl mx-auto px-6">
        <div className="border-t theme-border" />
      </div>

      <main id="main" className="flex-1">
        <section className="max-w-4xl mx-auto px-6 pt-12 pb-8" aria-label="Transfer info">
          <div className="flex items-center gap-3 font-mono text-xs theme-muted tracking-wide">
            <time>{formatDate(transfer.createdAt)}</time>
            <span className="theme-faint">·</span>
            <CountdownTimer expiresAt={transfer.expiresAt} />
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground leading-tight tracking-tight mt-3">
            {displayTitle}
          </h1>
          <p className="mt-2 theme-subtle text-sm font-mono tracking-wide">
            {describeTransferFiles(transfer.files)}
          </p>
        </section>

        <section className="max-w-4xl mx-auto px-6 pb-12" aria-label="Gallery">
          {managementMode ? (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-y theme-border py-3 font-mono text-xs">
              <span className="theme-muted">
                {managementMode === "admin" ? "admin controls" : "owner controls"} · remove files
                from their cards or previews
              </span>
              <Link
                to="/upload"
                search={{
                  transfer: transfer.id,
                  token: managementMode === "owner" ? token : undefined,
                }}
                className="inline-flex min-h-11 items-center text-amber-600 underline underline-offset-4 transition-colors hover:text-amber-500"
              >
                add files
              </Link>
            </div>
          ) : null}
          <TransferGallery
            transferId={transfer.id}
            files={transfer.files}
            groups={transfer.groups}
            canManage={Boolean(managementMode)}
            deleteToken={managementMode === "owner" ? token : undefined}
          />
        </section>

        {managementMode === "owner" || managementMode === "account" ? (
          <section className="max-w-4xl mx-auto px-6 pb-12" aria-label="Owner controls">
            <div className="border-t theme-border pt-6">
              <p className="font-mono text-micro theme-muted tracking-wide mb-3">owner controls</p>
              <TakedownButton
                transferId={transfer.id}
                deleteToken={managementMode === "owner" ? token : undefined}
              />
            </div>
          </section>
        ) : null}
      </main>

      <SiteFooter maxWidth="4xl">
        <SiteFooterBar
          leading={
            <span>temporary transfer · self-destructs {formatDate(transfer.expiresAt)}</span>
          }
          trailing={
            <Link to="/" className="hover:text-foreground transition-colors">
              {SITE_BRAND}
            </Link>
          }
        />
      </SiteFooter>
    </div>
  );
}
