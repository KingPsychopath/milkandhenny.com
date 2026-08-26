import { Link, createFileRoute } from "@tanstack/react-router";
import { WordBody } from "@/features/words/components/ui/WordBody";
import { UnlockWordClient } from "@/features/words/components/ui/UnlockWordClient";
import { formatWordDate, highlightWordTitle } from "@/features/words/components/ui/wordPageShared";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JumpRail } from "@/components/JumpRail";
import { ReadingProgress } from "@/components/ReadingProgress";
import { AppImage } from "@/components/AppImage";
import { imagePlaceholderStyle } from "@/features/media/image";
import { getPrivateWordPageFn } from "@/features/words/reader.functions";
import { SITE_BRAND, SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/vault/$slug")({
  validateSearch: (search: Record<string, unknown>) => ({
    share: typeof search.share === "string" ? search.share : undefined,
  }),
  loader: ({ params }) => getPrivateWordPageFn({ data: params }),
  component: WordPrivatePage,
  head: ({ loaderData, params }) =>
    buildSeoHead({
      title: `${loaderData?.meta.title ?? "Private page"} — ${SITE_NAME}`,
      description:
        loaderData?.meta.subtitle ?? "This page is private and requires authenticated access.",
      path: `/vault/${params.slug}`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function WordPrivatePage() {
  const { meta, note, published, readingTime, headings, albums, heroImage, heroImageData, images } =
    Route.useLoaderData();
  const slug = meta.slug;

  return (
    <div className="min-h-screen bg-background">
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

          {note ? (
            <WordBody
              content={note.markdown}
              wordSlug={slug}
              albums={albums}
              images={images}
              privateMedia
            />
          ) : (
            <UnlockWordClient slug={slug} />
          )}
        </article>
      </main>
    </div>
  );
}
