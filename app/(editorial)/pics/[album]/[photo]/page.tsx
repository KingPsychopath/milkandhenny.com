import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getAlbumBySlug, getAllAlbumSlugs } from "@/lib/media/albums";
import { getFullUrl, getOriginalUrl } from "@/lib/media/storage";
import { BASE_URL, SITE_NAME, SITE_BRAND } from "@/lib/shared/config";
import { PhotoViewer } from "../../_components/PhotoViewer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Share } from "@/components/Share";
import { BrandedImage } from "../../_components/BrandedImage";

type Props = {
  params: Promise<{ album: string; photo: string }>;
};

export async function generateStaticParams() {
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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { album: albumSlug, photo: photoId } = await params;
  const album = getAlbumBySlug(albumSlug);
  if (!album) return {};

  const photoIndex = album.photos.findIndex((p) => p.id === photoId);
  const description = `Photo ${photoIndex + 1} of ${album.photos.length} from ${album.title}`;

  const ogImageAlt = `Photo ${photoId} from album ${album.title}. ${SITE_NAME}.`;

  return {
    title: `${photoId} — ${album.title} — ${SITE_NAME}`,
    description,
    openGraph: {
      title: `${album.title} — ${photoId}`,
      description,
      url: `/pics/${albumSlug}/${photoId}`,
      siteName: SITE_NAME,
      type: "website",
      images: [
        {
          url: `/pics/${albumSlug}/${photoId}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: ogImageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${album.title} — ${photoId}`,
      description,
    },
  };
}

export default async function PhotoPage({ params }: Props) {
  const { album: albumSlug, photo: photoId } = await params;
  const album = getAlbumBySlug(albumSlug);

  if (!album) notFound();

  const photoIndex = album.photos.findIndex((p) => p.id === photoId);
  if (photoIndex === -1) notFound();

  const photo = album.photos[photoIndex];
  const prevPhoto = photoIndex > 0 ? album.photos[photoIndex - 1] : null;
  const nextPhoto = photoIndex < album.photos.length - 1 ? album.photos[photoIndex + 1] : null;

  return (
    <div className="min-h-screen bg-background">
      <header role="banner" className="max-w-4xl mx-auto px-6 pt-6 pb-4">
        <Breadcrumbs
          items={[
            { label: "home", href: "/" },
            { label: "pics", href: "/pics" },
            { label: album.title, href: `/pics/${albumSlug}` },
            { label: photoId },
          ]}
        />
        <div className="flex flex-col gap-3 mt-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 font-mono text-sm">
          <Link href={`/pics/${albumSlug}`} className="theme-muted hover:text-foreground transition-colors tracking-tight">
            ← {album.title}
          </Link>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs theme-muted tabular-nums">
              {photoIndex + 1} / {album.photos.length}
            </span>
            <Share url={`${BASE_URL}/pics/${albumSlug}/${photoId}`} title={`${album.title} — ${photoId}`} label="Share this photo" />
          </div>
        </div>
      </header>

      <main id="main">
        <section className="max-w-5xl mx-auto px-4 pb-8" aria-label="Photo">
          <PhotoViewer
            src={getFullUrl(albumSlug, photoId)}
            downloadUrl={getOriginalUrl(albumSlug, photoId)}
            filename={`${photoId}.jpg`}
            width={photo.width}
            height={photo.height}
            prevHref={prevPhoto ? `/pics/${albumSlug}/${prevPhoto.id}` : undefined}
            nextHref={nextPhoto ? `/pics/${albumSlug}/${nextPhoto.id}` : undefined}
            preloadNext={nextPhoto ? getFullUrl(albumSlug, nextPhoto.id) : undefined}
            preloadPrev={prevPhoto ? getFullUrl(albumSlug, prevPhoto.id) : undefined}
            blur={photo.blur}
            actions={
              <BrandedImage
                imageUrl={getFullUrl(albumSlug, photoId)}
                albumTitle={album.title}
                photoId={photoId}
                focalPoint={photo.focalPoint}
                autoFocal={photo.autoFocal}
              />
            }
          />
        </section>
      </main>

      <footer role="contentinfo" className="theme-border border-t">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between font-mono text-[11px] theme-muted tracking-wide">
          <Link href={`/pics/${albumSlug}`} className="hover:text-foreground transition-colors">
            ← back to album
          </Link>
          <span>© {new Date().getFullYear()} {SITE_BRAND}</span>
        </div>
      </footer>
    </div>
  );
}

