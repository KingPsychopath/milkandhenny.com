import type { Photo } from "./albums";

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
