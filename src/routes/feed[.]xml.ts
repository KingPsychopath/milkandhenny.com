import { createFileRoute } from "@tanstack/react-router";
import { isWordsEnabled } from "@/features/words/reader.server";
import { listWords } from "@/features/words/store.server";
import { BASE_URL, SITE_BRAND } from "@/lib/shared/config";

export const Route = createFileRoute("/feed.xml")({
  server: {
    handlers: {
      GET: async () => {
        const posts = isWordsEnabled()
          ? (
              await listWords({
                includeNonPublic: false,
                visibility: "public",
                type: "blog",
                limit: 500,
              })
            ).words
          : [];

        const items = posts
          .sort(
            (a, b) =>
              new Date(b.publishedAt ?? b.updatedAt).getTime() -
              new Date(a.publishedAt ?? a.updatedAt).getTime(),
          )
          .map(
            (post) => `
    <item>
      <title><![CDATA[${post.title}]]></title>
      <link>${BASE_URL}/words/${post.slug}</link>
      <guid isPermaLink="true">${BASE_URL}/words/${post.slug}</guid>
      <pubDate>${new Date(post.publishedAt ?? post.updatedAt).toUTCString()}</pubDate>
      ${post.subtitle ? `<description><![CDATA[${post.subtitle}]]></description>` : ""}
    </item>`,
          )
          .join("");

        const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${SITE_BRAND.replace(/&/g, "&amp;")}</title>
    <link>${BASE_URL}</link>
    <description>thoughts, stories, and things worth sharing</description>
    <language>en</language>
    <atom:link href="${BASE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;

        return new Response(feed.trim(), {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "s-maxage=3600, stale-while-revalidate=3600",
          },
        });
      },
    },
  },
});
