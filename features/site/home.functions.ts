import { createServerFn } from "@tanstack/react-start";

import { isWordsEnabled } from "@/features/words/reader.server";
import { listWords } from "@/features/words/store.server";
import { getFooterPartyPath } from "./site-settings.server";

const RECENT_LIMIT = 5;

export const getHomePageFn = createServerFn({ method: "GET" }).handler(async () => {
  const [noteBlogs, footerPartyPath] = await Promise.all([
    isWordsEnabled()
      ? listWords({
          includeNonPublic: false,
          visibility: "public",
          type: "blog",
          limit: 1000,
        }).then((result) => result.words)
      : Promise.resolve([]),
    getFooterPartyPath(),
  ]);

  const allPosts = noteBlogs
    .map((note) => ({
      slug: note.slug,
      title: note.title,
      subtitle: note.subtitle,
      date: note.publishedAt ?? note.updatedAt,
      readingTime: note.readingTime,
      featured: note.featured ?? false,
    }))
    .sort((a, b) => {
      if (!!a.featured !== !!b.featured) return a.featured ? -1 : 1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

  return {
    posts: allPosts.slice(0, RECENT_LIMIT),
    hasMore: allPosts.length > RECENT_LIMIT,
    footerPartyPath,
  };
});
