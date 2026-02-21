import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WordBody } from "@/app/(editorial)/words/_components/WordBody";
import { WordSplitRedirectClient } from "@/app/(editorial)/words/_components/WordSplitRedirectClient";
import {
  formatWordDate,
  highlightWordTitle,
  resolveAlbumsFromWordContent,
} from "@/app/(editorial)/words/_components/wordPageShared";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JumpRail } from "@/components/JumpRail";
import { ReadingProgress } from "@/components/ReadingProgress";
import { Share } from "@/components/Share";
import { resolveWordContentRef } from "@/features/media/storage";
import { extractHeadings } from "@/features/words/headings";
import { isWordsEnabled } from "@/features/words/reader";
import { getWord, getWordMeta, listWords } from "@/features/words/store";
import { estimateReadingTime } from "@/features/words/reading-time";
import { wordPrivatePath } from "@/features/words/routes";
import { BASE_URL, SITE_BRAND, SITE_NAME } from "@/lib/shared/config";

type Props = {
  params: Promise<{ slug: string }>;
};


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
  if (meta.visibility === "private") {
    const to = wordPrivatePath(slug);
    return (
      <div className="min-h-screen bg-background">
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
                { label: "private" },
              ]}
            />
            <WordSplitRedirectClient to={to} />
          </article>
        </main>
      </div>
    );
  }

  const note = await getWord(slug);
  if (!note) notFound();

  const published = meta.publishedAt ?? meta.updatedAt;
  const readingTime = meta.readingTime > 0 ? meta.readingTime : estimateReadingTime(note.markdown);
  const headings = extractHeadings(note.markdown);
  const albums = resolveAlbumsFromWordContent(note.markdown);
  const heroImage = meta.image ? resolveWordContentRef(meta.image, slug) : "";
  const pageTitle = meta.title;
  const pageSubtitle = meta.subtitle;

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
                <time dateTime={published}>{formatWordDate(published)}</time>
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
              </div>
              <Share url={`${BASE_URL}/words/${slug}`} title={meta.title} label="Share this post" />
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl text-foreground leading-tight tracking-tight mt-4">
              {highlightWordTitle(pageTitle)}
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

          <WordBody content={note.markdown} wordSlug={slug} albums={albums} />
        </article>
      </main>
    </div>
  );
}
