import { NextResponse } from "next/server";
import { getAlbumBySlug, getAllAlbumSlugs } from "@/lib/albums";
import { getOgUrl } from "@/lib/storage";

export const alt = "milk & henny";
export const size = { width: 1200, height: 630 };
export const contentType = "image/jpeg";

export function generateStaticParams() {
  return getAllAlbumSlugs().map((album) => ({ album }));
}

type Props = {
  params: Promise<{ album: string }>;
};

/**
 * Fetches the cover photo's og JPG from R2 and returns it directly.
 * The og variant is pre-processed at upload time: 1200×630 JPEG with
 * text overlay and mozjpeg compression (~100–200 KB).
 */
export default async function Image({ params }: Props) {
  const { album: slug } = await params;
  const album = getAlbumBySlug(slug);
  if (!album) {
    return new NextResponse("Album not found", { status: 404 });
  }

  const res = await fetch(getOgUrl(slug, album.cover));
  if (!res.ok) {
    return new NextResponse("OG image not found", { status: 404 });
  }

  const buffer = await res.arrayBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
