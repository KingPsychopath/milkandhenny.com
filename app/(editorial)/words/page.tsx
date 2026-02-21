import Link from "next/link";
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SITE_BRAND, SITE_NAME } from "@/lib/shared/config";
import { isNotesEnabled } from "@/features/notes/reader";
import { listNotes } from "@/features/notes/store";
import type { WordType } from "@/features/words/types";
import { SearchableWordList, type WordListSummary } from "./_components/SearchableWordList";

export const metadata: Metadata = {
  title: `Words — ${SITE_NAME}`,
  description: "Posts, recipes, and notes in one searchable place.",
};

type Props = Record<string, never>;

function formatDate(isoOrDate: string): string {
  const withTime = /^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)
    ? `${isoOrDate}T00:00:00`
    : isoOrDate;
  const date = new Date(withTime);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function WordsPage(_props: Props) {
  const noteItems = isNotesEnabled()
    ? (await listNotes({ includeNonPublic: false, limit: 1000 })).notes
    : [];

  const allItems: WordListSummary[] = noteItems.map((note) => ({
    slug: note.slug,
    title: note.title,
    subtitle: note.subtitle,
    type: note.type as WordType,
    tags: note.tags,
    dateLabel: formatDate(note.publishedAt ?? note.updatedAt),
    date: note.publishedAt ?? note.updatedAt,
    readingTime: 1,
    featured: note.featured,
    searchText: `${note.slug} ${note.title} ${note.subtitle ?? ""} ${note.type} ${note.tags.join(" ")} ${note.featured ? "featured" : ""}`,
  }));
  allItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

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

      <main id="main">
        <section className="max-w-2xl mx-auto px-6 pt-12 pb-8">
          <Breadcrumbs items={[{ label: "home", href: "/" }, { label: "words" }]} />
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground tracking-tight mt-2">words</h1>
          <p className="mt-2 theme-muted font-mono text-sm">
            thoughts, stories, and things worth sharing. search or scroll.
          </p>
        </section>

        <section className="max-w-2xl mx-auto px-6 pb-24">
          <SearchableWordList items={allItems} />
        </section>
      </main>
    </div>
  );
}
