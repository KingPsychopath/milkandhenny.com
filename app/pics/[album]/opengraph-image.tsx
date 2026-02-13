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
 * Redirects to the cover photo's og JPG in R2 (~80–150 KB).
 * ImageResponse outputs PNG (~1 MB); redirect keeps WhatsApp/social limits (< 600 KB).
 */
export default async function Image({ params }: Props) {
  const { album: slug } = await params;
  const album = getAlbumBySlug(slug);
  if (!album) {
    return new NextResponse("Album not found", { status: 404 });
  }

  return NextResponse.redirect(getOgUrl(slug, album.cover));
}
