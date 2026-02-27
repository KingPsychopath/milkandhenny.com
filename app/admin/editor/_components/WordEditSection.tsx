"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useRef, useState } from "react";
import { WordMediaLibrary } from "./WordMediaLibrary";
import { WORD_TYPES, getWordTypeLabel } from "@/features/words/types";
import { wordPathForVisibility } from "@/features/words/routes";
import { resolveWordContentRef } from "@/features/media/storage";
import type { NoteMeta, NoteVisibility, WordMediaItem, WordType } from "../types";

function featuredButtonClass(isFeatured: boolean): string {
  return `h-full min-h-10 px-3 rounded border font-mono text-xs transition-colors ${
    isFeatured
      ? "border-[var(--foreground)] text-[var(--foreground)]"
      : "theme-border theme-muted hover:text-[var(--foreground)]"
  }`;
}

function looksLikeUrlOrPath(value: string): boolean {
  return /^(https?:\/\/|\/|words\/|assets\/)/i.test(value);
}

function basenameLabel(value: string): string {
  const withoutQuery = value.split(/[?#]/, 1)[0];
  const tail = withoutQuery.split("/").pop() || "media";
  return tail.replace(/\.[^.]+$/, "") || "media";
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
  const markdownTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editorFocusMode) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [editorFocusMode]);

  const updateMarkdownWithSelection = (
    transform: (value: string, start: number, end: number) => {
      value: string;
      selectionStart: number;
      selectionEnd: number;
    }
  ) => {
    const current = editMarkdown;
    const el = markdownTextareaRef.current;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = transform(current, start, end);
    onEditMarkdownChange(next.value);
    requestAnimationFrame(() => {
      const target = markdownTextareaRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  };

  const wrapSelection = (prefix: string, suffix = prefix, placeholder = "text") => {
    updateMarkdownWithSelection((value, start, end) => {
      const selectedText = value.slice(start, end);
      const inner = selectedText || placeholder;
      const replacement = `${prefix}${inner}${suffix}`;
      const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
      const innerStart = start + prefix.length;
      return {
        value: nextValue,
        selectionStart: innerStart,
        selectionEnd: innerStart + inner.length,
      };
    });
  };

  const insertTemplate = (template: string, selectFromOffset?: [number, number]) => {
    updateMarkdownWithSelection((value, start, end) => {
      const nextValue = `${value.slice(0, start)}${template}${value.slice(end)}`;
      if (!selectFromOffset) {
        const cursor = start + template.length;
        return { value: nextValue, selectionStart: cursor, selectionEnd: cursor };
      }
      return {
        value: nextValue,
        selectionStart: start + selectFromOffset[0],
        selectionEnd: start + selectFromOffset[1],
      };
    });
  };

  const prefixSelectedLines = (
    getPrefix: (index: number) => string
  ) => {
    updateMarkdownWithSelection((value, start, end) => {
      const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const nextBreak = value.indexOf("\n", end);
      const lineEnd = nextBreak === -1 ? value.length : nextBreak;
      const block = value.slice(lineStart, lineEnd);
      const lines = block.split("\n");
      const prefixed = lines.map((line, index) => `${getPrefix(index)}${line}`).join("\n");
      const nextValue = `${value.slice(0, lineStart)}${prefixed}${value.slice(lineEnd)}`;
      return {
        value: nextValue,
        selectionStart: lineStart,
        selectionEnd: lineStart + prefixed.length,
      };
    });
  };

  const insertLinkFromSelection = () => {
    updateMarkdownWithSelection((value, start, end) => {
      const selectedText = value.slice(start, end).trim();
      const selectionLooksLikePath = selectedText ? looksLikeUrlOrPath(selectedText) : false;
      const label = selectedText
        ? (selectionLooksLikePath ? basenameLabel(selectedText) : selectedText)
        : "label";
      const href = selectedText
        ? (selectionLooksLikePath ? selectedText : "https://example.com")
        : "https://example.com";
      const replacement = `[${label}](${href})`;
      const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`;

      if (!selectedText) {
        const labelStart = start + 1;
        return { value: nextValue, selectionStart: labelStart, selectionEnd: labelStart + label.length };
      }

      if (selectionLooksLikePath) {
        const labelStart = start + 1;
        return { value: nextValue, selectionStart: labelStart, selectionEnd: labelStart + label.length };
      }

      const hrefStart = start + label.length + 3; // `[label](`
      return { value: nextValue, selectionStart: hrefStart, selectionEnd: hrefStart + href.length };
    });
  };

  const insertMediaFromSelection = () => {
    updateMarkdownWithSelection((value, start, end) => {
      const selectedText = value.slice(start, end).trim();
      const selectionLooksLikePath = selectedText ? looksLikeUrlOrPath(selectedText) : false;
      const alt = selectedText
        ? (selectionLooksLikePath ? basenameLabel(selectedText) : selectedText)
        : "alt";
      const src = selectedText
        ? (selectionLooksLikePath ? selectedText : `words/media/${selectedSlug || "slug"}/filename.webp`)
        : `words/media/${selectedSlug || "slug"}/filename.webp`;
      const replacement = `![${alt}](${src})`;
      const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`;

      if (!selectedText) {
        const altStart = start + 2;
        return { value: nextValue, selectionStart: altStart, selectionEnd: altStart + alt.length };
      }

      if (selectionLooksLikePath) {
        const altStart = start + 2;
        return { value: nextValue, selectionStart: altStart, selectionEnd: altStart + alt.length };
      }

      const srcStart = start + alt.length + 4; // `![alt](`
      return { value: nextValue, selectionStart: srcStart, selectionEnd: srcStart + src.length };
    });
  };

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
          {!showPreview || editorFocusMode ? (
            <div
              className={`flex flex-wrap items-center justify-between gap-2 ${
                editorFocusMode ? "sticky top-0 z-10 bg-[var(--background)]/95 backdrop-blur py-1" : ""
              }`}
            >
              <p className="font-mono text-micro theme-faint">
                {showPreview ? "preview tools" : "writing tools"}
              </p>
              {editorFocusMode ? (
                <p className="font-mono text-micro theme-faint">
                  {autosaveStatusText}
                  {hasUnsavedChanges ? " · unsaved" : ""}
                </p>
              ) : null}
              <div className="flex items-center gap-2">
                {!editorFocusMode ? (
                  <button
                    type="button"
                    onClick={() => setEditorExpanded((value) => !value)}
                    className="min-h-10 px-2.5 rounded border theme-border font-mono text-xs"
                  >
                    {editorExpanded ? "shrink" : "expand"}
                  </button>
                ) : null}
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
                      {showPreview ? "edit mode" : "preview"}
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
          {!showPreview && editorFocusMode ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => prefixSelectedLines(() => "## ")} className="min-h-9 px-2 rounded border theme-border font-mono text-xs">h2</button>
              <button type="button" onClick={() => wrapSelection("**")} className="min-h-9 px-2 rounded border theme-border font-mono text-xs">bold</button>
              <button type="button" onClick={() => wrapSelection("_")} className="min-h-9 px-2 rounded border theme-border font-mono text-xs">italic</button>
              <button type="button" onClick={() => wrapSelection("`")} className="min-h-9 px-2 rounded border theme-border font-mono text-xs">icode</button>
              <button
                type="button"
                onClick={insertLinkFromSelection}
                className="min-h-9 px-2 rounded border theme-border font-mono text-xs"
              >
                link
              </button>
              <button
                type="button"
                onClick={insertMediaFromSelection}
                className="min-h-9 px-2 rounded border theme-border font-mono text-xs"
              >
                image
              </button>
              <button type="button" onClick={() => prefixSelectedLines(() => "- ")} className="min-h-9 px-2 rounded border theme-border font-mono text-xs">list</button>
              <button type="button" onClick={() => prefixSelectedLines((i) => `${i + 1}. `)} className="min-h-9 px-2 rounded border theme-border font-mono text-xs">numbered</button>
              <button type="button" onClick={() => prefixSelectedLines(() => "> ")} className="min-h-9 px-2 rounded border theme-border font-mono text-xs">quote</button>
              <button type="button" onClick={() => prefixSelectedLines(() => "- [ ] ")} className="min-h-9 px-2 rounded border theme-border font-mono text-xs">todo</button>
              <button
                type="button"
                onClick={() => insertTemplate("```\ncode\n```", [4, 8])}
                className="min-h-9 px-2 rounded border theme-border font-mono text-xs"
              >
                code
              </button>
            </div>
          ) : null}

          {showPreview ? (
            <div className="border theme-border rounded p-3 prose-blog font-serif">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={(url) => resolveWordContentRef(url, selectedSlug)}
              >
                {editMarkdown}
              </ReactMarkdown>
            </div>
          ) : (
            <textarea
              ref={markdownTextareaRef}
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
            selectedSlug={selectedSlug}
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
