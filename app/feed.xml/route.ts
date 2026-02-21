import { isNotesEnabled } from "@/features/notes/reader";
import { listNotes } from "@/features/notes/store";
import { BASE_URL, SITE_BRAND } from "@/lib/shared/config";

/** Generate an RSS 2.0 feed from all blog posts */
export async function GET() {
  const noteBlogs = isNotesEnabled()
    ? (await listNotes({
        includeNonPublic: false,
        visibility: "public",
        type: "blog",
        limit: 500,
      })).notes
    : [];

  const bySlug = new Map<
    string,
    { slug: string; title: string; subtitle?: string; date: string }
  >();
  for (const note of noteBlogs) {
    bySlug.set(note.slug, {
      slug: note.slug,
      title: note.title,
      subtitle: note.subtitle,
      date: note.publishedAt ?? note.updatedAt,
    });
  }
  const all = [...bySlug.values()].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const items = all
    .map(
      (post) => `
    <item>
      <title><![CDATA[${post.title}]]></title>
      <link>${BASE_URL}/words/${post.slug}</link>
      <guid isPermaLink="true">${BASE_URL}/words/${post.slug}</guid>
      <pubDate>${new Date(post.date).toUTCString()}</pubDate>
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
