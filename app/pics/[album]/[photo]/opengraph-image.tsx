import { ImageResponse } from "next/og";
import { getAlbumBySlug, getAllAlbumSlugs } from "@/lib/albums";
import { getOriginalUrl } from "@/lib/storage";

export const alt = "milk & henny";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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

export default async function Image({ params }: Props) {
  const { album: albumSlug, photo: photoId } = await params;
  const album = getAlbumBySlug(albumSlug);
  if (!album) {
    return new ImageResponse(<div>Photo not found</div>, { ...size });
  }

  const photoUrl = getOriginalUrl(albumSlug, photoId);

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          background: "#1c1917",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl}
          alt={album.title}
          width={1200}
          height={630}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
            padding: 48,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <span
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "white",
              fontFamily: "monospace",
            }}
          >
            milk & henny · {album.title}
          </span>
          <span
            style={{
              fontSize: 16,
              color: "rgba(255,255,255,0.7)",
              fontFamily: "monospace",
            }}
          >
            {photoId}
          </span>
        </div>
      </div>
    ),
    { ...size }
  );
}
