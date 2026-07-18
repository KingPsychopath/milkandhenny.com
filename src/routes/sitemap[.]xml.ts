import { createFileRoute } from "@tanstack/react-router";
import { getAllAlbums } from "@/features/media/albums.server";
import { isWordsEnabled } from "@/features/words/reader.server";
import { listWords } from "@/features/words/store.server";
import { BASE_URL } from "@/lib/shared/config";

type SitemapEntry = {
  url: string;
  lastModified: Date;
  changeFrequency: "weekly" | "monthly" | "yearly";
  priority: number;
};

function escapeXml(value: string) {
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

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const publicWords = isWordsEnabled()
          ? (
              await listWords({
                includeNonPublic: false,
                visibility: "public",
                limit: 500,
              })
            ).words
          : [];

        const now = new Date();
        const entries: SitemapEntry[] = [
          { url: BASE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
          { url: `${BASE_URL}/pics`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
          { url: `${BASE_URL}/words`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
          {
            url: `${BASE_URL}/things/draw-country`,
            lastModified: new Date("2026-07-18"),
            changeFrequency: "monthly",
            priority: 0.7,
          },
          {
            url: `${BASE_URL}/party`,
            lastModified: new Date("2026-01-16"),
            changeFrequency: "yearly",
            priority: 0.5,
          },
          {
            url: `${BASE_URL}/guestlist`,
            lastModified: new Date("2026-01-16"),
            changeFrequency: "yearly",
            priority: 0.3,
          },
          {
            url: `${BASE_URL}/icebreaker`,
            lastModified: new Date("2026-01-16"),
            changeFrequency: "yearly",
            priority: 0.4,
          },
          {
            url: `${BASE_URL}/best-dressed`,
            lastModified: new Date("2026-01-16"),
            changeFrequency: "yearly",
            priority: 0.4,
          },
          ...publicWords.map((word) => ({
            url: `${BASE_URL}/words/${word.slug}`,
            lastModified: new Date(word.updatedAt),
            changeFrequency: "monthly" as const,
            priority: word.type === "blog" ? 0.8 : 0.7,
          })),
          ...getAllAlbums().map((album) => ({
            url: `${BASE_URL}/pics/${album.slug}`,
            lastModified: new Date(`${album.date}T00:00:00`),
            changeFrequency: "monthly" as const,
            priority: 0.7,
          })),
        ];

        const urls = entries
          .map(
            (entry) => `<url>
  <loc>${escapeXml(entry.url)}</loc>
  <lastmod>${entry.lastModified.toISOString()}</lastmod>
  <changefreq>${entry.changeFrequency}</changefreq>
  <priority>${entry.priority}</priority>
</url>`,
          )
          .join("\n");

        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`,
          {
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
              "Cache-Control": "s-maxage=3600, stale-while-revalidate=3600",
            },
          },
        );
      },
    },
  },
});
