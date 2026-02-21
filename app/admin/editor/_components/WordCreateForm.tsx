"use client";

import { WORD_TYPES, getWordTypeLabel } from "@/features/words/types";
import type { NoteVisibility, WordType } from "../types";

function featuredButtonClass(isFeatured: boolean): string {
  return `h-full min-h-10 px-3 rounded border font-mono text-xs transition-colors ${
    isFeatured
      ? "border-[var(--foreground)] text-[var(--foreground)]"
      : "theme-border theme-muted hover:text-[var(--foreground)]"
  }`;
}

type WordCreateFormProps = {
  createSlug: string;
  createTitle: string;
  createSubtitle: string;
  createImage: string;
  createType: WordType;
  createVisibility: NoteVisibility;
  createTags: string;
  createFeatured: boolean;
  createMarkdown: string;
  busy: boolean;
  onCreateSlugChange: (value: string) => void;
  onCreateTitleChange: (value: string) => void;
  onCreateSubtitleChange: (value: string) => void;
  onCreateImageChange: (value: string) => void;
  onCreateTypeChange: (value: WordType) => void;
  onCreateVisibilityChange: (value: NoteVisibility) => void;
  onCreateTagsChange: (value: string) => void;
  onToggleCreateFeatured: () => void;
  onCreateMarkdownChange: (value: string) => void;
  onCreate: () => void;
};

export function WordCreateForm({
  createSlug,
  createTitle,
  createSubtitle,
  createImage,
  createType,
  createVisibility,
  createTags,
  createFeatured,
  createMarkdown,
  busy,
  onCreateSlugChange,
  onCreateTitleChange,
  onCreateSubtitleChange,
  onCreateImageChange,
  onCreateTypeChange,
  onCreateVisibilityChange,
  onCreateTagsChange,
  onToggleCreateFeatured,
  onCreateMarkdownChange,
  onCreate,
}: WordCreateFormProps) {
  return (
    <div className="border theme-border rounded-md p-4 space-y-3">
      <h2 className="font-mono text-xs theme-muted">create word</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        <input
          value={createSlug}
          onChange={(event) => onCreateSlugChange(event.target.value)}
          placeholder="slug"
          className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
        <input
          value={createTitle}
          onChange={(event) => onCreateTitleChange(event.target.value)}
          placeholder="title"
          className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
      </div>
      <input
        value={createSubtitle}
        onChange={(event) => onCreateSubtitleChange(event.target.value)}
        placeholder="subtitle (optional)"
        className="w-full bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
      />
      <input
        value={createImage}
        onChange={(event) => onCreateImageChange(event.target.value)}
        placeholder="hero image path (optional: words/media/... or words/assets/...)"
        className="w-full bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
      />
      <div className="grid sm:grid-cols-2 gap-3">
        <input
          value={createTags}
          onChange={(event) => onCreateTagsChange(event.target.value)}
          placeholder="tags (comma-separated)"
          className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
          <select
            value={createType}
            onChange={(event) => onCreateTypeChange(event.target.value as WordType)}
            className="bg-transparent border theme-border rounded px-2 py-2 font-mono text-xs"
          >
            {WORD_TYPES.map((type) => (
              <option key={type} value={type}>{getWordTypeLabel(type)}</option>
            ))}
          </select>
          <select
            value={createVisibility}
            onChange={(event) => onCreateVisibilityChange(event.target.value as NoteVisibility)}
            className="bg-transparent border theme-border rounded px-2 py-2 font-mono text-xs"
          >
            <option value="private">private</option>
            <option value="unlisted">unlisted</option>
            <option value="public">public</option>
          </select>
          <button
            type="button"
            onClick={onToggleCreateFeatured}
            className={featuredButtonClass(createFeatured)}
            aria-pressed={createFeatured}
          >
            featured
          </button>
        </div>
      </div>
      <textarea
        value={createMarkdown}
        onChange={(event) => onCreateMarkdownChange(event.target.value)}
        placeholder="markdown"
        rows={8}
        className="w-full bg-transparent border theme-border rounded px-3 py-2 font-mono text-xs"
      />
      <button
        type="button"
        onClick={onCreate}
        disabled={busy}
        className="font-mono text-xs px-3 py-2 rounded border theme-border"
      >
        {busy ? "working..." : "create word"}
      </button>
    </div>
  );
}

