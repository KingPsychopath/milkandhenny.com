import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getPostBySlug, getAllSlugs } from "@/lib/blog";
import { getAlbumBySlug } from "@/lib/albums";
import { PostBody } from "./PostBody";
import { ReadingProgress } from "@/components/ReadingProgress";
import type { EmbeddedAlbum } from "@/components/blog/AlbumEmbed";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};

  const description =
    post.subtitle ?? `Read "${post.title}" on Milk & Henny`;

  return {
    title: `${post.title} — Milk & Henny`,
    description,
    openGraph: {
      title: post.title,
      description,
      url: `/blog/${slug}`,
      siteName: "Milk & Henny",
      type: "article",
      publishedTime: post.date,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description,
    },
  };
}

/** Format a date string into a readable form */
function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Extract album slugs from markdown links like [text](/pics/slug).
 * Resolves each to an EmbeddedAlbum with preview data.
 *
 * Fully defensive — returns {} on any error so blog pages never break.
 * To remove album embeds entirely: delete this function, the import,
 * and the `albums` prop on PostBody.
 */
function resolveAlbumsFromContent(
  content: string
): Record<string, EmbeddedAlbum> {
  try {
    // Match album links — optional #hash at end (e.g. /pics/slug#masonry)
    const albumLinkPattern = /\[.*?\]\(\/pics\/([a-z0-9-]+)(?:#[a-z]+)?\)/g;
    const albums: Record<string, EmbeddedAlbum> = {};
    let match: RegExpExecArray | null;

    while ((match = albumLinkPattern.exec(content)) !== null) {
      const albumSlug = match[1];
      const href = `/pics/${albumSlug}`;

      if (albums[href]) continue;

      const album = getAlbumBySlug(albumSlug);
      if (!album?.photos?.length) continue;

      // Build preview: cover first, then up to 3 more unique photos
      const previewIds = [album.cover];
      for (const photo of album.photos) {
        if (previewIds.length >= 4) break;
        if (photo.id !== album.cover) previewIds.push(photo.id);
      }

      albums[href] = {
        slug: album.slug,
        title: album.title,
        date: album.date,
        cover: album.cover,
        photoCount: album.photos.length,
        previewIds,
      };
    }

    return albums;
  } catch {
    // If anything goes wrong, blog still works — links render as normal <a> tags
    return {};
  }
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) notFound();

  const albums = resolveAlbumsFromContent(post.content);

  return (
    <div className="min-h-screen bg-background">
      <ReadingProgress />

      {/* Nav */}
      <header className="max-w-2xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between font-mono text-sm">
          <Link
            href="/"
            className="theme-muted hover:text-foreground transition-colors tracking-tight"
          >
            ← back
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

      {/* Post */}
      <article className="max-w-2xl mx-auto px-6 pt-14 pb-24">
        <header className="mb-12">
          <div className="flex items-center gap-3 font-mono text-xs theme-muted tracking-wide">
            <time>{formatDate(post.date)}</time>
            <span>·</span>
            <span>{post.readingTime} min read</span>
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground leading-tight tracking-tight mt-4">
            {post.title}
          </h1>
          {post.subtitle && (
            <p className="mt-4 theme-subtle text-lg leading-relaxed">
              {post.subtitle}
            </p>
          )}
        </header>

        <PostBody content={post.content} albums={albums} />
      </article>

      {/* Footer */}
      <footer className="border-t theme-border">
        <div className="max-w-2xl mx-auto px-6 py-8 flex items-center justify-between font-mono text-[11px] theme-muted tracking-wide">
          <Link
            href="/"
            className="hover:text-foreground transition-colors"
          >
            ← all posts
          </Link>
          <span>© {new Date().getFullYear()} milk & henny</span>
        </div>
      </footer>
    </div>
  );
}
