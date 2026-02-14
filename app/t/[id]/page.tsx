import type { Metadata } from "next";
import Link from "next/link";
import { getTransfer } from "@/lib/transfers";
import { SITE_NAME, SITE_BRAND } from "@/lib/config";
import { TransferGallery } from "@/components/transfers/TransferGallery";
import { CountdownTimer } from "@/components/transfers/CountdownTimer";
import { TakedownButton } from "@/components/transfers/TakedownButton";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
};

/** Force dynamic rendering — transfer data lives in Redis, not static files */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const transfer = await getTransfer(id);

  if (!transfer) {
    return { title: `Transfer Not Found — ${SITE_NAME}` };
  }

  const description = `${transfer.files.length} files shared via ${SITE_NAME}`;

  // OG image: from app/t/[id]/opengraph-image.tsx (runtime-generated). To save on
  // runtime cost, delete that file; the card will use the default site image
  // (app/opengraph-image.tsx) with this page's title and description.
  return {
    title: `${transfer.title} — ${SITE_NAME}`,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title: `${transfer.title} — ${SITE_NAME}`,
      description,
      url: `/t/${id}`,
      siteName: SITE_NAME,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${transfer.title} — ${SITE_NAME}`,
      description,
    },
  };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Summarise file counts: "12 photos, 3 videos, 2 files" */
function describeFiles(files: { kind: string }[]): string {
  const counts: Record<string, number> = {};
  for (const f of files) {
    const label =
      f.kind === "image" || f.kind === "gif" ? "photo" :
      f.kind === "video" ? "video" :
      f.kind === "audio" ? "audio" :
      "file";
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([label, n]) => `${n} ${n === 1 ? label : label + "s"}`)
    .join(", ");
}

export default async function TransferPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { token } = await searchParams;
  const transfer = await getTransfer(id);

  /* ─── Not found / expired ─── */
  if (!transfer) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <main id="main" className="text-center max-w-md space-y-6">
          <p className="font-mono text-7xl font-bold text-foreground opacity-10 leading-none">
            gone
          </p>
          <p className="font-serif text-xl text-foreground">
            this transfer has expired
          </p>
          <p className="theme-muted text-sm">
            the link you followed is no longer active. transfers are
            temporary — they self-destruct after their expiry window.
          </p>
          <div className="pt-2">
            <Link
              href="/"
              className="font-mono text-sm theme-muted hover:text-foreground transition-colors"
            >
              ← milkandhenny.com
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const expiresAtMs = new Date(transfer.expiresAt).getTime();
  const remainingSeconds = Math.floor((expiresAtMs - Date.now()) / 1000); // eslint-disable-line react-hooks/purity -- server component runs once per request

  /* ─── Expired (data still in Redis but past expiry) ─── */
  if (remainingSeconds <= 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <main id="main" className="text-center max-w-md space-y-6">
          <p className="font-mono text-7xl font-bold text-foreground opacity-10 leading-none">
            gone
          </p>
          <p className="font-serif text-xl text-foreground">
            this transfer has expired
          </p>
          <p className="theme-muted text-sm">
            &ldquo;{transfer.title}&rdquo; expired on{" "}
            {formatDate(transfer.expiresAt)}. transfers self-destruct
            automatically.
          </p>
          <div className="pt-2">
            <Link
              href="/"
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
            href="/"
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
          <TransferGallery transferId={transfer.id} files={transfer.files} />
        </section>

        {/* Admin takedown */}
        {isAdmin && (
          <section className="max-w-4xl mx-auto px-6 pb-12" aria-label="Admin">
            <div className="border-t theme-border pt-6">
              <p className="font-mono text-[11px] theme-muted tracking-wide mb-3">
                admin controls
              </p>
              <TakedownButton transferId={transfer.id} deleteToken={token} />
            </div>
          </section>
        )}
      </main>

      <footer role="contentinfo" className="border-t theme-border">
        <div className="max-w-4xl mx-auto px-6 py-8 flex items-center justify-between font-mono text-[11px] theme-muted tracking-wide">
          <span>
            temporary transfer · self-destructs{" "}
            {formatDate(transfer.expiresAt)}
          </span>
          <Link href="/" className="hover:text-foreground transition-colors">{SITE_BRAND}</Link>
        </div>
      </footer>
    </div>
  );
}
