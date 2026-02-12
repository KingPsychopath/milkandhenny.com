import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getAlbumBySlug, getAllAlbumSlugs } from "@/lib/albums";
import { getFullUrl, getOriginalUrl } from "@/lib/storage";
import { PhotoViewer } from "@/components/gallery/PhotoViewer";

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

  return {
    title: `${photoId} — ${album.title} — Milk & Henny`,
    description: `Photo ${photoIndex + 1} of ${album.photos.length} from ${album.title}`,
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
  const nextPhoto =
    photoIndex < album.photos.length - 1 ? album.photos[photoIndex + 1] : null;

  return (
    <div className="photo-page-fade-in min-h-screen bg-background">
      {/* Nav */}
      <header className="max-w-4xl mx-auto px-6 pt-6 pb-4">
        <div className="flex items-center justify-between font-mono text-sm">
          <Link
            href={`/pics/${albumSlug}`}
            className="theme-muted hover:text-foreground transition-colors tracking-tight"
          >
            ← {album.title}
          </Link>
          <span className="font-mono text-xs theme-muted">
            {photoIndex + 1} / {album.photos.length}
          </span>
        </div>
      </header>

      {/* Photo */}
      <section className="max-w-5xl mx-auto px-4 pb-8">
        <PhotoViewer
          src={getFullUrl(albumSlug, photoId)}
          downloadUrl={getOriginalUrl(albumSlug, photoId)}
          filename={`${photoId}.jpg`}
          width={photo.width}
          height={photo.height}
          prevHref={prevPhoto ? `/pics/${albumSlug}/${prevPhoto.id}` : undefined}
          nextHref={nextPhoto ? `/pics/${albumSlug}/${nextPhoto.id}` : undefined}
        />
      </section>

      {/* Footer */}
      <footer className="theme-border border-t">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between font-mono text-[11px] theme-muted tracking-wide">
          <Link href={`/pics/${albumSlug}`} className="hover:text-foreground transition-colors">
            ← back to album
          </Link>
          <Link href={`/pics/${albumSlug}`} className="hover:text-foreground transition-colors">
            view album →
          </Link>
        </div>
      </footer>
    </div>
  );
}
