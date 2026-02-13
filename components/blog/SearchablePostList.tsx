"use client";

import { useMemo, useState, useCallback } from "react";
import Link from "next/link";
import type { BlogPostSummary } from "@/lib/blog";

/** Format a date string into "7 Feb 2026" */
function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Case-insensitive match: query tokens must all appear in searchText */
function matchesSearch(searchText: string, query: string): boolean {
  if (!query.trim()) return true;
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const lower = searchText.toLowerCase();
  return tokens.every((t) => lower.includes(t));
}

type Props = {
  posts: BlogPostSummary[];
};

export function SearchablePostList({ posts }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return posts;
    return posts.filter((p) => matchesSearch(p.searchText, query));
  }, [posts, query]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  }, []);

  return (
    <section className="space-y-8">
      {/* Search */}
      <div className="relative">
        <label htmlFor="blog-search" className="sr-only">
          Search posts
        </label>
        <input
          id="blog-search"
          type="search"
          value={query}
          onChange={handleChange}
          placeholder="what are you looking for?"
          autoComplete="off"
          aria-describedby={query ? "search-results-count" : undefined}
          className="w-full font-mono text-sm theme-muted bg-transparent border-b theme-border focus:outline-none focus:border-foreground pb-2 pr-8 transition-colors placeholder:theme-faint"
        />
        <span
          aria-hidden
          className="absolute right-0 bottom-2.5 text-[11px] theme-faint font-mono"
        >
          {query ? "↗" : "⌘"}
        </span>
      </div>

      {/* Results */}
      <div id="search-results-count" className="sr-only" aria-live="polite">
        {query &&
          (filtered.length === 0
            ? "No posts match your search."
            : `${filtered.length} post${filtered.length === 1 ? "" : "s"} found.`)}
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="font-serif text-foreground/80 italic">
            {query
              ? "nothing here matches. try different words — or write them yourself."
              : "no posts yet. check back soon."}
          </p>
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-4 font-mono text-xs theme-muted hover:text-foreground transition-colors"
            >
              clear search
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-0">
          {filtered.map((post) => (
            <article key={post.slug} className="group">
              <Link
                href={`/blog/${post.slug}`}
                className="block py-6 border-b theme-border-faint hover:theme-border-strong transition-colors"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="font-serif text-xl sm:text-2xl text-foreground group-hover:opacity-70 transition-opacity leading-snug">
                    {post.title}
                  </h2>
                  <span className="font-mono text-xs theme-muted shrink-0 tabular-nums whitespace-nowrap">
                    {post.readingTime} min · {formatDate(post.date)}
                  </span>
                </div>
                {post.subtitle && (
                  <p className="mt-2 theme-subtle text-[0.95rem] leading-relaxed">
                    {post.subtitle}
                  </p>
                )}
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
