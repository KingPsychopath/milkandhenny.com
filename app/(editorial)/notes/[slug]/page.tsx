import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_BRAND, SITE_NAME } from "@/lib/shared/config";
import { PostBody } from "@/app/(editorial)/blog/[slug]/PostBody";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { getNote } from "@/features/notes/store";
import { canReadNoteInServerContext, isNotesEnabled } from "@/features/notes/reader";
import { UnlockNoteClient } from "./UnlockNoteClient";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ share?: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!isNotesEnabled()) {
    return {
      title: `Notes disabled — ${SITE_NAME}`,
      robots: { index: false, follow: false },
    };
  }

  const note = await getNote(slug);
  if (!note) return {};
  const isPublic = note.meta.visibility === "public";

  return {
    title: `${note.meta.title} — ${SITE_NAME}`,
    description: note.meta.subtitle ?? `Read "${note.meta.title}"`,
    robots: isPublic ? { index: true, follow: true } : { index: false, follow: false },
  };
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function NotePage({ params, searchParams }: Props) {
  if (!isNotesEnabled()) notFound();

  const { slug } = await params;
  const { share } = await searchParams;
  const note = await getNote(slug);
  if (!note) notFound();

  const canRead = await canReadNoteInServerContext(note.meta);

  return (
    <div className="min-h-screen bg-background">
      <header role="banner" className="max-w-2xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between font-mono text-sm">
          <Link href="/notes" className="theme-muted hover:text-foreground transition-colors tracking-tight">
            ← notes
          </Link>
          <Link href="/" className="font-bold text-foreground tracking-tighter hover:opacity-70 transition-opacity">
            {SITE_BRAND}
          </Link>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6">
        <div className="border-t theme-border" />
      </div>

      <main id="main" className="max-w-2xl mx-auto px-6 pt-12 pb-24">
        <Breadcrumbs
          items={[
            { label: "home", href: "/" },
            { label: "notes", href: "/notes" },
            { label: note.meta.title },
          ]}
        />

        <header className="mb-10 mt-2">
          <div className="flex flex-wrap items-center gap-3 font-mono text-xs theme-muted tracking-wide">
            <time dateTime={note.meta.updatedAt}>{formatDate(note.meta.updatedAt)}</time>
            <span>·</span>
            <span>{note.meta.visibility}</span>
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground leading-tight tracking-tight mt-4">
            {note.meta.title}
          </h1>
          {note.meta.subtitle ? (
            <p className="mt-4 font-serif theme-subtle text-lg leading-relaxed">
              {note.meta.subtitle}
            </p>
          ) : null}
        </header>

        {canRead ? (
          <PostBody content={note.markdown} albums={{}} />
        ) : (
          <UnlockNoteClient slug={slug} shareToken={share ?? ""} />
        )}
      </main>
    </div>
  );
}
