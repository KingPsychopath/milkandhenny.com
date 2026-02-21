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
    <aside className="space-y-3 border theme-border rounded-md p-3 h-fit">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs theme-muted">results ({notes.length})</p>
        <button type="button" onClick={onRefresh} className="font-mono text-xs underline">
          refresh
        </button>
      </div>
      <div className="space-y-1 max-h-[420px] overflow-auto">
        {notes.map((note) => (
          <button
            type="button"
            key={note.slug}
            onClick={() => onSelectSlug(note.slug)}
            className={`w-full text-left rounded px-2 py-2 border transition-colors ${
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

