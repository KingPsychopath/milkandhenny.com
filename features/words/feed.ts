type WordFeedPost = {
  slug: string;
  title: string;
  subtitle?: string;
  publishedAt?: string;
  updatedAt: string;
};

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    };
    return entities[character];
  });
}

function renderPubDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `      <pubDate>${date.toUTCString()}</pubDate>`;
}

function renderWordFeed(input: {
  baseUrl: string;
  siteBrand: string;
  posts: WordFeedPost[];
}): string {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const escapedBaseUrl = escapeXml(baseUrl);
  const items = input.posts
    .map((post) => {
      const url = `${baseUrl}/words/${encodeURIComponent(post.slug)}`;
      return [
        "    <item>",
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        renderPubDate(post.publishedAt ?? post.updatedAt),
        post.subtitle ? `      <description>${escapeXml(post.subtitle)}</description>` : "",
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(input.siteBrand)}</title>`,
    `    <link>${escapedBaseUrl}</link>`,
    "    <description>thoughts, stories, and things worth sharing</description>",
    "    <language>en</language>",
    `    <atom:link href="${escapedBaseUrl}/feed.xml" rel="self" type="application/rss+xml"/>`,
    items,
    "  </channel>",
    "</rss>",
  ]
    .filter(Boolean)
    .join("\n");
}

export { escapeXml, renderWordFeed };
export type { WordFeedPost };
