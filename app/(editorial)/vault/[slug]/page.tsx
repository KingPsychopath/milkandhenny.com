import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { WordBody } from "@/app/(editorial)/words/_components/WordBody";
import { UnlockWordClient } from "@/app/(editorial)/words/_components/UnlockWordClient";
import { getWordRenderData } from "@/app/(editorial)/words/_components/wordRenderData";
import {
  formatWordDate,
  highlightWordTitle,
} from "@/app/(editorial)/words/_components/wordPageShared";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JumpRail } from "@/components/JumpRail";
import { ReadingProgress } from "@/components/ReadingProgress";
import { resolveWordContentRef } from "@/features/media/storage";
import { canReadWordInServerContext, isWordsEnabled } from "@/features/words/reader";
import { getWord, getWordMeta } from "@/features/words/store";
import { wordPublicPath } from "@/features/words/routes";
import { SITE_BRAND, SITE_NAME } from "@/lib/shared/config";

type Props = {
  params: Promise<{ slug: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!isWordsEnabled()) return {};
  const meta = await getWordMeta(slug);
  if (!meta) return {};
  if (meta.visibility !== "private") {
    return {
      title: `${meta.title} — ${SITE_NAME}`,
      description: meta.subtitle ?? `Read "${meta.title}" on ${SITE_NAME}`,
      robots: { index: false, follow: false },
    };
  }

  return {
    title: `${meta.title} — ${SITE_NAME}`,
    description: meta.subtitle ?? "This page is private and requires authenticated access.",
    robots: { index: false, follow: false },
  };
}

export default async function WordPrivatePage({ params }: Props) {
  const { slug } = await params;

  if (!isWordsEnabled()) notFound();
  const meta = await getWordMeta(slug);
  if (!meta) notFound();
  if (meta.visibility !== "private") {
    redirect(wordPublicPath(slug));
  }

  const canRead = await canReadWordInServerContext(meta);
  const note = canRead ? await getWord(slug) : null;
  if (canRead && !note) notFound();

  const published = meta.publishedAt ?? meta.updatedAt;
  const readingTime = note ? note.meta.readingTime : 0;
  const renderData = note ? getWordRenderData(slug, note.meta.updatedAt, note.markdown) : null;
  const headings = renderData?.headings ?? [];
  const albums = renderData?.albums ?? {};
  const heroImage = note && meta.image ? resolveWordContentRef(meta.image, slug) : "";

  return (
    <div className="min-h-screen bg-background">
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
              { label: "private" },
            ]}
          />
          <header className="mb-10 mt-2">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 font-mono text-xs theme-muted tracking-wide">
              <div className="flex items-center gap-3">
                <span>private</span>
                {note ? (
                  <>
                    <span>·</span>
                    <time dateTime={published}>{formatWordDate(published)}</time>
                    <span>·</span>
                    <span>{meta.type}</span>
                    <span>·</span>
                    <span>{readingTime} min read</span>
                  </>
                ) : null}
              </div>
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl text-foreground leading-tight tracking-tight mt-4">
              {highlightWordTitle(meta.title)}
            </h1>
            {meta.subtitle && (
              <p className="mt-4 font-serif theme-subtle text-lg leading-relaxed">
                {meta.subtitle}
              </p>
            )}
          </header>

          {heroImage ? (
            <figure className="mb-10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroImage} alt={meta.title} className="w-full rounded-md border theme-border" loading="eager" />
            </figure>
          ) : null}

          {note ? (
            <WordBody content={note.markdown} wordSlug={slug} albums={albums} />
          ) : (
            <UnlockWordClient slug={slug} />
          )}
        </article>
      </main>
    </div>
  );
}
