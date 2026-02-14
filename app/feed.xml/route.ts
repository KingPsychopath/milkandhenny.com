import { getAllPosts } from "@/lib/blog";
import { BASE_URL, SITE_BRAND } from "@/lib/config";

/** Generate an RSS 2.0 feed from all blog posts */
export function GET() {
  const posts = getAllPosts();

  const items = posts
    .map(
      (post) => `
    <item>
      <title><![CDATA[${post.title}]]></title>
      <link>${BASE_URL}/blog/${post.slug}</link>
      <guid isPermaLink="true">${BASE_URL}/blog/${post.slug}</guid>
      <pubDate>${new Date(post.date + "T00:00:00").toUTCString()}</pubDate>
      ${post.subtitle ? `<description><![CDATA[${post.subtitle}]]></description>` : ""}
    </item>`
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
}
