import { NextResponse } from "next/server";
import { getAlbumBySlug, getAllAlbumSlugs } from "@/lib/media/albums";
import { getOgUrl } from "@/lib/media/storage";

import { SITE_BRAND } from "@/lib/config";

export const alt = SITE_BRAND;
export const size = { width: 1200, height: 630 };
export const contentType = "image/jpeg";

export function generateStaticParams() {
  const slugs = getAllAlbumSlugs();
  const params: { album: string; photo: string }[] = [];
  for (const slug of slugs) {
    const album = getAlbumBySlug(slug);
    if (!album) continue;
    for (const photo of album.photos) {
      params.push({ album: slug, photo: photo.id });
    }
  }
  return params;
}

type Props = {
  params: Promise<{ album: string; photo: string }>;
};

/**
 * Fetches the photo's og JPG from R2 and returns it directly.
 * The og variant is pre-processed at upload time: 1200×630 JPEG with
 * text overlay and mozjpeg compression (~100–200 KB).
 */
export default async function Image({ params }: Props) {
  const { album: albumSlug, photo: photoId } = await params;
  const album = getAlbumBySlug(albumSlug);
  if (!album) {
    return new NextResponse("Photo not found", { status: 404 });
  }

  const res = await fetch(getOgUrl(albumSlug, photoId));
  if (!res.ok) {
    return new NextResponse("OG image not found", { status: 404 });
  }

  const buffer = await res.arrayBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, s-maxage=86400, max-age=86400",
    },
  });
}

