import { MEDIA_PUBLIC_URL } from "@/lib/shared/config";
import type {
  ResponsiveImageData,
  ResponsiveImageFormat,
  ResponsiveImageMetadata,
  ResponsiveImageSource,
} from "@/features/media/image";
import type { WordMediaTarget } from "./upload";

const WORD_IMAGE_MANIFEST_FILENAME = "_images.json";
const WORD_IMAGE_VARIANT_DIRECTORY = "_responsive";

type WordImageManifest = Record<string, ResponsiveImageMetadata>;

interface WordImageLocation {
  target: WordMediaTarget;
  filename: string;
  canonicalRef: string;
}

function wordImageManifestKey(target: WordMediaTarget): string {
  return `${target.scope === "asset" ? `words/assets/${target.assetId}` : `words/media/${target.slug}`}/${WORD_IMAGE_MANIFEST_FILENAME}`;
}

function wordImageVariantKey(
  target: WordMediaTarget,
  filename: string,
  width: number,
  format: ResponsiveImageFormat,
): string {
  const prefix =
    target.scope === "asset" ? `words/assets/${target.assetId}` : `words/media/${target.slug}`;
  const stem = filename.replace(/\.[^.]+$/, "");
  return `${prefix}/${WORD_IMAGE_VARIANT_DIRECTORY}/${stem}/${width}.${format}`;
}

function isWordImageInternalKey(key: string): boolean {
  return (
    key.endsWith(`/${WORD_IMAGE_MANIFEST_FILENAME}`) ||
    key.includes(`/${WORD_IMAGE_VARIANT_DIRECTORY}/`)
  );
}

function parseWordImageLocation(ref: string, wordSlug?: string): WordImageLocation | null {
  const trimmed = ref.trim().replace(/^\/+/, "");
  if (
    !trimmed ||
    trimmed.includes("..") ||
    /^(?:https?:|data:|javascript:|vbscript:)/i.test(trimmed)
  ) {
    return null;
  }

  const wordMatch = trimmed.match(
    /^words\/media\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9-]+\.[a-z0-9]{1,8})$/i,
  );
  if (wordMatch) {
    const [, slug, filename] = wordMatch;
    return {
      target: { scope: "word", slug },
      filename,
      canonicalRef: `words/media/${slug}/${filename}`,
    };
  }

  const assetMatch = trimmed.match(
    /^words\/assets\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9-]+\.[a-z0-9]{1,8})$/i,
  );
  if (assetMatch) {
    const [, assetId, filename] = assetMatch;
    return {
      target: { scope: "asset", assetId },
      filename,
      canonicalRef: `words/assets/${assetId}/${filename}`,
    };
  }

  const shortAssetMatch = trimmed.match(
    /^assets\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9-]+\.[a-z0-9]{1,8})$/i,
  );
  if (shortAssetMatch) {
    const [, assetId, filename] = shortAssetMatch;
    return {
      target: { scope: "asset", assetId },
      filename,
      canonicalRef: `words/assets/${assetId}/${filename}`,
    };
  }

  if (wordSlug && /^[a-z0-9-]+\.[a-z0-9]{1,8}$/i.test(trimmed)) {
    return {
      target: { scope: "word", slug: wordSlug },
      filename: trimmed,
      canonicalRef: `words/media/${wordSlug}/${trimmed}`,
    };
  }

  return null;
}

function wordImageData(
  location: WordImageLocation,
  metadata: ResponsiveImageMetadata,
  privacy: "public" | "private",
): ResponsiveImageData {
  const urlFor = (width: number, format: ResponsiveImageFormat) => {
    if (privacy === "private" && location.target.scope === "word") {
      const params = new URLSearchParams({ width: String(width), format, v: metadata.version });
      return `/api/words/${encodeURIComponent(location.target.slug)}/media/${encodeURIComponent(location.filename)}?${params}`;
    }
    const key = wordImageVariantKey(location.target, location.filename, width, format);
    return `${MEDIA_PUBLIC_URL}/${key}?v=${encodeURIComponent(metadata.version)}`;
  };
  const srcSetFor = (format: ResponsiveImageFormat) =>
    metadata.widths.map((width) => `${urlFor(width, format)} ${width}w`).join(", ");
  const largestWidth = metadata.widths.at(-1) ?? metadata.width;
  const sources: ResponsiveImageSource[] = [{ type: "image/avif", srcSet: srcSetFor("avif") }];

  return {
    ...metadata,
    src: urlFor(largestWidth, "webp"),
    srcSet: srcSetFor("webp"),
    sources,
  };
}

function extractMarkdownImageRefs(markdown: string): string[] {
  return [...markdown.matchAll(/!\[[^\]]*]\((\S+)(?:\s+["'][^"']*["'])?\)/g)].map(
    (match) => match[1],
  );
}

export {
  WORD_IMAGE_MANIFEST_FILENAME,
  WORD_IMAGE_VARIANT_DIRECTORY,
  extractMarkdownImageRefs,
  isWordImageInternalKey,
  parseWordImageLocation,
  wordImageData,
  wordImageManifestKey,
  wordImageVariantKey,
};

export type { WordImageLocation, WordImageManifest };
