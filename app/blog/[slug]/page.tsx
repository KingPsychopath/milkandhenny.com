import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getPostBySlug, getAllSlugs } from "@/lib/blog";
import { PostBody } from "./PostBody";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};

  return {
    title: `${post.title} — Milk & Henny`,
    description: post.subtitle ?? `Read "${post.title}" on Milk & Henny`,
  };
}

/** Format a date string into a readable form */
function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) notFound();

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="max-w-2xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between font-mono text-sm">
          <Link
            href="/"
            className="text-stone-400 hover:text-foreground transition-colors tracking-tight"
          >
            ← back
          </Link>
          <Link
            href="/"
            className="font-bold text-foreground tracking-tighter hover:text-stone-500 transition-colors"
          >
            milk & henny
          </Link>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6">
        <div className="border-t border-stone-200" />
      </div>

      {/* Post */}
      <article className="max-w-2xl mx-auto px-6 pt-14 pb-24">
        <header className="mb-12">
          <time className="font-mono text-xs text-stone-400 tracking-wide">
            {formatDate(post.date)}
          </time>
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground leading-tight tracking-tight mt-4">
            {post.title}
          </h1>
          {post.subtitle && (
            <p className="mt-4 text-stone-500 text-lg leading-relaxed">
              {post.subtitle}
            </p>
          )}
        </header>

        <PostBody content={post.content} />
      </article>

      {/* Footer */}
      <footer className="border-t border-stone-200">
        <div className="max-w-2xl mx-auto px-6 py-8 flex items-center justify-between font-mono text-[11px] text-stone-400 tracking-wide">
          <Link
            href="/"
            className="hover:text-foreground transition-colors"
          >
            ← all posts
          </Link>
          <span>© {new Date().getFullYear()} milk & henny</span>
        </div>
      </footer>
    </div>
  );
}
