import Link from "next/link";
import type { Metadata } from "next";
import { getAllAlbums, type Album } from "@/features/media/albums";
import { getThumbUrl } from "@/features/media/storage";
import { focalPresetToObjectPosition } from "@/features/media/focal";
import { SITE_NAME, SITE_BRAND } from "@/lib/shared/config";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export const metadata: Metadata = {
  title: `Pics — ${SITE_NAME}`,
  description: "Photos from the motives.",
  openGraph: {
    title: "Pics",
    description: "Photos from the motives.",
    url: "/pics",
    siteName: SITE_NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `Pics — ${SITE_NAME}`,
    description: "Photos from the motives.",
  },
};

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
  });
}

export default function PicsPage() {
  const albums = getAllAlbums();

  return (
    <div className="min-h-screen bg-background">
      <header role="banner" className="max-w-4xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between font-mono text-sm">
          <Link href="/" className="theme-muted hover:text-foreground transition-colors tracking-tight">
            ← home
          </Link>
          <Link href="/" className="font-bold text-foreground tracking-tighter hover:opacity-70 transition-opacity">
            {SITE_BRAND}
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6">
        <div className="border-t theme-border" />
      </div>

      <main id="main">
        <section className="max-w-4xl mx-auto px-6 pt-12 pb-8" aria-label="Page header">
          <Breadcrumbs items={[{ label: "home", href: "/" }, { label: "pics" }]} />
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground tracking-tight mt-2">pics</h1>
          <p className="mt-2 theme-muted font-mono text-sm">photos from the motives. click an album to browse.</p>
        </section>

        <section className="max-w-4xl mx-auto px-6 pb-24" aria-label="Albums">
          {albums.length === 0 ? (
            <p className="py-12 theme-muted font-mono text-sm text-center">no albums yet. check back soon.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {albums.map((album) => {
                const coverPos = getCoverPosition(album);
                return (
                  <Link
                    key={album.slug}
                    href={`/pics/${album.slug}`}
                    className="group block relative overflow-hidden rounded-sm aspect-[4/3]"
                  >
                    {/* Cover image — placeholder shows until image paints */}
                    <div className="absolute inset-0 gallery-placeholder overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getThumbUrl(album.slug, album.cover)}
                        alt={album.title}
                        className="w-full h-full object-cover album-cover-zoom group-hover:scale-[1.02]"
                        style={coverPos ? { objectPosition: coverPos } : undefined}
                        loading="lazy"
                      />
                    </div>

                    {/* Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

                    {/* Info */}
                    <div className="absolute bottom-0 left-0 right-0 p-5">
                      <h2 className="font-serif text-lg text-white leading-snug">{album.title}</h2>
                      <div className="flex items-center gap-3 mt-1 font-mono text-[11px] text-white/60 tracking-wide">
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

      <footer role="contentinfo" className="border-t theme-border">
        <div className="max-w-4xl mx-auto px-6 py-8 flex items-center justify-between font-mono text-[11px] theme-muted tracking-wide">
          <Link href="/" className="hover:text-foreground transition-colors">
            ← home
          </Link>
          <span>© {new Date().getFullYear()} {SITE_BRAND}</span>
        </div>
      </footer>
    </div>
  );
}

