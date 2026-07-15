import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getTransfer } from "@/features/transfers/store.server";
import { SITE_NAME, SITE_BRAND } from "@/lib/shared/config";
import { TransferGallery } from "@/features/transfers/ui/transfer/TransferGallery";
import { CountdownTimer } from "@/features/transfers/ui/transfer/CountdownTimer";
import { TakedownButton } from "@/features/transfers/ui/transfer/TakedownButton";

const getTransferPage = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const transfer = await getTransfer(data.id);
    const remainingSeconds = transfer
      ? Math.floor((new Date(transfer.expiresAt).getTime() - Date.now()) / 1000)
      : 0;
    return { transfer, remainingSeconds };
  });

export const Route = createFileRoute("/t/$id")({
  component: TransferPage,
  loader: ({ params }) => getTransferPage({ data: params }),
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  head: ({ loaderData }) => {
    const transfer = loaderData?.transfer;
    if (!transfer) return { meta: [{ title: `Transfer Not Found — ${SITE_NAME}` }] };
    const description = `${transfer.files.length} files shared via ${SITE_NAME}`;
    return {
      meta: [
        { title: `${transfer.title} — ${SITE_NAME}` },
        { name: "description", content: description },
        { name: "robots", content: "noindex, nofollow" },
        { property: "og:title", content: `${transfer.title} — ${SITE_NAME}` },
        { property: "og:description", content: description },
      ],
    };
  },
});

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const RAW_IMAGE_EXTENSIONS = /\.(dng|arw|cr2|cr3|nef|orf|raf|rw2|raw)$/i;

/** Summarise file counts: "12 photos, 3 videos, 2 files" */
function describeFiles(files: { kind: string; filename?: string }[]): string {
  const counts: Record<string, number> = {};
  for (const f of files) {
    const label =
      f.kind === "image" || f.kind === "gif" || RAW_IMAGE_EXTENSIONS.test(f.filename ?? "")
        ? "photo"
        : f.kind === "video"
          ? "video"
          : f.kind === "audio"
            ? "audio"
            : "file";
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([label, n]) => `${n} ${n === 1 ? label : label + "s"}`)
    .join(", ");
}

function TransferPage() {
  const { transfer, remainingSeconds } = Route.useLoaderData();
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
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <main id="main" className="text-center max-w-md space-y-6">
          <p className="font-mono text-7xl font-bold text-foreground opacity-10 leading-none">
            gone
          </p>
          <p className="font-serif text-xl text-foreground">this transfer has expired</p>
          <p className="theme-muted text-sm">
            &ldquo;{transfer.title}&rdquo; expired on {formatDate(transfer.expiresAt)}. transfers
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

  const isAdmin = !!token && token === transfer.deleteToken;

  return (
    <div className="min-h-screen bg-background">
      <header role="banner" className="max-w-4xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between font-mono text-sm">
          <span className="theme-muted tracking-tight">shared via</span>
          <Link
            to="/"
            className="font-bold text-foreground tracking-tighter hover:opacity-70 transition-opacity"
          >
            {SITE_BRAND}
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6">
        <div className="border-t theme-border" />
      </div>

      <main id="main">
        <section className="max-w-4xl mx-auto px-6 pt-12 pb-8" aria-label="Transfer info">
          <div className="flex items-center gap-3 font-mono text-xs theme-muted tracking-wide">
            <time>{formatDate(transfer.createdAt)}</time>
            <span className="theme-faint">·</span>
            <CountdownTimer expiresAt={transfer.expiresAt} />
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground leading-tight tracking-tight mt-3">
            {transfer.title}
          </h1>
          <p className="mt-2 theme-subtle text-sm font-mono tracking-wide">
            {describeFiles(transfer.files)}
          </p>
        </section>

        <section className="max-w-4xl mx-auto px-6 pb-12" aria-label="Gallery">
          <TransferGallery
            transferId={transfer.id}
            files={transfer.files}
            groups={transfer.groups}
            deleteToken={isAdmin ? token : undefined}
          />
        </section>

        {/* Admin takedown */}
        {isAdmin && (
          <section className="max-w-4xl mx-auto px-6 pb-12" aria-label="Admin">
            <div className="border-t theme-border pt-6">
              <p className="font-mono text-micro theme-muted tracking-wide mb-3">admin controls</p>
              <TakedownButton transferId={transfer.id} deleteToken={token} />
            </div>
          </section>
        )}
      </main>

      <footer role="contentinfo" className="border-t theme-border">
        <div className="max-w-4xl mx-auto px-6 py-8 flex items-center justify-between font-mono text-micro theme-muted tracking-wide">
          <span>temporary transfer · self-destructs {formatDate(transfer.expiresAt)}</span>
          <Link to="/" className="hover:text-foreground transition-colors">
            {SITE_BRAND}
          </Link>
        </div>
      </footer>
    </div>
  );
}
