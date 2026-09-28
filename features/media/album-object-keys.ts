import type { Photo } from "./albums";
import {
  MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL,
  VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL,
} from "@/lib/shared/media-cache";

export function publicObjectMetadata(key: string): { contentType: string; cacheControl: string } {
  if (key.endsWith(".avif"))
    return { contentType: "image/avif", cacheControl: VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL };
  if (key.endsWith(".webp"))
    return { contentType: "image/webp", cacheControl: VERSIONED_PUBLIC_MEDIA_CACHE_CONTROL };
  return { contentType: "image/jpeg", cacheControl: MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL };
}

export function publicPhotoKeys(slug: string, photo: Pick<Photo, "id" | "widths">): string[] {
  return [
    ...photo.widths.flatMap((width) =>
      (["avif", "webp"] as const).map(
        (format) => `albums/${slug}/images/${photo.id}/${width}.${format}`,
      ),
    ),
    `albums/${slug}/og/${photo.id}.jpg`,
  ];
}

export function privatePhotoKeys(slug: string, photo: Pick<Photo, "id" | "widths">): string[] {
  return [...publicPhotoKeys(slug, photo), `albums/${slug}/original/${photo.id}.jpg`];
}
