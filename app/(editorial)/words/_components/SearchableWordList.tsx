"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { PostListItem } from "@/app/(editorial)/_components/PostListItem";
import type { WordType } from "@/features/words/types";

const DEFAULT_PAGE_SIZE = 10;
const TAB_ORDER: Array<WordType | "all"> = ["blog", "all", "recipe", "note", "review"];

type WordListSummary = {
  slug: string;
  type: WordType;
  title: string;
  subtitle?: string;
  date: string;
  dateLabel: string;
  readingTime?: number;
  featured?: boolean;
  tags: string[];
  searchText: string;
};

type Props = {
  items: WordListSummary[];
};

function matchesSearch(searchText: string, query: string): boolean {
  if (!query.trim()) return true;
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const lower = searchText.toLowerCase();
  return tokens.every((t) => lower.includes(t));
}

function formatTypeLabel(type: WordType | "all"): string {
  if (type === "all") return "all";
  if (type === "blog") return "blog";
  if (type === "note") return "notes";
  if (type === "recipe") return "recipes";
  return "reviews";
}

function typeChip(type: WordType): string {
  if (type === "blog") return "blog";
  if (type === "note") return "note";
  if (type === "recipe") return "recipe";
  return "review";
}

export function SearchableWordList({ items }: Props) {
  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState<WordType | "all">("blog");
  const [visibleCount, setVisibleCount] = useState(DEFAULT_PAGE_SIZE);

  const filtered = useMemo(() => {
    const byType = items.filter((item) =>
      activeType === "all" ? true : item.type === activeType
    );
    if (!query.trim()) return byType;
    return byType.filter((item) => matchesSearch(item.searchText, query));
  }, [activeType, items, query]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = filtered.length > visibleCount;

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setVisibleCount(DEFAULT_PAGE_SIZE);
  }, []);

  const handleTypeChange = useCallback((type: WordType | "all") => {
    setActiveType(type);
    setVisibleCount(DEFAULT_PAGE_SIZE);
  }, []);

  const showMore = useCallback(() => {
    setVisibleCount((n) => Math.min(n + DEFAULT_PAGE_SIZE, filtered.length));
  }, [filtered.length]);

  const resultsLabel =
    query &&
    (filtered.length === 0
      ? "no matches"
      : `${filtered.length} result${filtered.length === 1 ? "" : "s"}`);

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        {TAB_ORDER.map((type) => {
          const isActive = type === activeType;
          return (
            <button
              key={type}
              type="button"
              onClick={() => handleTypeChange(type)}
              className={`px-2 py-1 rounded border transition-colors ${
                isActive
                  ? "border-[var(--foreground)] text-foreground"
                  : "theme-border theme-muted hover:text-foreground"
              }`}
            >
              {formatTypeLabel(type)}
            </button>
          );
        })}
      </div>

      <div>
        <div className="relative">
          <label htmlFor="words-search" className="sr-only">
            Search words
          </label>
          <input
            id="words-search"
            type="text"
            role="search"
            value={query}
            onChange={handleSearchChange}
            placeholder="what are you looking for?"
            autoComplete="off"
            aria-describedby={query ? "search-results-count" : undefined}
            className="search-input w-full font-mono text-sm theme-muted bg-transparent border-b theme-border py-3 pr-12 transition-colors placeholder:theme-faint [&::-ms-clear]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setVisibleCount(DEFAULT_PAGE_SIZE);
              }}
              aria-label="Clear search"
              className="absolute right-0 top-0 bottom-0 flex items-center justify-center min-w-11 w-11 text-icon leading-none theme-faint hover:text-foreground active:text-foreground transition-colors font-mono touch-manipulation"
            >
              ×
            </button>
          ) : (
            <span
              aria-hidden
              className="absolute right-0 top-0 bottom-0 flex items-center justify-center w-11 pointer-events-none text-micro theme-faint font-mono"
            >
              ⌘
            </span>
          )}
        </div>
        {query && (
          <p
            id="search-results-count"
            className="mt-1.5 font-mono text-micro theme-faint"
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
              : "quiet for now. more words are on the way."}
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
            {visible.map((item) =>
              item.type === "blog" ? (
                <PostListItem
                  key={`${item.type}:${item.slug}`}
                  slug={item.slug}
                  title={item.title}
                  subtitle={item.subtitle}
                  date={item.date}
                  readingTime={item.readingTime ?? 1}
                  featured={item.featured}
                />
              ) : (
                <article key={`${item.type}:${item.slug}`} className="group relative">
                  <Link
                    href={`/words/${item.slug}`}
                    className="block py-6 border-b theme-border-faint hover:theme-border-strong transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs theme-muted">
                      <span className="uppercase">{typeChip(item.type)}</span>
                      <span>{item.readingTime ?? 1} min · {item.dateLabel}</span>
                    </div>
                    <h2 className="mt-2 font-serif text-xl sm:text-2xl text-foreground group-hover:opacity-70 transition-opacity leading-snug">
                      {item.title}
                    </h2>
                    {item.subtitle && (
                      <p className="mt-2 font-serif theme-subtle text-[0.95rem] leading-relaxed">
                        {item.subtitle}
                      </p>
                    )}
                    {item.tags.length > 0 && (
                      <p className="mt-2 font-mono text-micro theme-faint">#{item.tags.join(" #")}</p>
                    )}
                  </Link>
                </article>
              )
            )}
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

export type { WordListSummary };
