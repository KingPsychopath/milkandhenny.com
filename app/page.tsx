import Link from "next/link";
import { getAllPosts } from "@/lib/blog";

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
  const posts = getAllPosts();

  return (
    <div className="min-h-screen bg-background">
      {/* Masthead */}
      <header className="max-w-2xl mx-auto px-6 pt-20 pb-16 text-center">
        <Link href="/" className="inline-block">
          <h1 className="font-mono text-[2.5rem] sm:text-6xl font-bold text-foreground tracking-tighter leading-none">
            milk & henny
          </h1>
        </Link>
        <p className="mt-5 text-stone-400 font-mono text-sm tracking-wide">
          thoughts, stories, and things worth sharing
        </p>
        <nav className="mt-6 flex items-center justify-center gap-6 font-mono text-xs tracking-wide">
          <Link
            href="/party"
            className="text-stone-400 hover:text-foreground transition-colors"
          >
            [the party]
          </Link>
        </nav>
      </header>

      {/* Divider */}
      <div className="max-w-2xl mx-auto px-6">
        <div className="border-t border-stone-300" />
      </div>

      {/* Recent */}
      <section className="max-w-2xl mx-auto px-6 pt-4 pb-24">
        <p className="font-mono text-[11px] text-stone-400 tracking-widest uppercase py-4">
          Recent
        </p>

        {posts.length === 0 ? (
          <p className="py-12 text-stone-400 font-mono text-sm text-center">
            nothing here yet. check back soon.
          </p>
        ) : (
          <div className="space-y-0">
            {posts.map((post) => (
              <article key={post.slug} className="group">
                <Link
                  href={`/blog/${post.slug}`}
                  className="block py-6 border-b border-stone-100 hover:border-stone-300 transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 className="font-serif text-xl sm:text-2xl text-foreground group-hover:text-stone-500 transition-colors leading-snug">
                      {post.title}
                    </h2>
                    <time className="font-mono text-xs text-stone-400 shrink-0 tabular-nums">
                      {formatDate(post.date)}
                    </time>
                  </div>
                  {post.subtitle && (
                    <p className="mt-2 text-stone-500 text-[0.95rem] leading-relaxed">
                      {post.subtitle}
                    </p>
                  )}
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-200">
        <div className="max-w-2xl mx-auto px-6 py-8 flex items-center justify-between font-mono text-[11px] text-stone-400 tracking-wide">
          <span>© {new Date().getFullYear()} milk & henny</span>
          <Link
            href="/party"
            className="hover:text-foreground transition-colors"
          >
            the party ↗
          </Link>
        </div>
      </footer>
    </div>
  );
}
