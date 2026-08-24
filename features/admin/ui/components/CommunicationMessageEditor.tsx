"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AppSelect, type AppSelectOption } from "@/components/AppSelect";

export type CommunicationMediaKind = "image" | "gif" | "video";

export type CommunicationMediaDraft = {
  kind: CommunicationMediaKind;
  url: string;
  alt: string;
  posterUrl: string;
};

type CommunicationMessageEditorProps = {
  body: string;
  onBodyChange: (value: string) => void;
  media: CommunicationMediaDraft;
  onMediaChange: (value: CommunicationMediaDraft) => void;
  rows?: number;
  hint?: string;
};

const MEDIA_OPTIONS: readonly AppSelectOption[] = [
  { value: "image", label: "image" },
  { value: "gif", label: "GIF" },
  { value: "video", label: "video link" },
];

function detectedMediaKind(value: string): CommunicationMediaKind | null {
  const clean = value.split(/[?#]/, 1)[0].toLowerCase();
  if (clean.endsWith(".gif")) return "gif";
  if ([".mp4", ".webm", ".mov", ".m4v"].some((extension) => clean.endsWith(extension))) {
    return "video";
  }
  if (
    [".png", ".jpg", ".jpeg", ".webp", ".avif", ".svg"].some((extension) =>
      clean.endsWith(extension),
    )
  ) {
    return "image";
  }
  return null;
}

function mediaFromUrl(value: string, current: CommunicationMediaDraft): CommunicationMediaDraft {
  const kind = detectedMediaKind(value);
  return { ...current, url: value, ...(kind ? { kind } : {}) };
}

function EditorButton({
  children,
  onClick,
  pressed = false,
}: {
  children: ReactNode;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className="min-h-10 rounded border theme-border px-3 font-mono text-xs transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
    >
      {children}
    </button>
  );
}

export function CommunicationMessageEditor({
  body,
  onBodyChange,
  media,
  onMediaChange,
  rows = 12,
  hint = "Use headings, **bold**, lists, links, and event tokens such as {{event.title}}.",
}: CommunicationMessageEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isMediaDropTarget, setIsMediaDropTarget] = useState(false);

  const replaceSelection = (before: string, after = before, fallback = "text") => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = body.slice(start, end) || fallback;
    const next = `${body.slice(0, start)}${before}${selected}${after}${body.slice(end)}`;
    onBodyChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const prefixLines = (prefix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = body.slice(start, end) || "text";
    const next = selected
      .split("\n")
      .map((line) => `${prefix}${line}`)
      .join("\n");
    onBodyChange(`${body.slice(0, start)}${next}${body.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + next.length);
    });
  };

  const insertLink = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const label = body.slice(start, end) || "link text";
    const inserted = `[${label}](https://)`;
    onBodyChange(`${body.slice(0, start)}${inserted}${body.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + label.length + 3, start + inserted.length - 1);
    });
  };

  const acceptMediaUrl = (value: string) => {
    const url = value.trim();
    if (!url) return;
    onMediaChange(mediaFromUrl(url, media));
  };

  const handleMediaDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsMediaDropTarget(false);
    const url =
      event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
    if (url) acceptMediaUrl(url.split("\n")[0]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-micro theme-faint">message editor</p>
        <button
          type="button"
          onClick={() => setShowPreview((current) => !current)}
          aria-pressed={showPreview}
          className="min-h-10 rounded border theme-border px-3 font-mono text-xs transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
        >
          {showPreview ? "edit message" : "instant preview"}
        </button>
      </div>
      {!showPreview ? (
        <>
          <div className="flex flex-wrap gap-2">
            <EditorButton onClick={() => replaceSelection("**")}>bold</EditorButton>
            <EditorButton onClick={() => replaceSelection("_")}>italic</EditorButton>
            <EditorButton onClick={() => prefixLines("## ")}>heading</EditorButton>
            <EditorButton onClick={() => prefixLines("- ")}>list</EditorButton>
            <EditorButton onClick={insertLink}>link</EditorButton>
          </div>
          <textarea
            ref={textareaRef}
            aria-label="message body"
            value={body}
            onChange={(event) => onBodyChange(event.target.value)}
            rows={rows}
            className="w-full resize-y rounded border theme-border bg-transparent px-3 py-3 font-serif text-lg leading-relaxed text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
          />
        </>
      ) : (
        <div className="min-h-64 rounded border theme-border p-5">
          <div className="prose-blog font-serif">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {body || "Your message preview will appear here."}
            </ReactMarkdown>
          </div>
          {media.url ? (
            <figure className="mt-5 border-t theme-border-faint pt-5">
              {media.kind === "video" ? (
                media.posterUrl ? (
                  <img
                    src={media.posterUrl}
                    alt={media.alt || "video poster"}
                    className="block max-h-80 w-full object-contain"
                  />
                ) : (
                  <p className="font-mono text-xs theme-muted">video link · {media.url}</p>
                )
              ) : (
                <img
                  src={media.url}
                  alt={media.alt || "email media"}
                  className="block max-h-80 w-full object-contain"
                />
              )}
              <figcaption className="mt-2 font-mono text-micro theme-faint">
                {media.kind} · shown after the message body
              </figcaption>
            </figure>
          ) : null}
        </div>
      )}
      <p className="font-mono text-micro leading-relaxed theme-faint">{hint}</p>
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          setIsMediaDropTarget(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setIsMediaDropTarget(false)}
        onDrop={handleMediaDrop}
        className={`space-y-4 rounded border p-4 transition-opacity ${isMediaDropTarget ? "border-[var(--prose-hashtag)] opacity-80" : "theme-border"}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="font-mono text-xs font-bold">media for this email</p>
            <p className="mt-1 font-mono text-micro theme-faint">
              Paste or drag a public image, GIF, or video URL here.
            </p>
          </div>
          {media.url ? (
            <button
              type="button"
              onClick={() => onMediaChange({ kind: "image", url: "", alt: "", posterUrl: "" })}
              className="font-mono text-micro theme-muted underline underline-offset-4 transition-opacity hover:opacity-70"
            >
              remove media
            </button>
          ) : null}
        </div>
        <input
          aria-label="media URL"
          value={media.url}
          onChange={(event) => onMediaChange(mediaFromUrl(event.target.value, media))}
          placeholder="https://…/asset.gif"
          className="min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
        />
        {media.url ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="font-mono text-micro theme-muted">media type</span>
              <AppSelect
                value={media.kind}
                onValueChange={(value) =>
                  onMediaChange({ ...media, kind: value as CommunicationMediaKind })
                }
                options={MEDIA_OPTIONS}
                ariaLabel="media type"
                variant="field"
                className="mt-2"
              />
            </label>
            <label className="block">
              <span className="font-mono text-micro theme-muted">alt text</span>
              <input
                value={media.alt}
                onChange={(event) => onMediaChange({ ...media, alt: event.target.value })}
                className="mt-2 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
              />
            </label>
            {media.kind === "video" ? (
              <label className="block sm:col-span-2">
                <span className="font-mono text-micro theme-muted">poster URL</span>
                <input
                  value={media.posterUrl}
                  onChange={(event) => onMediaChange({ ...media, posterUrl: event.target.value })}
                  placeholder="Optional image shown before the video link opens"
                  className="mt-2 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
                />
              </label>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
