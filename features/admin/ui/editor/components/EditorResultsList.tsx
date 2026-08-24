"use client";

import type { NoteMeta } from "../types";

type EditorResultsListProps = {
  notes: NoteMeta[];
  selectedSlug: string;
  activeShareCountBySlug: Record<string, number>;
  onSelectSlug: (slug: string) => void;
  onRefresh: () => void;
};

export function EditorResultsList({
  notes,
  selectedSlug,
  activeShareCountBySlug,
  onSelectSlug,
  onRefresh,
}: EditorResultsListProps) {
  return (
    <aside className="h-fit space-y-4 rounded-md border theme-border p-4 lg:sticky lg:top-6">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs theme-muted">results ({notes.length})</p>
        <button
          type="button"
          onClick={onRefresh}
          className="min-h-11 px-2 font-mono text-xs underline"
        >
          refresh
        </button>
      </div>
      <div className="max-h-[36rem] space-y-2 overflow-auto">
        {notes.map((note) => (
          <button
            type="button"
            key={note.slug}
            onClick={() => onSelectSlug(note.slug)}
            className={`min-h-20 w-full rounded border px-3 py-3 text-left transition-colors ${
              selectedSlug === note.slug ? "border-[var(--foreground)]" : "theme-border"
            }`}
          >
            <p className="font-mono text-xs">{note.slug}</p>
            <p className="font-serif text-sm leading-tight mt-1">{note.title}</p>
            <p className="font-mono text-micro theme-muted mt-1">
              {note.type} · {note.visibility}
              {note.featured ? " · featured" : ""}
              {(activeShareCountBySlug[note.slug] ?? 0) > 0
                ? ` · shared (${activeShareCountBySlug[note.slug]})`
                : ""}
            </p>
            {note.tags.length > 0 ? (
              <p className="font-mono text-micro theme-faint mt-1">#{note.tags.join(" #")}</p>
            ) : null}
          </button>
        ))}
      </div>
    </aside>
  );
}
