import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAlbumBySlug } from "@/features/media/albums.server";
import {
  getFullUrl,
  getOgUrl,
  getOriginalStorageKey,
  getOriginalUrl,
} from "@/features/media/storage";
import { BASE_URL, SITE_NAME, SITE_BRAND } from "@/lib/shared/config";
import { PhotoViewer } from "@/features/media/components/PhotoViewer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Share } from "@/components/Share";
import { BrandedImage } from "@/features/media/components/BrandedImage";

const getPhoto = createServerFn({ method: "GET" })
  .validator((data: { album: string; photo: string }) => data)
  .handler(({ data }) => {
    const album = getAlbumBySlug(data.album);
    if (!album) throw notFound();
    const photoIndex = album.photos.findIndex((photo) => photo.id === data.photo);
    if (photoIndex === -1) throw notFound();
    return { album, photoIndex };
  });

export const Route = createFileRoute("/pics/$album/$photo")({
  component: PhotoPage,
  loader: ({ params }) => getPhoto({ data: params }),
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { album, photoIndex } = loaderData;
    const photo = album.photos[photoIndex];
    const description = `Photo ${photoIndex + 1} of ${album.photos.length} from ${album.title}`;
    return {
      meta: [
        { title: `${photo.id} — ${album.title} — ${SITE_NAME}` },
        { name: "description", content: description },
        { property: "og:title", content: `${album.title} — ${photo.id}` },
        { property: "og:description", content: description },
        { property: "og:image", content: getOgUrl(album.slug, photo.id) },
      ],
    };
  },
});

function PhotoPage() {
  const { album, photoIndex } = Route.useLoaderData();
  const albumSlug = album.slug;
  const photo = album.photos[photoIndex];
  const photoId = photo.id;
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
          <Link
            to="/pics/$album"
            params={{ album: albumSlug }}
            className="theme-muted hover:text-foreground transition-colors tracking-tight"
          >
            ← {album.title}
          </Link>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs theme-muted tabular-nums">
              {photoIndex + 1} / {album.photos.length}
            </span>
            <Share
              url={`${BASE_URL}/pics/${albumSlug}/${photoId}`}
              title={`${album.title} — ${photoId}`}
              label="Share this photo"
            />
          </div>
        </div>
      </header>

      <main id="main">
        <section className="max-w-5xl mx-auto px-4 pb-8" aria-label="Photo">
          <PhotoViewer
            src={getFullUrl(albumSlug, photoId)}
            downloadStorageKey={getOriginalStorageKey(albumSlug, photoId)}
            downloadUrl={getOriginalUrl(albumSlug, photoId)}
            filename={`${photoId}.jpg`}
            width={photo.width}
            height={photo.height}
            albumSlug={albumSlug}
            prevPhotoId={prevPhoto?.id}
            nextPhotoId={nextPhoto?.id}
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
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between font-mono text-micro theme-muted tracking-wide">
          <Link
            to="/pics/$album"
            params={{ album: albumSlug }}
            className="hover:text-foreground transition-colors"
          >
            ← back to album
          </Link>
          <span>
            © {new Date().getFullYear()} {SITE_BRAND}
          </span>
        </div>
      </footer>
    </div>
  );
}
