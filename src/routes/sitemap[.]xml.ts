import { createFileRoute } from "@tanstack/react-router";
import { listEvents } from "@/features/events/store.server";
import { getAllAlbums } from "@/features/media/albums.server";
import { getOgUrl, resolveWordContentRef } from "@/features/media/storage";
import { listPublicPitchDecks } from "@/features/things/pitches/store.server";
import { isWordsEnabled } from "@/features/words/reader.server";
import { listWords } from "@/features/words/store.server";
import { hasMediaPublicUrl } from "@/lib/shared/config";
import { absoluteUrl } from "@/lib/shared/seo";

type SitemapImage = {
  url: string;
  title?: string;
  caption?: string;
};

type SitemapEntry = {
  url: string;
  lastModified?: Date;
  changeFrequency: "weekly" | "monthly" | "yearly";
  priority: number;
  images?: SitemapImage[];
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

function parseDate(value: Date | string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function latestDate(values: Array<Date | string | undefined>): Date | undefined {
  return values.reduce<Date | undefined>((latest, value) => {
    const date = parseDate(value);
    if (!date) return latest;
    return !latest || date > latest ? date : latest;
  }, undefined);
}

function image(url: string | undefined, title?: string, caption?: string): SitemapImage[] {
  if (!url) return [];
  return [{ url: absoluteUrl(url), title, caption }];
}

function getMediaImageUrl(album: string, photoId: string): string | undefined {
  const url = getOgUrl(album, photoId);
  return url.startsWith("/") ? undefined : url;
}

function renderImage(imageEntry: SitemapImage): string {
  return [
    "  <image:image>",
    "    <image:loc>" + escapeXml(imageEntry.url) + "</image:loc>",
    imageEntry.title ? "    <image:title>" + escapeXml(imageEntry.title) + "</image:title>" : "",
    imageEntry.caption
      ? "    <image:caption>" + escapeXml(imageEntry.caption) + "</image:caption>"
      : "",
    "  </image:image>",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderEntry(entry: SitemapEntry): string {
  const lines = [
    "<url>",
    "  <loc>" + escapeXml(entry.url) + "</loc>",
    entry.lastModified ? "  <lastmod>" + entry.lastModified.toISOString() + "</lastmod>" : "",
    "  <changefreq>" + entry.changeFrequency + "</changefreq>",
    "  <priority>" + entry.priority + "</priority>",
  ];
  const images = (entry.images ?? []).map(renderImage);
  if (images.length > 0) lines.push(images.join("\n"));
  lines.push("</url>");
  return lines.filter(Boolean).join("\n");
}

async function listAllPublicWords() {
  if (!isWordsEnabled()) return [];

  const words = [];
  let cursor: string | undefined;
  do {
    const page = await listWords({
      includeNonPublic: false,
      visibility: "public",
      limit: 100,
      cursor,
    });
    words.push(...page.words);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return words;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const publicWords = await listAllPublicWords().catch(() => []);

        // An events outage should degrade the sitemap, not fail it.
        const publicEvents = await listEvents({ limit: 500 }).catch(() => []);
        const publicPitches = await listPublicPitchDecks(undefined, 100).catch(() => []);
        const albums = getAllAlbums();
        const includeMediaImages = hasMediaPublicUrl();

        const latestWordsUpdate = latestDate(publicWords.map((word) => word.updatedAt));
        const latestEventsUpdate = latestDate(publicEvents.map((event) => event.updatedAt));
        const latestPitchUpdate = latestDate(publicPitches.map((pitch) => pitch.updatedAt));
        const latestAlbumDate = latestDate(
          albums.flatMap((album) => [album.date, ...album.photos.map((photo) => photo.takenAt)]),
        );

        const entries: SitemapEntry[] = [
          {
            url: absoluteUrl("/"),
            lastModified: latestDate([
              latestWordsUpdate,
              latestEventsUpdate,
              latestPitchUpdate,
              latestAlbumDate,
            ]),
            changeFrequency: "weekly",
            priority: 1,
          },
          {
            url: absoluteUrl("/pics"),
            lastModified: latestAlbumDate,
            changeFrequency: "weekly",
            priority: 0.9,
          },
          {
            url: absoluteUrl("/words"),
            lastModified: latestWordsUpdate,
            changeFrequency: "weekly",
            priority: 0.9,
          },
          {
            url: absoluteUrl("/things"),
            changeFrequency: "monthly",
            priority: 0.8,
          },
          ...[
            "centre",
            "draw-country",
            "heads-up",
            "icebreaker",
            "liars",
            "pitches",
            "same-brain",
            "spelling-bee",
            "spelling-party",
            "twin",
          ].map((slug) => ({
            url: absoluteUrl("/things/" + slug),
            changeFrequency: "monthly" as const,
            priority: 0.7,
          })),
          {
            url: absoluteUrl("/pitch-night"),
            changeFrequency: "weekly",
            priority: 0.8,
          },
          {
            url: absoluteUrl("/events"),
            lastModified: latestEventsUpdate,
            changeFrequency: "weekly",
            priority: 0.9,
          },
          {
            url: absoluteUrl("/contact"),
            changeFrequency: "yearly",
            priority: 0.3,
          },
          {
            url: absoluteUrl("/privacy"),
            changeFrequency: "yearly",
            priority: 0.2,
          },
          ...publicEvents.map((event) => ({
            url: absoluteUrl("/events/" + event.slug),
            lastModified: parseDate(event.updatedAt),
            changeFrequency: "weekly" as const,
            priority: 0.8,
            images: image(
              event.ogImage ?? event.heroImage,
              event.title,
              event.tagline ?? event.description,
            ),
          })),
          ...publicWords.map((word) => {
            const heroImage =
              includeMediaImages && word.image
                ? resolveWordContentRef(word.image, word.slug)
                : undefined;
            return {
              url: absoluteUrl("/words/" + word.slug),
              lastModified: parseDate(word.updatedAt),
              changeFrequency: "monthly" as const,
              priority: word.type === "blog" ? 0.8 : 0.7,
              images: image(heroImage, word.title, word.subtitle),
            };
          }),
          ...albums.flatMap((album) => {
            const albumDate = latestDate([
              album.date,
              ...album.photos.map((photo) => photo.takenAt),
            ]);
            const albumEntry: SitemapEntry = {
              url: absoluteUrl("/pics/" + album.slug),
              lastModified: albumDate,
              changeFrequency: "monthly",
              priority: 0.7,
              images: includeMediaImages
                ? album.photos.flatMap((photo, index) =>
                    image(
                      getMediaImageUrl(album.slug, photo.id),
                      album.title + " — photo " + (index + 1),
                      album.description,
                    ),
                  )
                : [],
            };
            const photoEntries: SitemapEntry[] = album.photos.map((photo, index) => ({
              url: absoluteUrl("/pics/" + album.slug + "/" + photo.id),
              lastModified: parseDate(photo.takenAt) ?? albumDate,
              changeFrequency: "monthly",
              priority: 0.6,
              images: includeMediaImages
                ? image(
                    getMediaImageUrl(album.slug, photo.id),
                    album.title + " — photo " + (index + 1),
                    album.description,
                  )
                : [],
            }));
            return [albumEntry, ...photoEntries];
          }),
          ...publicPitches.map((pitch) => ({
            url: absoluteUrl("/things/pitches/" + pitch.id),
            lastModified: parseDate(pitch.updatedAt || pitch.publishedAt),
            changeFrequency: "monthly" as const,
            priority: 0.6,
          })),
        ];

        const urls = entries.map(renderEntry).join("\n");
        const sitemap =
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
          'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
          urls +
          "\n</urlset>";

        return new Response(sitemap, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=3600",
          },
        });
      },
    },
  },
});
