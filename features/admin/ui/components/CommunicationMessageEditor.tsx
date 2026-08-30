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
  previewValues?: Readonly<Record<string, string>>;
  rows?: number;
  hint?: string;
};

export type CommunicationPreviewValues = Readonly<Record<string, string>>;

const MEDIA_OPTIONS: readonly AppSelectOption[] = [
  { value: "image", label: "image" },
  { value: "gif", label: "GIF" },
  { value: "video", label: "video link" },
];

const TOKEN_OPTIONS: readonly AppSelectOption[] = [
  { value: "", label: "insert fill-in…" },
  { value: "{{recipient.name}}", label: "recipient name" },
  { value: "{{event.title}}", label: "event title" },
  { value: "{{event.date}}", label: "event date" },
  { value: "{{event.time}}", label: "event start time" },
  { value: "{{event.doors}}", label: "doors time" },
  { value: "{{event.timing}}", label: "event timing" },
  { value: "{{event.venue}}", label: "venue" },
  { value: "{{event.address}}", label: "address" },
  { value: "{{event.map}}", label: "map link" },
  { value: "{{links.spellingGame}}", label: "spelling game link" },
  { value: "{{links.pitch}}", label: "pitch link" },
  { value: "{{links.walkingVideo}}", label: "walking video link" },
  { value: "{{links.contact}}", label: "contact page link" },
  { value: "{{links.email}}", label: "contact email link" },
  { value: "{{survey.url}}", label: "survey link" },
];

const DEFAULT_PREVIEW_VALUES: CommunicationPreviewValues = {
  "recipient.name": "Test recipient",
  "event.title": "sample event title",
  "event.date": "the event date",
  "event.time": "the start time",
  "event.doors": "the doors time",
  "event.timing": "Doors open: [time] · Starts: [time]",
  "event.venue": "the venue",
  "event.address": "the event address",
  "event.map": "https://milkandhenny.com/contact",
  "links.spellingGame": "https://milkandhenny.com/things/spelling-bee",
  "links.pitch": "https://milkandhenny.com/things/pitches/new",
  "links.walkingVideo":
    "https://milkandhenny.com/media/events/after-school-club-2026-09-01/walking.mp4",
  "links.contact": "https://milkandhenny.com/contact",
  "links.email": "mailto:hello@milkandhenny.com",
  "survey.url": "https://milkandhenny.com/surveys/preview",
};

function previewBody(value: string, values?: CommunicationPreviewValues): string {
  const resolved = { ...DEFAULT_PREVIEW_VALUES, ...values };
  return value.replace(/\{\{([A-Za-z.]+)\}\}/g, (token, key: string) => resolved[key] ?? token);
}

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
      className="min-h-11 rounded border theme-border px-3 font-mono text-xs transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
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
  previewValues,
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

  const insertToken = (token: string) => {
    if (!token) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${body.slice(0, start)}${token}${body.slice(end)}`;
    onBodyChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
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
          className="min-h-11 rounded border theme-border px-3 font-mono text-xs transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
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
            <AppSelect
              value=""
              onValueChange={insertToken}
              options={TOKEN_OPTIONS}
              ariaLabel="insert fill-in"
              title="Insert an event value or page link"
              className="min-w-44"
            />
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
              {previewBody(body, previewValues) || "Your message preview will appear here."}
            </ReactMarkdown>
          </div>
          {body.match(/\{\{[A-Za-z.]+\}\}/) ? (
            <p className="mt-4 border-t theme-border-faint pt-3 font-mono text-micro leading-relaxed theme-faint">
              Fill-ins use the selected event when one is available. Otherwise this preview uses
              sample event details; the sent email uses the real values.
            </p>
          ) : null}
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
