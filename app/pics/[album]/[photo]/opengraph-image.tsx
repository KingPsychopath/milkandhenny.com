import { NextResponse } from "next/server";
import { getAlbumBySlug, getAllAlbumSlugs } from "@/lib/albums";
import { getOgUrl } from "@/lib/storage";

export const alt = "milk & henny";
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
 * Redirects to the photo's og JPG in R2 (~80–150 KB).
 * ImageResponse outputs PNG (~1 MB); redirect keeps WhatsApp/social limits (< 600 KB).
 */
export default async function Image({ params }: Props) {
  const { album: albumSlug, photo: photoId } = await params;
  const album = getAlbumBySlug(albumSlug);
  if (!album) {
    return new NextResponse("Photo not found", { status: 404 });
  }

  return NextResponse.redirect(getOgUrl(albumSlug, photoId));
}
