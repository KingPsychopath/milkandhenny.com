import { ImageResponse } from "next/og";
import { getAlbumBySlug, getAllAlbumSlugs } from "@/lib/albums";
import { getOriginalUrl } from "@/lib/storage";

export const alt = "milk & henny";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return getAllAlbumSlugs().map((album) => ({ album }));
}

type Props = {
  params: Promise<{ album: string }>;
};

export default async function Image({ params }: Props) {
  const { album: slug } = await params;
  const album = getAlbumBySlug(slug);
  if (!album) {
    return new ImageResponse(<div>Album not found</div>, { ...size });
  }

  const coverUrl = getOriginalUrl(slug, album.cover);

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
          src={coverUrl}
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
            background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
            padding: 48,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <span
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: "white",
              fontFamily: "Georgia, serif",
            }}
          >
            {album.title}
          </span>
          <span
            style={{
              fontSize: 16,
              color: "rgba(255,255,255,0.7)",
              fontFamily: "monospace",
            }}
          >
            {album.photos.length} photos · milk & henny
          </span>
        </div>
      </div>
    ),
    { ...size }
  );
}
