import { Link, createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { WordBody } from "@/features/words/components/ui/WordBody";
import { UnlockWordClient } from "@/features/words/components/ui/UnlockWordClient";
import { getWordRenderData } from "@/features/words/components/ui/wordRenderData.server";
import { formatWordDate, highlightWordTitle } from "@/features/words/components/ui/wordPageShared";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JumpRail } from "@/components/JumpRail";
import { ReadingProgress } from "@/components/ReadingProgress";
import { resolveWordContentRef } from "@/features/media/storage";
import { canReadWordInServerContext, isWordsEnabled } from "@/features/words/reader.server";
import { getWord, getWordMeta } from "@/features/words/store.server";
import { SITE_BRAND, SITE_NAME } from "@/lib/shared/config";

const getPrivateWord = createServerFn({ method: "GET" })
  .validator((data: { slug: string }) => data)
  .handler(async ({ data }) => {
    const { slug } = data;
    if (!isWordsEnabled()) throw notFound();
    const meta = await getWordMeta(slug);
    if (!meta) throw notFound();
    if (meta.visibility !== "private") {
      throw redirect({ to: "/words/$slug", params: { slug } });
    }

    const canRead = await canReadWordInServerContext(meta);
    const note = canRead ? await getWord(slug) : null;
    if (canRead && !note) throw notFound();

    const published = meta.publishedAt ?? meta.updatedAt;
    const readingTime = note ? note.meta.readingTime : 0;
    const renderData = note ? getWordRenderData(slug, note.meta.updatedAt, note.markdown) : null;
    const headings = renderData?.headings ?? [];
    const albums = renderData?.albums ?? {};
    const heroImage = note && meta.image ? resolveWordContentRef(meta.image, slug) : "";

    return { meta, note, published, readingTime, headings, albums, heroImage };
  });

export const Route = createFileRoute("/vault/$slug")({
  component: WordPrivatePage,
  loader: ({ params }) => getPrivateWord({ data: params }),
  validateSearch: (search: Record<string, unknown>) => ({
    share: typeof search.share === "string" ? search.share : undefined,
  }),
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    return {
      meta: [
        { title: `${loaderData.meta.title} — ${SITE_NAME}` },
        {
          name: "description",
          content:
            loaderData.meta.subtitle ?? "This page is private and requires authenticated access.",
        },
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
});

function WordPrivatePage() {
  const { meta, note, published, readingTime, headings, albums, heroImage } = Route.useLoaderData();
  const slug = meta.slug;

  return (
    <div className="min-h-screen bg-background">
      <ReadingProgress />
      {headings.length > 0 && <JumpRail items={headings} ariaLabel="Jump to heading" />}

      <header role="banner" className="max-w-2xl mx-auto px-6 pt-10 pb-6">
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
              <img
                src={heroImage}
                alt={meta.title}
                className="w-full rounded-md border theme-border"
                loading="eager"
              />
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
