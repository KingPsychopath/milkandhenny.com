"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useState } from "react";
import { WordMediaLibrary } from "./WordMediaLibrary";
import { WORD_TYPES, getWordTypeLabel } from "@/features/words/types";
import { wordPathForVisibility } from "@/features/words/routes";
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
  hasUnsavedChanges: boolean;
  autosaveStatusText: string;
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
  onFieldBlur: () => void;
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
  hasUnsavedChanges,
  autosaveStatusText,
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
  onFieldBlur,
  onMediaSearchQueryChange,
  onRefreshMedia,
  onPreviewMedia,
  onCopySnippet,
  onAppendSnippet,
}: WordEditSectionProps) {
  const [editorExpanded, setEditorExpanded] = useState(false);
  const [editorFocusMode, setEditorFocusMode] = useState(false);

  useEffect(() => {
    if (!editorFocusMode) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [editorFocusMode]);

  useEffect(() => {
    if (showPreview) setEditorFocusMode(false);
  }, [showPreview]);

  return (
    <div className="border theme-border rounded-md p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-mono text-xs theme-muted">
            edit ·{" "}
            <Link
              href={wordPathForVisibility(selected.slug, selected.visibility)}
              className="underline-offset-2 hover:underline text-[var(--foreground)]"
            >
              {selected.slug}
            </Link>
          </h2>
          <p
            className="font-mono text-micro theme-faint"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {autosaveStatusText}
            {hasUnsavedChanges ? " · unsaved changes" : ""}
          </p>
        </div>
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
          onBlur={onFieldBlur}
          className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
        <input
          value={editSubtitle}
          onChange={(event) => onEditSubtitleChange(event.target.value)}
          onBlur={onFieldBlur}
          placeholder="subtitle"
          className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
        <input
          value={editImage}
          onChange={(event) => onEditImageChange(event.target.value)}
          onBlur={onFieldBlur}
          placeholder="hero image path (optional: words/media/... or words/assets/...)"
          className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
        <input
          value={editTags}
          onChange={(event) => onEditTagsChange(event.target.value)}
          onBlur={onFieldBlur}
          placeholder="tags (comma-separated)"
          className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
        <select
          value={editType}
          onChange={(event) => onEditTypeChange(event.target.value as WordType)}
          onBlur={onFieldBlur}
          className="bg-transparent border theme-border rounded px-2 py-2 font-mono text-xs"
        >
          {WORD_TYPES.map((type) => (
            <option key={type} value={type}>{getWordTypeLabel(type)}</option>
          ))}
        </select>
        <select
          value={editVisibility}
          onChange={(event) => onEditVisibilityChange(event.target.value as NoteVisibility)}
          onBlur={onFieldBlur}
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
        <div
          className={
            editorFocusMode
              ? "fixed inset-0 z-40 bg-[var(--background)] px-3 py-3 sm:p-4 overflow-y-auto"
              : ""
          }
        >
          <div
            className={
              editorFocusMode
                ? "max-w-5xl mx-auto h-full flex flex-col gap-3"
                : "space-y-3"
            }
          >
          {!showPreview ? (
            <div
              className={`flex flex-wrap items-center justify-between gap-2 ${
                editorFocusMode ? "sticky top-0 z-10 bg-[var(--background)]/95 backdrop-blur py-1" : ""
              }`}
            >
              <p className="font-mono text-micro theme-faint">
                writing tools
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditorExpanded((value) => !value)}
                  className="min-h-10 px-2.5 rounded border theme-border font-mono text-xs"
                >
                  {editorExpanded ? "shrink" : "expand"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditorFocusMode((value) => !value)}
                  className="min-h-10 px-2.5 rounded border theme-border font-mono text-xs"
                  aria-pressed={editorFocusMode}
                >
                  {editorFocusMode ? "exit focus" : "focus mode"}
                </button>
                {editorFocusMode ? (
                  <>
                    <button
                      type="button"
                      onClick={onTogglePreview}
                      className="min-h-10 px-2.5 rounded border theme-border font-mono text-xs"
                    >
                      preview
                    </button>
                    <button
                      type="button"
                      onClick={onSave}
                      disabled={busy}
                      className="min-h-10 px-2.5 rounded border theme-border font-mono text-xs"
                    >
                      {busy ? "saving..." : "publish"}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {showPreview ? (
            <div className="border theme-border rounded p-3 prose-blog font-serif">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{editMarkdown}</ReactMarkdown>
            </div>
          ) : (
            <textarea
              value={editMarkdown}
              onChange={(event) => onEditMarkdownChange(event.target.value)}
              onBlur={onFieldBlur}
              rows={editorFocusMode ? 30 : editorExpanded ? 24 : 14}
              className={`w-full bg-transparent border theme-border rounded px-3 py-2 font-mono text-xs resize-y ${
                editorFocusMode
                  ? "min-h-[calc(100svh-8rem)]"
                  : editorExpanded
                    ? "min-h-[70svh]"
                    : "min-h-[42svh] sm:min-h-[22rem]"
              }`}
            />
          )}

          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="hidden sm:inline-flex items-center justify-center min-h-11 font-mono text-xs px-3 py-2 rounded border theme-border"
          >
            {busy ? "saving..." : hasUnsavedChanges ? "publish changes" : "save word"}
          </button>
          </div>
        </div>

        {!editorFocusMode ? (
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
        ) : null}
      </div>

      {!editorFocusMode ? (
      <div className="sm:hidden sticky bottom-2 z-10">
        <div className="rounded-md border theme-border bg-[var(--background)]/95 backdrop-blur px-3 py-2 flex items-center gap-2">
          <p
            className="font-mono text-micro theme-faint flex-1 min-w-0 truncate"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {autosaveStatusText}
            {hasUnsavedChanges ? " · unsaved" : ""}
          </p>
          <button
            type="button"
            onClick={onTogglePreview}
            className="min-h-11 px-3 rounded border theme-border font-mono text-xs"
          >
            {showPreview ? "edit" : "preview"}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="min-h-11 px-3 rounded border theme-border font-mono text-xs"
          >
            {busy ? "saving..." : "save"}
          </button>
        </div>
      </div>
      ) : null}
    </div>
  );
}
