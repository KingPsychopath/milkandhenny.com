import { Link, createFileRoute } from "@tanstack/react-router";
import { SiteFooter, SiteFooterBar } from "@/components/SiteFooter";
import type { Album } from "@/features/media/albums";
import { getAlbumsPageFn } from "@/features/media/albums.functions";
import { getAlbumImageData } from "@/features/media/storage";
import { imagePlaceholderStyle } from "@/features/media/image";
import { focalPresetToObjectPosition } from "@/features/media/focal";
import { SITE_NAME, SITE_BRAND } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AppImage } from "@/components/AppImage";

export const Route = createFileRoute("/pics/")({
  component: PicsPage,
  loader: () => getAlbumsPageFn(),
  head: () =>
    buildSeoHead({
      title: `Pics — ${SITE_NAME}`,
      description: "Browse photo albums from Milk & Henny events, parties, and nights out.",
      path: "/pics",
      image: OG_IMAGES.pics,
      imageAlt: "Pics — photo albums from Milk & Henny events and nights out",
    }),
});

/** Resolve cover photo's focal point to CSS object-position */
function getCoverPosition(album: Album): string | undefined {
  const cover = album.photos.find((p) => p.id === album.cover);
  if (!cover) return undefined;
  if (cover.focalPoint) return focalPresetToObjectPosition(cover.focalPoint);
  if (cover.autoFocal) return `${cover.autoFocal.x}% ${cover.autoFocal.y}%`;
  return undefined;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function PicsPage() {
  const albums = Route.useLoaderData();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="max-w-4xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-center font-mono text-sm">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center px-2 font-bold tracking-tighter text-foreground transition-opacity hover:opacity-70"
          >
            {SITE_BRAND}
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6">
        <div className="border-t theme-border" />
      </div>

      <main id="main" className="flex-1">
        <section className="max-w-4xl mx-auto px-6 pt-12 pb-8" aria-label="Page header">
          <Breadcrumbs items={[{ label: "home", href: "/" }, { label: "pics" }]} />
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground tracking-tight mt-2">
            pics
          </h1>
          <p className="mt-2 theme-muted font-mono text-sm">
            photos from the motives. click an album to browse.
          </p>
        </section>

        <section className="max-w-4xl mx-auto px-6 pb-24" aria-label="Albums">
          {albums.length === 0 ? (
            <p className="py-12 theme-muted font-mono text-sm text-center">
              no albums yet. check back soon.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {albums.map((album, albumIndex) => {
                const coverPos = getCoverPosition(album);
                const cover = album.photos.find((photo) => photo.id === album.cover);
                if (!cover) return null;
                const coverImage = getAlbumImageData(album.slug, cover);
                return (
                  <Link
                    key={album.slug}
                    to="/pics/$album"
                    params={{ album: album.slug }}
                    className="group block relative overflow-hidden rounded-sm aspect-[4/3]"
                  >
                    <div
                      className="media-image-placeholder absolute inset-0 gallery-placeholder overflow-hidden"
                      style={imagePlaceholderStyle(cover.placeholder)}
                    >
                      <AppImage
                        src={coverImage.src}
                        srcSet={coverImage.srcSet}
                        sources={coverImage.sources}
                        alt=""
                        width={cover.width}
                        height={cover.height}
                        reveal
                        priority={albumIndex === 0}
                        sizes="(min-width: 640px) 50vw, 100vw"
                        className="app-image-hover-scale h-full w-full object-cover group-hover:scale-[1.02]"
                        style={coverPos ? { objectPosition: coverPos } : undefined}
                      />
                    </div>

                    {/* Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

                    {/* Info */}
                    <div className="absolute bottom-0 left-0 right-0 p-5">
                      <h2 className="font-serif text-lg text-white leading-snug">{album.title}</h2>
                      <div className="flex items-center gap-3 mt-1 font-mono text-micro text-white/60 tracking-wide">
                        <span>{formatDate(album.date)}</span>
                        <span>·</span>
                        <span>{album.photos.length} photos</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <SiteFooter maxWidth="4xl">
        <SiteFooterBar
          leading={
            <Link to="/" className="hover:text-foreground transition-colors">
              ← home
            </Link>
          }
          trailing={
            <span className="whitespace-nowrap">
              © {new Date().getFullYear()} {SITE_BRAND}
            </span>
          }
        />
      </SiteFooter>
    </div>
  );
}
