import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { resolveWordContentRef } from "@/features/media/storage";
import { getWordRenderData } from "./components/ui/wordRenderData.server";
import { extractMarkdownImageRefs } from "./image";
import { loadWordImageData } from "./image.server";
import { canReadWordInServerContext, isWordsEnabled } from "./reader.server";
import { getWord, getWordMeta, listWords } from "./store.server";
import type { WordType } from "./types";
import type { WordListSummary } from "./components/ui/SearchableWordList";

function formatDate(isoOrDate: string): string {
  const withTime = /^\d{4}-\d{2}-\d{2}$/.test(isoOrDate) ? `${isoOrDate}T00:00:00` : isoOrDate;
  const date = new Date(withTime);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const getWordsPageFn = createServerFn({ method: "GET" }).handler(async () => {
  const noteItems = isWordsEnabled()
    ? (await listWords({ includeNonPublic: false, limit: 1000 })).words
    : [];

  const allItems: WordListSummary[] = noteItems.map((note) => ({
    slug: note.slug,
    title: note.title,
    subtitle: note.subtitle,
    type: note.type as WordType,
    tags: note.tags,
    dateLabel: formatDate(note.publishedAt ?? note.updatedAt),
    date: note.publishedAt ?? note.updatedAt,
    readingTime: note.readingTime,
    featured: note.featured,
    searchText: `${note.slug} ${note.title} ${note.subtitle ?? ""} ${note.type} ${note.tags.join(" ")} ${note.featured ? "featured" : ""}`,
  }));
  allItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return allItems;
});

export const getWordPageFn = createServerFn({ method: "GET" })
  .validator((data: { slug: string }) => data)
  .handler(async ({ data }) => {
    const { slug } = data;
    if (!isWordsEnabled()) throw notFound();
    const meta = await getWordMeta(slug);
    if (!meta) throw notFound();
    if (meta.visibility === "private") return { kind: "private" as const, meta };

    const note = await getWord(slug);
    if (!note) throw notFound();

    const publishedWords = (await listWords({ includeNonPublic: false, limit: 1000 })).words
      .map((word) => ({
        slug: word.slug,
        title: word.title,
        date: word.publishedAt ?? word.updatedAt,
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const currentIndex = publishedWords.findIndex((word) => word.slug === slug);
    const published = meta.publishedAt ?? meta.updatedAt;
    const { headings, albums } = await getWordRenderData(slug, note.meta.updatedAt, note.markdown);
    const imageRefs = [
      ...extractMarkdownImageRefs(note.markdown),
      ...(meta.image ? [meta.image] : []),
    ];
    const images = await loadWordImageData({ refs: imageRefs, wordSlug: slug, privacy: "public" });
    const heroImageData = meta.image ? images[meta.image] : undefined;
    const heroImage =
      heroImageData?.src ?? (meta.image ? resolveWordContentRef(meta.image, slug) : "");

    return {
      kind: "word" as const,
      meta,
      note,
      published,
      headings,
      albums,
      heroImage,
      heroImageData,
      images,
      olderWord: currentIndex >= 0 ? (publishedWords[currentIndex + 1] ?? null) : null,
      newerWord: currentIndex > 0 ? (publishedWords[currentIndex - 1] ?? null) : null,
    };
  });

export const getPrivateWordPageFn = createServerFn({ method: "GET" })
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
    const renderData = note
      ? await getWordRenderData(slug, note.meta.updatedAt, note.markdown)
      : null;
    const imageRefs = note
      ? [...extractMarkdownImageRefs(note.markdown), ...(meta.image ? [meta.image] : [])]
      : [];
    const images = note
      ? await loadWordImageData({ refs: imageRefs, wordSlug: slug, privacy: "private" })
      : {};
    const heroImageData = meta.image ? images[meta.image] : undefined;
    const heroImage =
      heroImageData?.src ??
      (note && meta.image ? resolveWordContentRef(meta.image, slug, { privacy: "private" }) : "");

    return {
      meta,
      note,
      published,
      readingTime: note ? note.meta.readingTime : 0,
      headings: renderData?.headings ?? [],
      albums: renderData?.albums ?? {},
      heroImage,
      heroImageData,
      images,
    };
  });
