import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SITE_BRAND } from "@/lib/shared/config";
import { PostListItem } from "@/features/words/components/PostListItem";
import { isWordsEnabled } from "@/features/words/reader.server";
import { listWords } from "@/features/words/store.server";

const RECENT_LIMIT = 5;

const getHomeData = createServerFn({ method: "GET" }).handler(async () => {
  const noteBlogs = isWordsEnabled()
    ? (
        await listWords({
          includeNonPublic: false,
          visibility: "public",
          type: "blog",
          limit: 1000,
        })
      ).words
    : [];

  const allPosts = noteBlogs
    .map((note) => ({
      slug: note.slug,
      title: note.title,
      subtitle: note.subtitle,
      date: note.publishedAt ?? note.updatedAt,
      readingTime: note.readingTime,
      featured: note.featured ?? false,
    }))
    .sort((a, b) => {
      if (!!a.featured !== !!b.featured) return a.featured ? -1 : 1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  const posts = allPosts.slice(0, RECENT_LIMIT);
  const hasMore = allPosts.length > RECENT_LIMIT;

  return { posts, hasMore };
});

export const Route = createFileRoute("/")({
  component: Home,
  loader: () => getHomeData(),
});

function Home() {
  const { posts, hasMore } = Route.useLoaderData();

  return (
    <div className="min-h-screen bg-background">
      {/* Masthead — site banner */}
      <header role="banner" className="max-w-2xl mx-auto px-6 pt-20 pb-16 text-center">
        <Link to="/" className="inline-block">
          <h1 className="font-mono text-[2.5rem] sm:text-6xl font-bold text-foreground tracking-tighter leading-none">
            {SITE_BRAND}
          </h1>
        </Link>
        <p className="mt-5 theme-muted font-mono text-sm tracking-wide">
          thoughts, stories, and things worth sharing
        </p>
        <p className="mt-2 theme-faint font-serif italic text-sm">
          a <span className="highlight-selection">social commentary</span> on social commentary
        </p>
        <nav className="mt-6 flex items-center justify-center gap-6 font-mono text-xs tracking-wide">
          <Link to="/pics" className="theme-muted hover:text-foreground transition-colors">
            [pics]
          </Link>
          <Link to="/words" className="theme-muted hover:text-foreground transition-colors">
            [words]
          </Link>
          <Link
            to="/upload"
            search={{ auth: undefined }}
            className="theme-muted hover:text-foreground transition-colors"
          >
            [upload]
          </Link>
        </nav>
      </header>

      {/* Divider */}
      <div className="max-w-2xl mx-auto px-6">
        <div className="border-t theme-border-strong" />
      </div>

      {/* Recent — primary content */}
      <main id="main" className="max-w-2xl mx-auto px-6 pt-4 pb-24">
        <p className="font-mono text-micro theme-muted tracking-widest uppercase py-4">Recent</p>

        {posts.length === 0 ? (
          <p className="py-12 theme-muted font-mono text-sm text-center">
            quiet for now. new words are on the way.
          </p>
        ) : (
          <div className="space-y-0">
            {posts.map((post) => (
              <PostListItem key={post.slug} {...post} />
            ))}
          </div>
        )}
        {hasMore && (
          <p className="pt-6">
            <Link
              to="/words"
              className="font-mono text-xs theme-muted hover:text-foreground transition-colors"
            >
              all posts →
            </Link>
          </p>
        )}
      </main>

      <footer role="contentinfo" className="border-t theme-border">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-4">
          <div className="flex items-center justify-between font-mono text-micro theme-muted tracking-wide">
            <span>
              © {new Date().getFullYear()} {SITE_BRAND}
            </span>
            <div className="flex items-center gap-4">
              <a href="/feed.xml" className="hover:text-foreground transition-colors">
                rss
              </a>
              <Link to="/words" className="hover:text-foreground transition-colors">
                words
              </Link>
              <Link to="/health" className="hover:text-foreground transition-colors">
                health
              </Link>
              <Link to="/party" className="hover:text-foreground transition-colors">
                the party ↗
              </Link>
            </div>
          </div>
          <div className="flex items-center justify-center gap-5 font-mono text-micro theme-faint tracking-wide">
            <a
              href="https://twitter.com/milkandh3nny"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              twitter
            </a>
            <span>·</span>
            <a
              href="https://instagram.com/milkandhenny"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              instagram
            </a>
            <span>·</span>
            <a
              href="https://tiktok.com/@milkandhenny"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              tiktok
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
