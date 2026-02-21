"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { WordMediaLibrary } from "./WordMediaLibrary";
import { WORD_TYPES, getWordTypeLabel } from "@/features/words/types";
import type { NoteMeta, NoteVisibility, WordMediaItem, WordType } from "../types";

function featuredButtonClass(isFeatured: boolean): string {
  return `h-full min-h-10 px-3 rounded border font-mono text-xs transition-colors ${
    isFeatured
      ? "border-[var(--foreground)] text-[var(--foreground)]"
      : "theme-border theme-muted hover:text-[var(--foreground)]"
  }`;
}

type WordEditSectionProps = {
  selected: NoteMeta;
  selectedSlug: string;
  showPreview: boolean;
  editTitle: string;
  editSubtitle: string;
  editImage: string;
  editType: WordType;
  editVisibility: NoteVisibility;
  editTags: string;
  editFeatured: boolean;
  editMarkdown: string;
  busy: boolean;
  mediaSearchQuery: string;
  mediaLoading: boolean;
  mediaError: string;
  mediaCopied: string | null;
  filteredPageMedia: WordMediaItem[];
  filteredSharedAssets: WordMediaItem[];
  onTogglePreview: () => void;
  onDelete: () => void;
  onEditTitleChange: (value: string) => void;
  onEditSubtitleChange: (value: string) => void;
  onEditImageChange: (value: string) => void;
  onEditTypeChange: (value: WordType) => void;
  onEditVisibilityChange: (value: NoteVisibility) => void;
  onEditTagsChange: (value: string) => void;
  onToggleEditFeatured: () => void;
  onEditMarkdownChange: (value: string) => void;
  onSave: () => void;
  onMediaSearchQueryChange: (value: string) => void;
  onRefreshMedia: (slug: string) => void;
  onPreviewMedia: (items: WordMediaItem[], key: string) => void;
  onCopySnippet: (snippet: string, copyId: string) => void;
  onAppendSnippet: (snippet: string) => void;
};

export function WordEditSection({
  selected,
  selectedSlug,
  showPreview,
  editTitle,
  editSubtitle,
  editImage,
  editType,
  editVisibility,
  editTags,
  editFeatured,
  editMarkdown,
  busy,
  mediaSearchQuery,
  mediaLoading,
  mediaError,
  mediaCopied,
  filteredPageMedia,
  filteredSharedAssets,
  onTogglePreview,
  onDelete,
  onEditTitleChange,
  onEditSubtitleChange,
  onEditImageChange,
  onEditTypeChange,
  onEditVisibilityChange,
  onEditTagsChange,
  onToggleEditFeatured,
  onEditMarkdownChange,
  onSave,
  onMediaSearchQueryChange,
  onRefreshMedia,
  onPreviewMedia,
  onCopySnippet,
  onAppendSnippet,
}: WordEditSectionProps) {
  return (
    <div className="border theme-border rounded-md p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-xs theme-muted">edit · {selected.slug}</h2>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onTogglePreview} className="font-mono text-xs underline">
            {showPreview ? "edit mode" : "preview"}
          </button>
          <button type="button" onClick={onDelete} className="font-mono text-xs text-[var(--prose-hashtag)]">
            delete
          </button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <input
          value={editTitle}
          onChange={(event) => onEditTitleChange(event.target.value)}
          className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
        <input
          value={editSubtitle}
          onChange={(event) => onEditSubtitleChange(event.target.value)}
          placeholder="subtitle"
          className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
        <input
          value={editImage}
          onChange={(event) => onEditImageChange(event.target.value)}
          placeholder="hero image path (optional: words/media/... or words/assets/...)"
          className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
        <input
          value={editTags}
          onChange={(event) => onEditTagsChange(event.target.value)}
          placeholder="tags (comma-separated)"
          className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
        <select
          value={editType}
          onChange={(event) => onEditTypeChange(event.target.value as WordType)}
          className="bg-transparent border theme-border rounded px-2 py-2 font-mono text-xs"
        >
          {WORD_TYPES.map((type) => (
            <option key={type} value={type}>{getWordTypeLabel(type)}</option>
          ))}
        </select>
        <select
          value={editVisibility}
          onChange={(event) => onEditVisibilityChange(event.target.value as NoteVisibility)}
          className="bg-transparent border theme-border rounded px-2 py-2 font-mono text-xs"
        >
          <option value="private">private</option>
          <option value="unlisted">unlisted</option>
          <option value="public">public</option>
        </select>
        <button
          type="button"
          onClick={onToggleEditFeatured}
          className={featuredButtonClass(editFeatured)}
          aria-pressed={editFeatured}
        >
          featured
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          {showPreview ? (
            <div className="border theme-border rounded p-3 prose-blog font-serif">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{editMarkdown}</ReactMarkdown>
            </div>
          ) : (
            <textarea
              value={editMarkdown}
              onChange={(event) => onEditMarkdownChange(event.target.value)}
              rows={14}
              className="w-full bg-transparent border theme-border rounded px-3 py-2 font-mono text-xs"
            />
          )}

          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="font-mono text-xs px-3 py-2 rounded border theme-border"
          >
            {busy ? "saving..." : "save word"}
          </button>
        </div>

        <WordMediaLibrary
          mediaSearchQuery={mediaSearchQuery}
          mediaLoading={mediaLoading}
          mediaError={mediaError}
          mediaCopied={mediaCopied}
          filteredPageMedia={filteredPageMedia}
          filteredSharedAssets={filteredSharedAssets}
          onMediaSearchQueryChange={onMediaSearchQueryChange}
          onRefresh={() => onRefreshMedia(selectedSlug)}
          onPreview={onPreviewMedia}
          onCopySnippet={onCopySnippet}
          onAppendSnippet={onAppendSnippet}
        />
      </div>
    </div>
  );
}

