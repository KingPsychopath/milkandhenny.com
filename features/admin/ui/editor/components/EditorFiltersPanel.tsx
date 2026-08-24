"use client";

import { AppSelect } from "@/components/AppSelect";
import { WORD_TYPE_TABS, getWordTypeLabel } from "@/features/words/types";
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
    <section className="mb-8 space-y-4 rounded-md border theme-border p-5">
      <p className="font-mono text-xs theme-muted">search + filters</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="search title, slug, tags"
          className="min-h-11 bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
        <AppSelect
          ariaLabel="Filter by type"
          value={filterType}
          onValueChange={(value) => onFilterTypeChange(value as WordType | "all")}
          className="rounded-lg"
          options={[
            { value: "all", label: "all types" },
            ...WORD_TYPE_TABS.filter((type): type is WordType => type !== "all").map((type) => ({
              value: type,
              label: getWordTypeLabel(type),
            })),
          ]}
        />
        <AppSelect
          ariaLabel="Filter by visibility"
          value={filterVisibility}
          onValueChange={(value) => onFilterVisibilityChange(value as NoteVisibility | "all")}
          className="rounded-lg"
          options={[
            { value: "all", label: "all visibility" },
            { value: "public", label: "public" },
            { value: "unlisted", label: "unlisted" },
            { value: "private", label: "private" },
          ]}
        />
        <input
          value={filterTag}
          onChange={(event) => onFilterTagChange(event.target.value)}
          placeholder="filter by tag"
          className="min-h-11 bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
        <button
          type="button"
          onClick={onApply}
          className="min-h-11 rounded border theme-border px-4 font-mono text-xs"
        >
          apply filters
        </button>
        <button type="button" onClick={onClear} className="min-h-11 px-3 underline">
          clear
        </button>
      </div>
    </section>
  );
}
