import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WordBody } from "@/app/(editorial)/words/_components/WordBody";
import { UnlockWordClient } from "@/app/(editorial)/words/_components/UnlockWordClient";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JumpRail } from "@/components/JumpRail";
import { ReadingProgress } from "@/components/ReadingProgress";
import { Share } from "@/components/Share";
import { getAlbumBySlug } from "@/features/media/albums";
import { focalPresetToObjectPosition } from "@/features/media/focal";
import { resolveWordContentRef } from "@/features/media/storage";
import { extractHeadings } from "@/features/words/headings";
import { isWordsEnabled } from "@/features/words/reader";
import { getWord, getWordMeta, listWords } from "@/features/words/store";
import { estimateReadingTime } from "@/features/words/reading-time";
import { BASE_URL, SITE_BRAND, SITE_NAME } from "@/lib/shared/config";

const STOP_WORDS = new Set([
  "a","an","the","in","on","at","to","for","of","and","or","but",
  "is","it","its","my","i","we","so","no","do","if","by","as","up",
  "be","am","are","was","were","not","this","that","with","from",
]);

type Props = {
  params: Promise<{ slug: string }>;
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

export const revalidate = 60;
export const dynamic = "force-static";
export const dynamicParams = true;

export async function generateStaticParams() {
  if (!isWordsEnabled()) return [];
  const { words } = await listWords({
    includeNonPublic: false,
    visibility: "public",
    limit: 1000,
  });
  return words.map((word) => ({ slug: word.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!isWordsEnabled()) return {};
  const meta = await getWordMeta(slug);
  if (!meta) return {};
  const isPublic = meta.visibility === "public";
  if (meta.visibility === "private") {
    return {
      title: `Private Page — ${SITE_NAME}`,
      description: "This page is private and requires authenticated access.",
      robots: { index: false, follow: false },
    };
  }

  const description = meta.subtitle ?? `Read "${meta.title}" on ${SITE_NAME}`;
  const heroImage = meta.image ? resolveWordContentRef(meta.image, slug) : "";
  const published = meta.publishedAt ?? meta.updatedAt;
  return {
    title: `${meta.title} — ${SITE_NAME}`,
    description,
    robots: isPublic ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      title: meta.title,
      description,
      url: `/words/${slug}`,
      siteName: SITE_NAME,
      type: "article",
      publishedTime: published,
      ...(heroImage ? { images: [{ url: heroImage, alt: meta.title }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description,
      ...(heroImage ? { images: [heroImage] } : {}),
    },
  };
}

export default async function WordSlugPage({ params }: Props) {
  const { slug } = await params;

  if (!isWordsEnabled()) notFound();
  const meta = await getWordMeta(slug);
  if (!meta) notFound();
  const isPrivateLocked = meta.visibility === "private";

  const note = !isPrivateLocked ? await getWord(slug) : null;
  if (!isPrivateLocked && !note) notFound();

  const published = meta.publishedAt ?? meta.updatedAt;
  const readingTime = note
    ? (meta.readingTime > 0 ? meta.readingTime : estimateReadingTime(note.markdown))
    : 0;
  const headings = note ? extractHeadings(note.markdown) : [];
  const albums = note ? resolveAlbumsFromContent(note.markdown) : {};
  const heroImage = note && meta.image ? resolveWordContentRef(meta.image, slug) : "";
  const pageTitle = isPrivateLocked ? "private page" : meta.title;
  const pageSubtitle = isPrivateLocked
    ? "this page is private. use an authenticated session or valid share link."
    : meta.subtitle;

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
                    <span>{meta.type}</span>
                    <span>·</span>
                    <span>{readingTime} min read</span>
                    {meta.featured && (
                      <>
                        <span>·</span>
                        <span className="text-amber-600 dark:text-amber-500/80">featured</span>
                      </>
                    )}
                    {meta.visibility !== "public" && (
                      <>
                        <span>·</span>
                        <span>{meta.visibility}</span>
                      </>
                    )}
                  </>
                ) : (
                  <span>private</span>
                )}
              </div>
              {!isPrivateLocked ? (
                <Share url={`${BASE_URL}/words/${slug}`} title={meta.title} label="Share this post" />
              ) : null}
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl text-foreground leading-tight tracking-tight mt-4">
              {!isPrivateLocked ? highlightTitle(pageTitle) : pageTitle}
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
              <img src={heroImage} alt={meta.title} className="w-full rounded-md border theme-border" loading="eager" />
            </figure>
          ) : null}

          {!isPrivateLocked && note ? (
            <WordBody content={note.markdown} wordSlug={slug} albums={albums} />
          ) : (
            <UnlockWordClient slug={slug} />
          )}
        </article>
      </main>
    </div>
  );
}
