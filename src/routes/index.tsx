import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteFooter, SiteFooterBar } from "@/components/SiteFooter";
import { SITE_BRAND, SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";
import { PostListItem } from "@/features/words/components/PostListItem";
import { isWordsEnabled } from "@/features/words/reader.server";
import { listWords } from "@/features/words/store.server";
import { getFooterPartyPath } from "@/features/site/site-settings.server";

const RECENT_LIMIT = 5;

const getHomeData = createServerFn({ method: "GET" }).handler(async () => {
  const [noteBlogs, footerPartyPath] = await Promise.all([
    isWordsEnabled()
      ? listWords({
          includeNonPublic: false,
          visibility: "public",
          type: "blog",
          limit: 1000,
        }).then((result) => result.words)
      : Promise.resolve([]),
    getFooterPartyPath(),
  ]);

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

  return { posts, hasMore, footerPartyPath };
});

export const Route = createFileRoute("/")({
  component: Home,
  loader: () => getHomeData(),
  head: () =>
    buildSeoHead({
      title: SITE_NAME,
      description: "Thoughts, stories, and things worth sharing from Milk & Henny.",
      path: "/",
      image: OG_IMAGES.default,
      imageAlt: "Milk & Henny — thoughts, stories, and things worth sharing",
    }),
});

function Home() {
  const { posts, hasMore, footerPartyPath } = Route.useLoaderData();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* Masthead — site banner */}
      <header className="max-w-2xl mx-auto px-6 pt-20 pb-16 text-center">
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
        <nav className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-xs tracking-wide">
          <Link to="/pics" className="theme-muted hover:text-foreground transition-colors">
            [pics]
          </Link>
          <Link to="/words" className="theme-muted hover:text-foreground transition-colors">
            [words]
          </Link>
          <Link to="/things" className="theme-muted hover:text-foreground transition-colors">
            [things] +
          </Link>
          <Link to="/events" className="theme-muted hover:text-foreground transition-colors">
            [events]
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
      <main id="main" className="max-w-2xl mx-auto flex-1 px-6 pt-4 pb-24">
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

      <SiteFooter>
        <SiteFooterBar
          leading={
            <span className="whitespace-nowrap">
              © {new Date().getFullYear()} {SITE_BRAND}
            </span>
          }
          trailing={
            <nav
              aria-label="Footer"
              className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 md:justify-end"
            >
              <Link to="/subscribe" className="hover:text-foreground transition-colors">
                stay close
              </Link>
              <Link to="/health" className="hover:text-foreground transition-colors">
                health
              </Link>
              <Link to="/privacy" className="hover:text-foreground transition-colors">
                privacy
              </Link>
              <Link to="/contact" className="hover:text-foreground transition-colors">
                contact
              </Link>
              <a href={footerPartyPath} className="hover:text-foreground transition-colors">
                the party ↗
              </a>
            </nav>
          }
        />
        <nav
          aria-label="Social links"
          className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-micro tracking-wide theme-faint"
        >
          <a
            href="https://twitter.com/milkandh3nny"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            twitter
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="https://instagram.com/milkandhenny"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            instagram
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="https://tiktok.com/@milkandhenny"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            tiktok
          </a>
        </nav>
      </SiteFooter>
    </div>
  );
}
