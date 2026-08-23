import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { WordBody } from "@/features/words/components/ui/WordBody";
import { WordSplitRedirectClient } from "@/features/words/components/ui/WordSplitRedirectClient";
import { getWordRenderData } from "@/features/words/components/ui/wordRenderData.server";
import { formatWordDate, highlightWordTitle } from "@/features/words/components/ui/wordPageShared";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JumpRail } from "@/components/JumpRail";
import { ReadingProgress } from "@/components/ReadingProgress";
import { Share } from "@/components/Share";
import { resolveWordContentRef } from "@/features/media/storage";
import { isWordsEnabled } from "@/features/words/reader.server";
import { getWord, getWordMeta } from "@/features/words/store.server";
import { BASE_URL, SITE_BRAND, SITE_NAME } from "@/lib/shared/config";
import { serializeJsonForHtml } from "@/lib/shared/serialize-json-for-html";
import { OG_IMAGES, absoluteUrl, buildSeoHead } from "@/lib/shared/seo";

const getWordPage = createServerFn({ method: "GET" })
  .validator((data: { slug: string }) => data)
  .handler(async ({ data }) => {
    const { slug } = data;
    if (!isWordsEnabled()) throw notFound();
    const meta = await getWordMeta(slug);
    if (!meta) throw notFound();
    if (meta.visibility === "private") {
      return { kind: "private" as const, meta };
    }

    const note = await getWord(slug);
    if (!note) throw notFound();

    const published = meta.publishedAt ?? meta.updatedAt;
    const { headings, albums } = getWordRenderData(slug, note.meta.updatedAt, note.markdown);
    const heroImage = meta.image ? resolveWordContentRef(meta.image, slug) : "";
    return { kind: "word" as const, meta, note, published, headings, albums, heroImage };
  });

export const Route = createFileRoute("/words/$slug")({
  component: WordSlugPage,
  loader: ({ params }) => getWordPage({ data: params }),
  head: ({ loaderData }) => {
    if (!loaderData) {
      return buildSeoHead({
        title: `Page — ${SITE_NAME}`,
        description: "A page from Milk & Henny.",
        path: "/words",
        robots: "noindex, nofollow",
      });
    }
    const { meta } = loaderData;
    if (loaderData.kind === "private") {
      return buildSeoHead({
        title: `Private page — ${SITE_NAME}`,
        description: "This page is private and requires authenticated access.",
        path: `/words/${meta.slug}`,
        robots: "noindex, nofollow",
      });
    }
    const description = meta.subtitle ?? `Read "${meta.title}" on ${SITE_NAME}`;
    return buildSeoHead({
      title: `${meta.title} — ${SITE_NAME}`,
      description,
      path: `/words/${meta.slug}`,
      image: loaderData.heroImage || OG_IMAGES.words,
      imageAlt: `${meta.title} — Milk & Henny words`,
      type: "article",
      robots: meta.visibility === "public" ? "index, follow" : "noindex, nofollow",
      publishedTime: meta.publishedAt ?? meta.updatedAt,
      modifiedTime: meta.updatedAt,
    });
  },
});

function WordSlugPage() {
  const data = Route.useLoaderData();
  const { meta } = data;
  const slug = meta.slug;
  if (data.kind === "private") {
    return (
      <div className="min-h-screen bg-background">
        <header className="max-w-2xl mx-auto px-6 pt-10 pb-6">
          <div className="flex items-center justify-between font-mono text-sm">
            <Link
              to="/words"
              className="theme-muted hover:text-foreground transition-colors tracking-tight"
            >
              ← words
            </Link>
            <Link
              to="/"
              className="font-bold text-foreground tracking-tighter hover:opacity-70 transition-opacity"
            >
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
            <WordSplitRedirectClient slug={slug} />
          </article>
        </main>
      </div>
    );
  }

  const { note, published, headings, albums, heroImage } = data;
  const readingTime = note.meta.readingTime;
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
    image: [absoluteUrl(heroImage || OG_IMAGES.words)],
    dateModified: meta.updatedAt,
    mainEntityOfPage: `${BASE_URL}/words/${slug}`,
    url: `${BASE_URL}/words/${slug}`,
  };

  return (
    <div className="min-h-screen bg-background">
      {/* react-doctor-disable-next-line dangerous-html-sink -- JSON-LD is serialized with inline-script escaping */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonForHtml(jsonLd) }}
      />
      <ReadingProgress />
      {headings.length > 0 && <JumpRail items={headings} ariaLabel="Jump to heading" />}

      <header className="max-w-2xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between font-mono text-sm">
          <Link
            to="/words"
            className="theme-muted hover:text-foreground transition-colors tracking-tight"
          >
            ← words
          </Link>
          <Link
            to="/"
            className="font-bold text-foreground tracking-tighter hover:opacity-70 transition-opacity"
          >
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
              <p className="mt-4 font-serif theme-subtle text-lg leading-relaxed">{pageSubtitle}</p>
            )}
          </header>

          {heroImage ? (
            <figure className="mb-10">
              <img
                src={heroImage}
                alt={meta.title}
                className="w-full rounded-md border theme-border"
                loading="eager"
              />
            </figure>
          ) : null}

          <WordBody content={note.markdown} wordSlug={slug} albums={albums} />
        </article>
      </main>
    </div>
  );
}
