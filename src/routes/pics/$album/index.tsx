import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { JourneyRail } from "@/components/SiteFooter";
import { getAlbumBySlug, getAllAlbums } from "@/features/media/albums.server";
import { getOgUrl } from "@/features/media/storage";
import { SITE_NAME, SITE_BRAND } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";
import { AlbumGallery } from "@/features/media/components/AlbumGallery";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const getAlbum = createServerFn({ method: "GET" })
  .validator((data: { album: string }) => data)
  .handler(async ({ data }) => {
    const album = await getAlbumBySlug(data.album);
    if (!album) throw notFound();
    const albums = await getAllAlbums();
    const currentIndex = albums.findIndex((item) => item.slug === album.slug);
    const olderAlbum = albums[currentIndex + 1];
    const newerAlbum = currentIndex > 0 ? albums[currentIndex - 1] : undefined;
    return {
      album,
      olderAlbum: olderAlbum ? { slug: olderAlbum.slug, title: olderAlbum.title } : null,
      newerAlbum: newerAlbum ? { slug: newerAlbum.slug, title: newerAlbum.title } : null,
    };
  });

export const Route = createFileRoute("/pics/$album/")({
  component: AlbumPage,
  loader: ({ params }) => getAlbum({ data: params }),
  head: ({ loaderData }) => {
    const album = loaderData?.album;
    if (!album) {
      return buildSeoHead({
        title: `Album — ${SITE_NAME}`,
        description: "A Milk & Henny photo album.",
        path: "/pics",
        robots: "noindex, nofollow",
      });
    }
    const description = album.description ?? `${album.photos.length} photos from ${album.title}`;
    const coverPhoto = album.photos.find((photo) => photo.id === album.cover);
    return buildSeoHead({
      title: `${album.title} — Pics — ${SITE_NAME}`,
      description,
      path: `/pics/${album.slug}`,
      image: getOgUrl(album.slug, album.cover, coverPhoto?.version),
      imageAlt: `${album.title} — Milk & Henny photos`,
    });
  },
});

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function AlbumPage() {
  const { album, olderAlbum, newerAlbum } = Route.useLoaderData();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="max-w-4xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between font-mono text-sm">
          <Link
            to="/pics"
            className="theme-muted hover:text-foreground transition-colors tracking-tight"
          >
            ← albums
          </Link>
          <Link
            to="/"
            className="font-bold text-foreground tracking-tighter hover:opacity-70 transition-opacity"
          >
            {SITE_BRAND}
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6">
        <div className="border-t theme-border" />
      </div>

      <main id="main" className="flex-1">
        <section className="max-w-4xl mx-auto px-6 pt-12 pb-8" aria-label="Album info">
          <Breadcrumbs
            items={[
              { label: "home", href: "/" },
              { label: "pics", href: "/pics" },
              { label: album.title },
            ]}
          />
          <div className="flex items-center gap-3 font-mono text-xs theme-muted tracking-wide mt-2">
            <time>{formatDate(album.date)}</time>
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground leading-tight tracking-tight mt-3">
            {album.title}
          </h1>
          {album.description && (
            <p className="mt-3 theme-subtle text-lg leading-relaxed">{album.description}</p>
          )}
        </section>

        <section className="max-w-4xl mx-auto px-6 pb-24" aria-label="Gallery">
          <AlbumGallery albumSlug={album.slug} albumTitle={album.title} photos={album.photos} />
        </section>
      </main>

      <JourneyRail
        maxWidth="4xl"
        trailing={
          olderAlbum || newerAlbum ? (
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 md:justify-end">
              {olderAlbum ? (
                <Link
                  to="/pics/$album"
                  params={{ album: olderAlbum.slug }}
                  className="max-w-[14rem] truncate hover:text-foreground transition-colors"
                >
                  ← older · {olderAlbum.title}
                </Link>
              ) : null}
              {newerAlbum ? (
                <Link
                  to="/pics/$album"
                  params={{ album: newerAlbum.slug }}
                  className="max-w-[14rem] truncate hover:text-foreground transition-colors"
                >
                  {newerAlbum.title} · newer →
                </Link>
              ) : null}
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
