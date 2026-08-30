import { BASE_URL, SITE_NAME } from "./config";

const OG_WIDTH = "1200";
const OG_HEIGHT = "630";
// Bump this token whenever a card is regenerated so immutable CDN entries expire safely.
const OG_ASSET_VERSION = "1";

const OG_IMAGES = {
  default: `/og/default.png?v=${OG_ASSET_VERSION}`,
  events: `/og/events.png?v=${OG_ASSET_VERSION}`,
  pics: `/og/pics.png?v=${OG_ASSET_VERSION}`,
  words: `/og/words.png?v=${OG_ASSET_VERSION}`,
  things: `/og/things.png?v=${OG_ASSET_VERSION}`,
  centre: `/og/centre.png?v=${OG_ASSET_VERSION}`,
  drawCountry: `/og/draw-country.png?v=${OG_ASSET_VERSION}`,
  forehead: `/og/forehead.png?v=${OG_ASSET_VERSION}`,
  hotAndCold: `/og/hot-and-cold.png?v=${OG_ASSET_VERSION}`,
  icebreaker: `/og/icebreaker.png?v=${OG_ASSET_VERSION}`,
  liars: `/og/liars.png?v=${OG_ASSET_VERSION}`,
  pitchNight: `/og/pitch-night.png?v=${OG_ASSET_VERSION}`,
  pitchStudio: `/og/pitch-studio.png?v=${OG_ASSET_VERSION}`,
  sameBrain: `/og/same-brain.png?v=${OG_ASSET_VERSION}`,
  spellingBee: `/og/spelling-bee.png?v=${OG_ASSET_VERSION}`,
  spellingParty: `/og/spelling-party.png?v=${OG_ASSET_VERSION}`,
  twin: `/og/twin.png?v=${OG_ASSET_VERSION}`,
} as const;

type SeoOptions = {
  title: string;
  description: string;
  path: string;
  image?: string;
  imageAlt?: string;
  type?: "website" | "article";
  robots?: "index, follow" | "noindex, nofollow";
  referrer?: "no-referrer";
  publishedTime?: string;
  modifiedTime?: string;
};

type SeoMetaDescriptor =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string };

function normaliseText(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function absoluteUrl(value: string): string {
  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return BASE_URL;
  }
}

function imageTypeForUrl(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
    if (path.endsWith(".webp")) return "image/webp";
  } catch {
    return "image/png";
  }
  return "image/png";
}

function buildSeoMeta(options: SeoOptions): SeoMetaDescriptor[] {
  const title = normaliseText(options.title, 70);
  const description = normaliseText(options.description, 160);
  const robots = options.robots ?? "index, follow";
  const baseMeta: SeoMetaDescriptor[] = [
    { title },
    { name: "description", content: description },
    { name: "robots", content: robots },
    ...(options.referrer ? [{ name: "referrer", content: options.referrer }] : []),
  ];

  // Capability and private routes opt out of indexing. They should not repeat
  // their credential-bearing URL in canonical or social metadata either.
  if (robots.startsWith("noindex")) return baseMeta;

  const url = absoluteUrl(options.path);
  const image = absoluteUrl(options.image ?? OG_IMAGES.default);
  const imageAlt = normaliseText(options.imageAlt ?? `${SITE_NAME} — ${title}`, 200);
  const type = options.type ?? "website";

  return [
    ...baseMeta,
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:type", content: type },
    { property: "og:image", content: image },
    { property: "og:image:secure_url", content: image },
    { property: "og:image:type", content: imageTypeForUrl(image) },
    { property: "og:image:width", content: OG_WIDTH },
    { property: "og:image:height", content: OG_HEIGHT },
    { property: "og:image:alt", content: imageAlt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: imageAlt },
    ...(options.type === "article" && options.publishedTime
      ? [{ property: "article:published_time", content: options.publishedTime }]
      : []),
    ...(options.type === "article" && options.modifiedTime
      ? [{ property: "article:modified_time", content: options.modifiedTime }]
      : []),
  ];
}

function buildSeoHead(options: SeoOptions) {
  const isIndexable = (options.robots ?? "index, follow") === "index, follow";
  return {
    meta: buildSeoMeta(options),
    links: isIndexable ? [{ rel: "canonical", href: absoluteUrl(options.path) }] : [],
  };
}

export {
  OG_IMAGES,
  OG_HEIGHT,
  OG_ASSET_VERSION,
  OG_WIDTH,
  absoluteUrl,
  buildSeoHead,
  buildSeoMeta,
};
