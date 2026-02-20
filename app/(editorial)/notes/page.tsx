import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SITE_BRAND, SITE_NAME } from "@/lib/shared/config";
import { hasAdminAccessInServerContext, isNotesEnabled } from "@/features/notes/reader";
import { listNotes } from "@/features/notes/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Notes — ${SITE_NAME}`,
  description: "Private and public markdown notes.",
};

export default async function NotesPage() {
  if (!isNotesEnabled()) notFound();

  const isAdmin = await hasAdminAccessInServerContext();
  const { notes } = await listNotes({
    includeNonPublic: isAdmin,
    limit: 200,
  });

  return (
    <div className="min-h-screen bg-background">
      <header role="banner" className="max-w-2xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between font-mono text-sm">
          <Link href="/" className="theme-muted hover:text-foreground transition-colors tracking-tight">
            ← home
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
        <Breadcrumbs items={[{ label: "home", href: "/" }, { label: "notes" }]} />
        <h1 className="font-serif text-3xl sm:text-4xl text-foreground tracking-tight mt-2">notes</h1>
        <p className="mt-2 theme-muted font-mono text-sm">
          {isAdmin ? "all notes (admin view)." : "public notes."}
        </p>

        <section className="mt-10 divide-y theme-border border-y">
          {notes.length === 0 ? (
            <p className="py-10 font-mono text-sm theme-muted text-center">nothing here yet.</p>
          ) : (
            notes.map((note) => (
              <article key={note.slug} className="py-5">
                <Link href={`/notes/${note.slug}`} className="group block">
                  <h2 className="font-serif text-xl tracking-tight group-hover:opacity-80 transition-opacity">
                    {note.title}
                  </h2>
                  {note.subtitle ? (
                    <p className="mt-2 font-serif theme-subtle text-base">{note.subtitle}</p>
                  ) : null}
                  <p className="mt-3 font-mono text-micro theme-muted tracking-wide">
                    {new Date(note.updatedAt).toLocaleDateString("en-GB")} · {note.visibility}
                  </p>
                </Link>
              </article>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
