import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, setCookie } from "@tanstack/react-start/server";

import { getClientIp } from "@/features/auth/auth.server";
import { resolveWordContentRef } from "@/features/media/storage";
import { getWordRenderData } from "./components/ui/wordRenderData.server";
import { extractMarkdownImageRefs } from "./image";
import { loadWordImageData } from "./image.server";
import { canReadWordInServerContext, isWordsEnabled } from "./reader.server";
import { signWordAccessToken, verifyShareLinkAccess, wordAccessCookieName } from "./share.server";
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

async function verifyAndRememberWordShare(input: { slug: string; token: string; pin?: string }) {
  const verification = await verifyShareLinkAccess({
    slug: input.slug,
    token: input.token,
    pin: input.pin,
    ip: getClientIp(getRequest()),
  });
  if (!verification.ok) return verification;

  const accessToken = signWordAccessToken(verification.link);
  if (!accessToken) {
    return {
      ok: false as const,
      error: "Private sharing is not configured.",
      status: 503,
    };
  }
  setCookie(wordAccessCookieName(input.slug), accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.max(
      1,
      Math.floor((new Date(verification.link.expiresAt).getTime() - Date.now()) / 1000),
    ),
  });
  return { ok: true as const };
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
  .validator((data: { slug: string; share?: string }) => data)
  .handler(async ({ data }) => {
    const { slug } = data;
    if (!isWordsEnabled()) throw notFound();
    const meta = await getWordMeta(slug);
    if (!meta) throw notFound();
    if (meta.visibility === "private") {
      throw redirect({
        to: "/vault/$slug",
        params: { slug },
        search: { share: data.share },
        replace: true,
      });
    }

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
  .validator((data: { slug: string; share?: string }) => data)
  .handler(async ({ data }) => {
    const { slug } = data;
    if (!isWordsEnabled()) throw notFound();
    const meta = await getWordMeta(slug);
    if (!meta) throw notFound();
    if (meta.visibility !== "private") {
      throw redirect({ to: "/words/$slug", params: { slug } });
    }

    let canRead = await canReadWordInServerContext(meta);
    let shareError: string | undefined;
    let pinRequired = false;
    if (!canRead && data.share) {
      const share = await verifyAndRememberWordShare({ slug, token: data.share });
      canRead = share.ok;
      if (!share.ok) {
        shareError = share.error;
        pinRequired = share.pinRequired === true;
      }
    }
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
      shareAccess: { pinRequired, error: shareError },
    };
  });

export const unlockPrivateWordFn = createServerFn({ method: "POST" })
  .validator((data: { slug: string; token: string; pin?: string }) => data)
  .handler(async ({ data }) => {
    const result = await verifyAndRememberWordShare(data);
    return result.ok
      ? result
      : {
          ok: false as const,
          status: result.status,
          error: result.error,
          pinRequired: result.pinRequired === true,
        };
  });
