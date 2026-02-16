"use client";

import { useMemo, useState, useCallback } from "react";
import type { BlogPostSummary } from "@/lib/blog";
import { PostListItem } from "../../_components/PostListItem";

const DEFAULT_PAGE_SIZE = 10;

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
  const [visibleCount, setVisibleCount] = useState(DEFAULT_PAGE_SIZE);

  const filtered = useMemo(() => {
    if (!query.trim()) return posts;
    return posts.filter((p) => matchesSearch(p.searchText, query));
  }, [posts, query]);

  const visible = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );
  const hasMore = filtered.length > visibleCount;

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setVisibleCount(DEFAULT_PAGE_SIZE);
  }, []);

  const showMore = useCallback(() => {
    setVisibleCount((n) => Math.min(n + DEFAULT_PAGE_SIZE, filtered.length));
  }, [filtered.length]);

  const resultsLabel =
    query &&
    (filtered.length === 0
      ? "no matches"
      : `${filtered.length} post${filtered.length === 1 ? "" : "s"}`);

  return (
    <section className="space-y-8">
      {/* Search — count on own line so input width stays fixed */}
      <div>
        <div className="relative">
          <label htmlFor="blog-search" className="sr-only">
            Search posts
          </label>
          <input
            id="blog-search"
            type="text"
            role="search"
            value={query}
            onChange={handleChange}
            placeholder="what are you looking for?"
            autoComplete="off"
            aria-describedby={query ? "search-results-count" : undefined}
            className="search-input w-full font-mono text-sm theme-muted bg-transparent border-b theme-border py-3 pr-12 transition-colors placeholder:theme-faint [&::-ms-clear]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-0 top-0 bottom-0 flex items-center justify-center min-w-11 w-11 text-[15px] leading-none theme-faint hover:text-foreground active:text-foreground transition-colors font-mono touch-manipulation"
            >
              ×
            </button>
          ) : (
            <span
              aria-hidden
              className="absolute right-0 top-0 bottom-0 flex items-center justify-center w-11 pointer-events-none text-[11px] theme-faint font-mono"
            >
              ⌘
            </span>
          )}
        </div>
        {query && (
          <p
            id="search-results-count"
            className="mt-1.5 font-mono text-[11px] theme-faint"
            aria-live="polite"
          >
            {resultsLabel}
          </p>
        )}
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
        <>
          <div className="space-y-0">
            {visible.map((post) => (
              <PostListItem key={post.slug} {...post} />
            ))}
          </div>
          {hasMore && (
            <div className="pt-6">
              <button
                type="button"
                onClick={showMore}
                className="font-mono text-xs theme-muted hover:text-foreground transition-colors"
              >
                show more ({filtered.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

