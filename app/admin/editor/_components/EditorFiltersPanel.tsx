"use client";

import type { NoteVisibility, WordType } from "../types";

type EditorFiltersPanelProps = {
  searchQuery: string;
  filterType: WordType | "all";
  filterVisibility: NoteVisibility | "all";
  filterTag: string;
  onSearchQueryChange: (value: string) => void;
  onFilterTypeChange: (value: WordType | "all") => void;
  onFilterVisibilityChange: (value: NoteVisibility | "all") => void;
  onFilterTagChange: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
};

export function EditorFiltersPanel({
  searchQuery,
  filterType,
  filterVisibility,
  filterTag,
  onSearchQueryChange,
  onFilterTypeChange,
  onFilterVisibilityChange,
  onFilterTagChange,
  onApply,
  onClear,
}: EditorFiltersPanelProps) {
  return (
    <section className="mb-6 border theme-border rounded-md p-4 space-y-3">
      <p className="font-mono text-xs theme-muted">search + filters</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="search title, slug, tags"
          className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
        <select
          value={filterType}
          onChange={(event) => onFilterTypeChange(event.target.value as WordType | "all")}
          className="bg-transparent border theme-border rounded px-2 py-2 font-mono text-xs"
        >
          <option value="all">all types</option>
          <option value="blog">blog</option>
          <option value="note">note</option>
          <option value="recipe">recipe</option>
          <option value="review">review</option>
        </select>
        <select
          value={filterVisibility}
          onChange={(event) => onFilterVisibilityChange(event.target.value as NoteVisibility | "all")}
          className="bg-transparent border theme-border rounded px-2 py-2 font-mono text-xs"
        >
          <option value="all">all visibility</option>
          <option value="public">public</option>
          <option value="unlisted">unlisted</option>
          <option value="private">private</option>
        </select>
        <input
          value={filterTag}
          onChange={(event) => onFilterTagChange(event.target.value)}
          placeholder="filter by tag"
          className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
      </div>
      <div className="flex items-center gap-3 font-mono text-xs">
        <button type="button" onClick={onApply} className="underline">
          apply filters
        </button>
        <button type="button" onClick={onClear} className="underline">
          clear
        </button>
      </div>
    </section>
  );
}

