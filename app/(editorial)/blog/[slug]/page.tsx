import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getPostBySlug, getAllSlugs, extractHeadings } from "@/lib/blog";
import { getAlbumBySlug } from "@/lib/media/albums";
import { resolveImageSrc } from "@/lib/media/storage";
import { focalPresetToObjectPosition } from "@/lib/media/focal";
import { BASE_URL, SITE_NAME, SITE_BRAND } from "@/lib/config";
import { PostBody } from "./PostBody";
import { ReadingProgress } from "@/components/ReadingProgress";
import { JumpRail } from "@/components/JumpRail";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Share } from "@/components/Share";
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

  const description = post.subtitle ?? `Read "${post.title}" on ${SITE_NAME}`;
  const heroImage = post.image ? resolveImageSrc(post.image) : "";

  return {
    title: `${post.title} — ${SITE_NAME}`,
    description,
    openGraph: {
      title: post.title,
      description,
      url: `/blog/${slug}`,
      siteName: SITE_NAME,
      type: "article",
      publishedTime: post.date,
      ...(heroImage ? { images: [{ url: heroImage, alt: post.title }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description,
      ...(heroImage ? { images: [heroImage] } : {}),
    },
  };
}

const STOP_WORDS = new Set([
  "a","an","the","in","on","at","to","for","of","and","or","but",
  "is","it","its","my","i","we","so","no","do","if","by","as","up",
  "be","am","are","was","were","not","this","that","with","from",
]);

/**
 * Highlights ~35% of a title's words, favouring longer non-stop words.
 * Deterministic — same title always produces the same highlights.
 */
function highlightTitle(title: string) {
  const words = title.split(/\s+/);
  if (words.length <= 2) return title;

  const count = Math.max(1, Math.round(words.length * 0.35));

  const scored = words.map((word, i) => {
    const clean = word.toLowerCase().replace(/[^a-z]/g, "");
    return { i, score: STOP_WORDS.has(clean) ? 0 : word.length };
  });

  const highlighted = new Set(
    [...scored]
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, count)
      .map((s) => s.i),
  );

  // Group words into runs of highlighted / plain so consecutive highlights merge
  const runs: { text: string; lit: boolean }[] = [];
  for (let i = 0; i < words.length; i++) {
    const lit = highlighted.has(i);
    const prev = runs[runs.length - 1];
    if (prev && prev.lit === lit) {
      prev.text += ` ${words[i]}`;
    } else {
      runs.push({ text: words[i], lit });
    }
  }

  return runs.map((run, i) => (
    <span key={`${run.text}-${i}`}>
      {i > 0 && " "}
      {run.lit ? <span className="highlight-selection">{run.text}</span> : run.text}
    </span>
  ));
}

/** Format a date string into a readable form */
function formatDate(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
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
function resolveAlbumsFromContent(content: string): Record<string, EmbeddedAlbum> {
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

      // Build preview: cover first, then up to 5 more (compact uses 4, masonry uses 6)
      const previewIds = [album.cover];
      for (const photo of album.photos) {
        if (previewIds.length >= 6) break;
        if (photo.id !== album.cover) previewIds.push(photo.id);
      }

      const focalPoints: Record<string, string> = {};
      for (const p of album.photos) {
        if (p.focalPoint) {
          focalPoints[p.id] = focalPresetToObjectPosition(p.focalPoint);
        } else if (p.autoFocal) {
          focalPoints[p.id] = `${p.autoFocal.x}% ${p.autoFocal.y}%`;
        }
      }

      albums[href] = {
        slug: album.slug,
        title: album.title,
        date: album.date,
        cover: album.cover,
        photoCount: album.photos.length,
        previewIds,
        focalPoints: Object.keys(focalPoints).length > 0 ? focalPoints : undefined,
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
  const heroImage = post.image ? resolveImageSrc(post.image) : "";

  const albums = resolveAlbumsFromContent(post.content);
  const headings = extractHeadings(post.content);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.subtitle ?? post.title,
    datePublished: post.date,
    author: { "@type": "Organization", name: SITE_NAME },
    publisher: { "@type": "Organization", name: SITE_NAME },
    url: `${BASE_URL}/blog/${slug}`,
  };

  return (
    <div className="min-h-screen bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ReadingProgress />
      {headings.length > 0 && <JumpRail items={headings} ariaLabel="Jump to heading" />}

      {/* Nav — page banner */}
      <header role="banner" className="max-w-2xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between font-mono text-sm">
          <Link href="/" className="theme-muted hover:text-foreground transition-colors tracking-tight">
            ← back
          </Link>
          <Link href="/" className="font-bold text-foreground tracking-tighter hover:opacity-70 transition-opacity">
            {SITE_BRAND}
          </Link>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6">
        <div className="border-t theme-border" />
      </div>

      {/* Post — primary content */}
      <main id="main">
        <article className="max-w-2xl mx-auto px-6 pt-12 pb-24">
          <Breadcrumbs
            items={[
              { label: "home", href: "/" },
              { label: "words", href: "/blog" },
              { label: post.title },
            ]}
          />
          <header className="mb-12 mt-2">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 font-mono text-xs theme-muted tracking-wide">
              <div className="flex items-center gap-3">
                <time dateTime={post.date}>{formatDate(post.date)}</time>
                <span>·</span>
                <span>{post.readingTime} min read</span>
                {post.featured && (
                  <>
                    <span>·</span>
                    <span className="text-amber-600 dark:text-amber-500/80">featured</span>
                  </>
                )}
              </div>
              <Share url={`${BASE_URL}/blog/${slug}`} title={post.title} label="Share this post" />
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl text-foreground leading-tight tracking-tight mt-4">
              {highlightTitle(post.title)}
            </h1>
            {post.subtitle && (
              <p className="mt-4 font-serif theme-subtle text-lg leading-relaxed">
                {post.subtitle}
              </p>
            )}
          </header>

          {heroImage ? (
            <figure className="mb-10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroImage} alt={post.title} className="w-full rounded-md border theme-border" loading="eager" />
            </figure>
          ) : null}

          <PostBody content={post.content} albums={albums} />
        </article>
      </main>

      <footer role="contentinfo" className="border-t theme-border">
        <div className="max-w-2xl mx-auto px-6 py-8 flex items-center justify-between font-mono text-[11px] theme-muted tracking-wide">
          <Link href="/blog" className="hover:text-foreground transition-colors">
            ← all posts
          </Link>
          <span>© {new Date().getFullYear()} {SITE_BRAND}</span>
        </div>
      </footer>
    </div>
  );
}

