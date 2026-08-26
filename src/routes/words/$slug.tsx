import { Link, createFileRoute } from "@tanstack/react-router";
import { WordBody } from "@/features/words/components/ui/WordBody";
import { formatWordDate, highlightWordTitle } from "@/features/words/components/ui/wordPageShared";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JourneyRail } from "@/components/SiteFooter";
import { JumpRail } from "@/components/JumpRail";
import { ReadingProgress } from "@/components/ReadingProgress";
import { Share } from "@/components/Share";
import { AppImage } from "@/components/AppImage";
import { imagePlaceholderStyle } from "@/features/media/image";
import { getWordPageFn } from "@/features/words/reader.functions";
import { BASE_URL, SITE_BRAND, SITE_NAME } from "@/lib/shared/config";
import { serializeJsonForHtml } from "@/lib/shared/serialize-json-for-html";
import { OG_IMAGES, absoluteUrl, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/words/$slug")({
  component: WordSlugPage,
  validateSearch: (search: Record<string, unknown>): { share?: string } =>
    typeof search.share === "string" ? { share: search.share } : {},
  loaderDeps: ({ search }) => ({ share: search.share }),
  loader: ({ params, deps }) => getWordPageFn({ data: { ...params, share: deps.share } }),
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
  const { note, published, headings, albums, heroImage, heroImageData, images } = data;
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
    <div className="flex min-h-dvh flex-col bg-background">
      {/* react-doctor-disable-next-line dangerous-html-sink -- JSON-LD is serialized with inline-script escaping */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonForHtml(jsonLd) }}
      />
      <ReadingProgress />
      {headings.length > 0 && <JumpRail items={headings} ariaLabel="Jump to heading" />}

      <header className="max-w-2xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between gap-8 font-mono text-sm">
          <Link
            to="/words"
            className="shrink-0 theme-muted hover:text-foreground transition-colors tracking-tight"
          >
            ← words
          </Link>
          <Link
            to="/"
            className="shrink-0 font-bold text-foreground tracking-tighter hover:opacity-70 transition-opacity"
          >
            {SITE_BRAND}
          </Link>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6">
        <div className="border-t theme-border" />
      </div>

      <main id="main" className="flex-1">
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
            <figure
              className="media-image-placeholder mb-10"
              style={imagePlaceholderStyle(heroImageData?.placeholder)}
            >
              <AppImage
                src={heroImage}
                srcSet={heroImageData?.srcSet}
                sources={heroImageData?.sources}
                alt={meta.title}
                width={heroImageData?.width}
                height={heroImageData?.height}
                reveal
                className="w-full rounded-md border theme-border"
                sizes="(min-width: 672px) 624px, calc(100vw - 3rem)"
                priority
              />
            </figure>
          ) : null}

          <WordBody content={note.markdown} wordSlug={slug} albums={albums} images={images} />
        </article>
      </main>
      <JourneyRail
        trailing={
          data.olderWord || data.newerWord ? (
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 md:justify-end">
              {data.olderWord ? (
                <Link
                  to="/words/$slug"
                  params={{ slug: data.olderWord.slug }}
                  className="max-w-[14rem] truncate hover:text-foreground transition-colors"
                >
                  ← older · {data.olderWord.title}
                </Link>
              ) : null}
              {data.newerWord ? (
                <Link
                  to="/words/$slug"
                  params={{ slug: data.newerWord.slug }}
                  className="max-w-[14rem] truncate hover:text-foreground transition-colors"
                >
                  {data.newerWord.title} · newer →
                </Link>
              ) : null}
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
