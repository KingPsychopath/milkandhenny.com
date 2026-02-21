import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostBody } from "@/app/(editorial)/blog/[slug]/PostBody";
import { UnlockNoteClient } from "@/app/(editorial)/notes/[slug]/UnlockNoteClient";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JumpRail } from "@/components/JumpRail";
import { ReadingProgress } from "@/components/ReadingProgress";
import { Share } from "@/components/Share";
import { getAlbumBySlug } from "@/features/media/albums";
import { focalPresetToObjectPosition } from "@/features/media/focal";
import { resolveWordContentRef } from "@/features/media/storage";
import { canReadNoteInServerContext, isNotesEnabled } from "@/features/notes/reader";
import { getNote } from "@/features/notes/store";
import { BASE_URL, SITE_BRAND, SITE_NAME } from "@/lib/shared/config";
import { uniqueHeadingIds } from "@/lib/markdown/slug";

const STOP_WORDS = new Set([
  "a","an","the","in","on","at","to","for","of","and","or","but",
  "is","it","its","my","i","we","so","no","do","if","by","as","up",
  "be","am","are","was","were","not","this","that","with","from",
]);

const WPM = 230;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ share?: string }>;
};

type EmbeddedAlbum = {
  slug: string;
  title: string;
  date: string;
  cover: string;
  photoCount: number;
  previewIds: string[];
  focalPoints?: Record<string, string>;
};

function estimateReadingTime(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WPM));
}

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

function formatDate(dateStr: string): string {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00` : dateStr;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function resolveAlbumsFromContent(content: string): Record<string, EmbeddedAlbum> {
  try {
    const albumLinkPattern = /\[.*?\]\(\/pics\/([a-z0-9-]+)(?:#[a-z]+)?\)/g;
    const albums: Record<string, EmbeddedAlbum> = {};
    let match: RegExpExecArray | null;

    while ((match = albumLinkPattern.exec(content)) !== null) {
      const albumSlug = match[1];
      const href = `/pics/${albumSlug}`;
      if (albums[href]) continue;

      const album = getAlbumBySlug(albumSlug);
      if (!album?.photos?.length) continue;

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
    return {};
  }
}

function extractHeadings(content: string): Array<{ id: string; label: string }> {
  const labels: string[] = [];
  const lineRe = /^(#{1,3})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(content)) !== null) {
    labels.push(m[2].trim());
  }
  return uniqueHeadingIds(labels);
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!isNotesEnabled()) return {};
  const note = await getNote(slug);
  if (!note) return {};
  const isPublic = note.meta.visibility === "public";
  if (note.meta.visibility === "private") {
    return {
      title: `Private Page — ${SITE_NAME}`,
      description: "This page is private and requires authenticated access.",
      robots: { index: false, follow: false },
    };
  }

  const description = note.meta.subtitle ?? `Read "${note.meta.title}" on ${SITE_NAME}`;
  const heroImage = note.meta.image ? resolveWordContentRef(note.meta.image, slug) : "";
  const published = note.meta.publishedAt ?? note.meta.updatedAt;
  return {
    title: `${note.meta.title} — ${SITE_NAME}`,
    description,
    robots: isPublic ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      title: note.meta.title,
      description,
      url: `/words/${slug}`,
      siteName: SITE_NAME,
      type: "article",
      publishedTime: published,
      ...(heroImage ? { images: [{ url: heroImage, alt: note.meta.title }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: note.meta.title,
      description,
      ...(heroImage ? { images: [heroImage] } : {}),
    },
  };
}

export default async function WordSlugPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { share } = await searchParams;

  if (!isNotesEnabled()) notFound();
  const note = await getNote(slug);
  if (!note) notFound();
  const canRead = await canReadNoteInServerContext(note.meta);
  const isPrivateLocked = note.meta.visibility === "private" && !canRead;
  const readingTime = canRead ? estimateReadingTime(note.markdown) : 0;
  const isBlog = note.meta.type === "blog";
  const published = note.meta.publishedAt ?? note.meta.updatedAt;
  const headings = canRead && isBlog ? extractHeadings(note.markdown) : [];
  const albums = canRead ? resolveAlbumsFromContent(note.markdown) : {};
  const heroImage = canRead && note.meta.image ? resolveWordContentRef(note.meta.image, slug) : "";
  const pageTitle = isPrivateLocked ? "private page" : note.meta.title;
  const pageSubtitle = isPrivateLocked
    ? "this page is private. use an authenticated session or valid share link."
    : note.meta.subtitle;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: pageTitle,
    description: pageSubtitle ?? pageTitle,
    datePublished: published,
    author: { "@type": "Organization", name: SITE_NAME },
    publisher: { "@type": "Organization", name: SITE_NAME },
    url: `${BASE_URL}/words/${slug}`,
  };

  return (
    <div className="min-h-screen bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ReadingProgress />
      {headings.length > 0 && <JumpRail items={headings} ariaLabel="Jump to heading" />}

      <header role="banner" className="max-w-2xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between font-mono text-sm">
          <Link href="/words" className="theme-muted hover:text-foreground transition-colors tracking-tight">
            ← words
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
        <article className="max-w-2xl mx-auto px-6 pt-12 pb-24">
          <Breadcrumbs
            items={[
              { label: "home", href: "/" },
              { label: "words", href: "/words" },
              { label: pageTitle },
            ]}
          />
          <header className="mb-10 mt-2">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 font-mono text-xs theme-muted tracking-wide">
              <div className="flex items-center gap-3">
                {!isPrivateLocked ? (
                  <>
                    <time dateTime={published}>{formatDate(published)}</time>
                    <span>·</span>
                    {isBlog ? <span>{readingTime} min read</span> : <span>{note.meta.type}</span>}
                    {note.meta.featured && (
                      <>
                        <span>·</span>
                        <span className="text-amber-600 dark:text-amber-500/80">featured</span>
                      </>
                    )}
                    {note.meta.visibility !== "public" && (
                      <>
                        <span>·</span>
                        <span>{note.meta.visibility}</span>
                      </>
                    )}
                  </>
                ) : (
                  <span>private</span>
                )}
              </div>
              {canRead ? (
                <Share url={`${BASE_URL}/words/${slug}`} title={note.meta.title} label="Share this post" />
              ) : null}
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl text-foreground leading-tight tracking-tight mt-4">
              {!isPrivateLocked && isBlog ? highlightTitle(note.meta.title) : pageTitle}
            </h1>
            {pageSubtitle && (
              <p className="mt-4 font-serif theme-subtle text-lg leading-relaxed">
                {pageSubtitle}
              </p>
            )}
          </header>

          {heroImage ? (
            <figure className="mb-10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroImage} alt={note.meta.title} className="w-full rounded-md border theme-border" loading="eager" />
            </figure>
          ) : null}

          {canRead ? (
            <PostBody content={note.markdown} wordSlug={slug} albums={albums} />
          ) : (
            <UnlockNoteClient slug={slug} shareToken={share ?? ""} />
          )}
        </article>
      </main>
    </div>
  );
}
