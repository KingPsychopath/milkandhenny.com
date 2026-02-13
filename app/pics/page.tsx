import Link from "next/link";
import type { Metadata } from "next";
import { getAllAlbums } from "@/lib/albums";
import { getThumbUrl } from "@/lib/storage";

export const metadata: Metadata = {
  title: "Pics — Milk & Henny",
  description: "Photos from the motives.",
};

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
      {/* Nav */}
      <header className="max-w-4xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between font-mono text-sm">
          <Link
            href="/"
            className="theme-muted hover:text-foreground transition-colors tracking-tight"
          >
            ← home
          </Link>
          <Link
            href="/"
            className="font-bold text-foreground tracking-tighter hover:opacity-70 transition-opacity"
          >
            milk & henny
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6">
        <div className="border-t theme-border" />
      </div>

      {/* Header */}
      <section className="max-w-4xl mx-auto px-6 pt-12 pb-8">
        <h1 className="font-serif text-3xl sm:text-4xl text-foreground tracking-tight">
          pics
        </h1>
        <p className="mt-2 theme-muted font-mono text-sm">
          photos from the motives. click an album to browse.
        </p>
      </section>

      {/* Albums */}
      <section className="max-w-4xl mx-auto px-6 pb-24">
        {albums.length === 0 ? (
          <p className="py-12 theme-muted font-mono text-sm text-center">
            no albums yet. check back soon.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {albums.map((album) => (
              <Link
                key={album.slug}
                href={`/pics/${album.slug}`}
                className="group block relative overflow-hidden rounded-sm aspect-[4/3]"
              >
                {/* Cover image — placeholder shows until image paints */}
                <div className="absolute inset-0 gallery-placeholder">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getThumbUrl(album.slug, album.cover)}
                    alt={album.title}
                    className="w-full h-full object-cover photo-page-fade-in transition-transform duration-500 group-hover:scale-[1.02]"
                    loading="lazy"
                  />
                </div>

                {/* Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

                {/* Info */}
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <h2 className="font-serif text-lg text-white leading-snug">
                    {album.title}
                  </h2>
                  <div className="flex items-center gap-3 mt-1 font-mono text-[11px] text-white/60 tracking-wide">
                    <span>{formatDate(album.date)}</span>
                    <span>·</span>
                    <span>{album.photos.length} photos</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t theme-border">
        <div className="max-w-4xl mx-auto px-6 py-8 flex items-center justify-between font-mono text-[11px] theme-muted tracking-wide">
          <Link href="/" className="hover:text-foreground transition-colors">
            ← home
          </Link>
          <span>© {new Date().getFullYear()} milk & henny</span>
        </div>
      </footer>
    </div>
  );
}
