import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getAlbumBySlug, getAllAlbumSlugs } from "@/features/media/albums";
import { SITE_NAME, SITE_BRAND } from "@/lib/shared/config";
import { AlbumGallery } from "../_components/AlbumGallery";
import { Breadcrumbs } from "@/components/Breadcrumbs";

type Props = {
  params: Promise<{ album: string }>;
};

export async function generateStaticParams() {
  return getAllAlbumSlugs().map((album) => ({ album }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { album: slug } = await params;
  const album = getAlbumBySlug(slug);
  if (!album) return {};

  const description = album.description ?? `${album.photos.length} photos from ${album.title}`;

  return {
    title: `${album.title} — Pics — ${SITE_NAME}`,
    description,
    openGraph: {
      title: album.title,
      description,
      url: `/pics/${slug}`,
      siteName: SITE_NAME,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: album.title,
      description,
    },
  };
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function AlbumPage({ params }: Props) {
  const { album: slug } = await params;
  const album = getAlbumBySlug(slug);

  if (!album) notFound();

  return (
    <div className="min-h-screen bg-background">
      <header role="banner" className="max-w-4xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between font-mono text-sm">
          <Link href="/pics" className="theme-muted hover:text-foreground transition-colors tracking-tight">
            ← albums
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
          {album.description && <p className="mt-3 theme-subtle text-lg leading-relaxed">{album.description}</p>}
        </section>

        <section className="max-w-4xl mx-auto px-6 pb-24" aria-label="Gallery">
          <AlbumGallery albumSlug={album.slug} photos={album.photos} />
        </section>
      </main>

      <footer role="contentinfo" className="border-t theme-border">
        <div className="max-w-4xl mx-auto px-6 py-8 flex items-center justify-between font-mono text-micro theme-muted tracking-wide">
          <Link href="/pics" className="hover:text-foreground transition-colors">
            ← all albums
          </Link>
          <span>© {new Date().getFullYear()} {SITE_BRAND}</span>
        </div>
      </footer>
    </div>
  );
}
