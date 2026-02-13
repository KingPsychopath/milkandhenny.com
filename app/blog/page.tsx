import Link from "next/link";
import type { Metadata } from "next";
import { getBlogPostSummaries } from "@/lib/blog";
import { SearchablePostList } from "@/components/blog/SearchablePostList";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export const metadata: Metadata = {
  title: "Words — Milk & Henny",
  description: "Thoughts, stories, and things worth sharing. Browse and search all posts.",
};

export default function BlogPage() {
  const posts = getBlogPostSummaries();

  return (
    <div className="min-h-screen bg-background">
      <header role="banner" className="max-w-2xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between font-mono text-sm">
          <Link
            href="/"
            className="theme-muted hover:text-foreground transition-colors tracking-tight"
          >
            ← home
          </Link>
          <Link
            href="/"
            className="font-bold text-foreground tracking-tighter hover:opacity-70 transition-opacity"
          >
            milk & henny
          </Link>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6">
        <div className="border-t theme-border" />
      </div>

      <main id="main">
        <section className="max-w-2xl mx-auto px-6 pt-12 pb-8" aria-label="Page header">
        <Breadcrumbs items={[{ label: "home", href: "/" }, { label: "words" }]} />
        <h1 className="font-serif text-3xl sm:text-4xl text-foreground tracking-tight mt-2">
          words
        </h1>
        <p className="mt-2 theme-muted font-mono text-sm">
          thoughts, stories, and things worth sharing. search or scroll.
        </p>
      </section>

        <section className="max-w-2xl mx-auto px-6 pb-24" aria-label="Posts">
          <SearchablePostList posts={posts} />
        </section>
      </main>

      <footer role="contentinfo" className="border-t theme-border">
        <div className="max-w-2xl mx-auto px-6 py-8 flex items-center justify-between font-mono text-[11px] theme-muted tracking-wide">
          <Link href="/" className="hover:text-foreground transition-colors">
            ← home
          </Link>
          <span>© {new Date().getFullYear()} milk & henny</span>
        </div>
      </footer>
    </div>
  );
}
