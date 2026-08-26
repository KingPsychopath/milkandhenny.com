import { Link, createFileRoute } from "@tanstack/react-router";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SiteFooter, SiteFooterBar } from "@/components/SiteFooter";
import { SITE_BRAND, SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";
import { SearchableWordList } from "@/features/words/components/ui/SearchableWordList";
import { getWordsPageFn } from "@/features/words/reader.functions";

export const Route = createFileRoute("/words/")({
  component: WordsPage,
  loader: () => getWordsPageFn(),
  head: () =>
    buildSeoHead({
      title: `Words — ${SITE_NAME}`,
      description: "Essays, recipes, reviews, and notes from Milk & Henny.",
      path: "/words",
      image: OG_IMAGES.words,
      imageAlt: "Words — essays, recipes, reviews, and notes from Milk & Henny",
    }),
});

function WordsPage() {
  const allItems = Route.useLoaderData();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="max-w-2xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-center font-mono text-sm">
          <Link
            to="/"
            className="font-bold text-foreground tracking-tighter hover:opacity-70 transition-opacity"
          >
            {SITE_BRAND}
          </Link>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6">
        <div className="border-t theme-border" />
      </div>

      <main id="main" className="flex-1">
        <section className="max-w-2xl mx-auto px-6 pt-12 pb-8">
          <Breadcrumbs items={[{ label: "home", href: "/" }, { label: "words" }]} />
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground tracking-tight mt-2">
            words
          </h1>
          <p className="mt-2 theme-muted font-mono text-sm">
            thoughts, stories, and things worth sharing. search or scroll.
          </p>
        </section>

        <section className="max-w-2xl mx-auto px-6 pb-24">
          <SearchableWordList items={allItems} />
        </section>
      </main>

      <SiteFooter>
        <SiteFooterBar
          leading={
            <Link to="/" className="hover:text-foreground transition-colors">
              ← home
            </Link>
          }
          trailing={
            <nav
              aria-label="Footer"
              className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 md:justify-end"
            >
              <Link to="/subscribe" className="hover:text-foreground transition-colors">
                stay close
              </Link>
              <Link to="/privacy" className="hover:text-foreground transition-colors">
                privacy
              </Link>
              <Link to="/contact" className="hover:text-foreground transition-colors">
                contact
              </Link>
            </nav>
          }
        />
      </SiteFooter>
    </div>
  );
}
