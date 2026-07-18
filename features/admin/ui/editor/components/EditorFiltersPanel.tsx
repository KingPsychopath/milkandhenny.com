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
    <section className="mb-6 border theme-border rounded-md p-4 space-y-3">
      <p className="font-mono text-xs theme-muted">search + filters</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="search title, slug, tags"
          className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
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
