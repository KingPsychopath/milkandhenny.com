import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { JourneyRail } from "@/components/SiteFooter";
import { getAlbumBySlug } from "@/features/media/albums.server";
import {
  getAlbumImageData,
  getOgUrl,
  getOriginalStorageKey,
  getOriginalUrl,
} from "@/features/media/storage";
import { BASE_URL, SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";
import { PhotoViewer } from "@/features/media/components/PhotoViewer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Share } from "@/components/Share";
import { BrandedImage } from "@/features/media/components/BrandedImage";

const getPhoto = createServerFn({ method: "GET" })
  .validator((data: { album: string; photo: string }) => data)
  .handler(async ({ data }) => {
    const album = await getAlbumBySlug(data.album);
    if (!album) throw notFound();
    const photoIndex = album.photos.findIndex((photo) => photo.id === data.photo);
    if (photoIndex === -1) throw notFound();
    return { album, photoIndex };
  });

export const Route = createFileRoute("/pics/$album/$photo")({
  component: PhotoPage,
  loader: ({ params }) => getPhoto({ data: params }),
  head: ({ loaderData }) => {
    if (!loaderData) {
      return buildSeoHead({
        title: `Photo — ${SITE_NAME}`,
        description: "A Milk & Henny photo.",
        path: "/pics",
        robots: "noindex, nofollow",
      });
    }
    const { album, photoIndex } = loaderData;
    const photo = album.photos[photoIndex];
    const description = `Photo ${photoIndex + 1} of ${album.photos.length} from ${album.title}`;
    return buildSeoHead({
      title: `${photo.id} — ${album.title} — ${SITE_NAME}`,
      description,
      path: `/pics/${album.slug}/${photo.id}`,
      image: getOgUrl(album.slug, photo.id, photo.version),
      imageAlt: `${album.title}, photo ${photoIndex + 1} — Milk & Henny photos`,
    });
  },
});

function PhotoPage() {
  const { album, photoIndex } = Route.useLoaderData();
  const albumSlug = album.slug;
  const photo = album.photos[photoIndex];
  const photoId = photo.id;
  const prevPhoto = photoIndex > 0 ? album.photos[photoIndex - 1] : null;
  const nextPhoto = photoIndex < album.photos.length - 1 ? album.photos[photoIndex + 1] : null;
  const image = getAlbumImageData(albumSlug, photo);
  const nextImage = nextPhoto ? getAlbumImageData(albumSlug, nextPhoto) : undefined;
  const alt = photo.alt ?? `Photo ${photoIndex + 1} of ${album.photos.length} from ${album.title}`;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="max-w-4xl mx-auto px-6 pt-6 pb-4">
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

      <main id="main" className="flex-1">
        <section className="max-w-5xl mx-auto px-4 pb-8" aria-label="Photo">
          <PhotoViewer
            image={image}
            alt={alt}
            downloadStorageKey={getOriginalStorageKey(albumSlug, photoId)}
            downloadUrl={getOriginalUrl(albumSlug, photoId)}
            filename={`${photoId}.jpg`}
            albumSlug={albumSlug}
            prevPhotoId={prevPhoto?.id}
            nextPhotoId={nextPhoto?.id}
            preloadNext={nextImage}
            actions={
              <BrandedImage
                imageUrl={image.src}
                albumTitle={album.title}
                photoId={photoId}
                focalPoint={photo.focalPoint}
                autoFocal={photo.autoFocal}
              />
            }
          />
          {photo.title || photo.caption ? (
            <div className="mx-auto mt-5 max-w-2xl border-t theme-border pt-4">
              {photo.title ? <h1 className="font-serif text-xl">{photo.title}</h1> : null}
              {photo.caption ? (
                <p className="mt-2 font-serif leading-relaxed theme-subtle">{photo.caption}</p>
              ) : null}
            </div>
          ) : null}
        </section>
      </main>

      <JourneyRail
        maxWidth="4xl"
        trailing={
          prevPhoto || nextPhoto ? (
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 md:justify-end">
              {prevPhoto ? (
                <Link
                  to="/pics/$album/$photo"
                  params={{ album: albumSlug, photo: prevPhoto.id }}
                  className="hover:text-foreground transition-colors"
                >
                  ← previous
                </Link>
              ) : null}
              {nextPhoto ? (
                <Link
                  to="/pics/$album/$photo"
                  params={{ album: albumSlug, photo: nextPhoto.id }}
                  className="hover:text-foreground transition-colors"
                >
                  next →
                </Link>
              ) : null}
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
