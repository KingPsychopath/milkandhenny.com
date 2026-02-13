import Link from "next/link";
import { getRecentPosts, getAllPosts } from "@/lib/blog";

const RECENT_LIMIT = 5;

/** Format a date string into a readable form like "7 Feb 2026" */
function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function Home() {
  const posts = getRecentPosts(RECENT_LIMIT);
  const hasMore = getAllPosts().length > RECENT_LIMIT;

  return (
    <div className="min-h-screen bg-background">
      {/* Masthead — site banner */}
      <header role="banner" className="max-w-2xl mx-auto px-6 pt-20 pb-16 text-center">
        <Link href="/" className="inline-block">
          <h1 className="font-mono text-[2.5rem] sm:text-6xl font-bold text-foreground tracking-tighter leading-none">
            milk & henny
          </h1>
        </Link>
        <p className="mt-5 theme-muted font-mono text-sm tracking-wide">
          thoughts, stories, and things worth sharing
        </p>
        <p className="mt-2 theme-faint font-serif italic text-sm">
          a <span className="highlight-selection">social commentary</span> on social commentary
        </p>
        <nav className="mt-6 flex items-center justify-center gap-6 font-mono text-xs tracking-wide">
          <Link
            href="/pics"
            className="theme-muted hover:text-foreground transition-colors"
          >
            [pics]
          </Link>
          <Link
            href="/blog"
            className="theme-muted hover:text-foreground transition-colors"
          >
            [words]
          </Link>
          <Link
            href="/party"
            className="theme-muted hover:text-foreground transition-colors"
          >
            [the party]
          </Link>
        </nav>
      </header>

      {/* Divider */}
      <div className="max-w-2xl mx-auto px-6">
        <div className="border-t theme-border-strong" />
      </div>

      {/* Recent — primary content */}
      <main id="main" className="max-w-2xl mx-auto px-6 pt-4 pb-24">
        <p className="font-mono text-[11px] theme-muted tracking-widest uppercase py-4">
          Recent
        </p>

        {posts.length === 0 ? (
          <p className="py-12 theme-muted font-mono text-sm text-center">
            nothing here yet. check back soon.
          </p>
        ) : (
          <div className="space-y-0">
            {posts.map((post) => (
              <article key={post.slug} className="group">
                <Link
                  href={`/blog/${post.slug}`}
                  className="block py-6 border-b theme-border-faint hover:theme-border-strong transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 sm:gap-4">
                    <h2 className="font-serif text-xl sm:text-2xl text-foreground group-hover:opacity-70 transition-opacity leading-snug flex items-center gap-2">
                      {post.featured && (
                        <span
                          className="text-[0.6em] text-[var(--prose-hashtag)] opacity-80"
                          aria-label="Featured"
                        >
                          ●
                        </span>
                      )}
                      {post.title}
                    </h2>
                    <span className="font-mono text-xs theme-muted shrink-0 tabular-nums whitespace-nowrap">
                      {post.readingTime} min · {formatDate(post.date)}
                    </span>
                  </div>
                  {post.subtitle && (
                    <p className="mt-2 theme-subtle text-[0.95rem] leading-relaxed">
                      {post.subtitle}
                    </p>
                  )}
                </Link>
              </article>
            )            )}
          </div>
        )}
        {hasMore && (
          <p className="pt-6">
            <Link
              href="/blog"
              className="font-mono text-xs theme-muted hover:text-foreground transition-colors"
            >
              all posts →
            </Link>
          </p>
        )}
      </main>

      <footer role="contentinfo" className="border-t theme-border">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-4">
          <div className="flex items-center justify-between font-mono text-[11px] theme-muted tracking-wide">
            <span>© {new Date().getFullYear()} milk & henny</span>
            <div className="flex items-center gap-4">
              <Link
                href="/feed.xml"
                className="hover:text-foreground transition-colors"
              >
                rss
              </Link>
              <Link
                href="/blog"
                className="hover:text-foreground transition-colors"
              >
                words
              </Link>
              <Link
                href="/party"
                className="hover:text-foreground transition-colors"
              >
                the party ↗
              </Link>
            </div>
          </div>
          <div className="flex items-center justify-center gap-5 font-mono text-[11px] theme-faint tracking-wide">
            <a href="https://twitter.com/milkandh3nny" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">twitter</a>
            <span>·</span>
            <a href="https://instagram.com/milkandhenny" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">instagram</a>
            <span>·</span>
            <a href="https://tiktok.com/@milkandhenny" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">tiktok</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
