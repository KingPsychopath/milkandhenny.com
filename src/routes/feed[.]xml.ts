import { createFileRoute } from "@tanstack/react-router";
import { isWordsEnabled } from "@/features/words/reader.server";
import { listAllWords } from "@/features/words/store.server";
import { renderWordFeed } from "@/features/words/feed";
import { BASE_URL, SITE_BRAND } from "@/lib/shared/config";
import { PUBLIC_DISCOVERY_CACHE_CONTROL } from "@/lib/shared/media-cache";

export const Route = createFileRoute("/feed.xml")({
  server: {
    handlers: {
      GET: async () => {
        const posts = (
          isWordsEnabled()
            ? await listAllWords({
                includeNonPublic: false,
                visibility: "public",
                type: "blog",
              })
            : []
        ).sort(
          (a, b) =>
            new Date(b.publishedAt ?? b.updatedAt).getTime() -
            new Date(a.publishedAt ?? a.updatedAt).getTime(),
        );
        const feed = renderWordFeed({ baseUrl: BASE_URL, siteBrand: SITE_BRAND, posts });

        return new Response(feed.trim(), {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": PUBLIC_DISCOVERY_CACHE_CONTROL,
          },
        });
      },
    },
  },
});
