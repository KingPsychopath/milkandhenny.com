"use client";

import type { WordMediaItem } from "../types";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 b";
  const units = ["b", "kb", "mb", "gb"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const size = bytes / 1024 ** index;
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

type WordMediaLibraryProps = {
  mediaSearchQuery: string;
  mediaLoading: boolean;
  mediaError: string;
  mediaCopied: string | null;
  filteredPageMedia: WordMediaItem[];
  filteredSharedAssets: WordMediaItem[];
  onMediaSearchQueryChange: (value: string) => void;
  onRefresh: () => void;
  onPreview: (items: WordMediaItem[], key: string) => void;
  onCopySnippet: (snippet: string, copyId: string) => void;
  onAppendSnippet: (snippet: string) => void;
};

export function WordMediaLibrary({
  mediaSearchQuery,
  mediaLoading,
  mediaError,
  mediaCopied,
  filteredPageMedia,
  filteredSharedAssets,
  onMediaSearchQueryChange,
  onRefresh,
  onPreview,
  onCopySnippet,
  onAppendSnippet,
}: WordMediaLibraryProps) {
  return (
    <aside className="border theme-border rounded-md p-3 space-y-3 h-fit max-h-[720px] overflow-auto">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs theme-muted">media library</h3>
        <button type="button" className="font-mono text-xs underline" onClick={onRefresh}>
          refresh
        </button>
      </div>
      <input
        value={mediaSearchQuery}
        onChange={(event) => onMediaSearchQueryChange(event.target.value)}
        placeholder="search files or asset id"
        className="w-full bg-transparent border-b theme-border outline-none font-mono text-xs py-2"
      />
      {mediaLoading ? <p className="font-mono text-xs theme-muted">loading media...</p> : null}
      {mediaError ? <p className="font-mono text-xs text-[var(--prose-hashtag)]">{mediaError}</p> : null}

      <div className="space-y-2">
        <p className="font-mono text-xs theme-muted">this page ({filteredPageMedia.length})</p>
        {filteredPageMedia.length === 0 ? (
          <p className="font-mono text-micro theme-faint">no media files for this slug</p>
        ) : (
          filteredPageMedia.map((item) => (
            <div key={item.key} className="border theme-border rounded p-2 space-y-1">
              <p className="font-mono text-xs truncate">{item.filename}</p>
              <p className="font-mono text-micro theme-faint">{formatBytes(item.size)}</p>
              <code className="font-mono text-micro theme-muted block truncate">{item.markdown}</code>
              <p
                className="font-mono text-[10px] theme-faint"
                title="Canonical paths are recommended. Legacy short refs are still interpreted and normalized when note markdown is saved."
              >
                use canonical snippet
              </p>
              <div className="flex items-center gap-3 font-mono text-micro">
                <button
                  type="button"
                  className="underline"
                  onClick={() => onPreview(filteredPageMedia, item.key)}
                  title="Preview in-page"
                >
                  preview
                </button>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                  title="Open media file in a new tab"
                >
                  open
                </a>
                <button
                  type="button"
                  className="underline"
                  onClick={() => onCopySnippet(item.markdown, `media-${item.key}`)}
                >
                  {mediaCopied === `media-${item.key}` ? "copied" : "copy"}
                </button>
                <button type="button" className="underline" onClick={() => onAppendSnippet(item.markdown)}>
                  append
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <p className="font-mono text-xs theme-muted">shared assets ({filteredSharedAssets.length})</p>
        {filteredSharedAssets.length === 0 ? (
          <p className="font-mono text-micro theme-faint">no shared assets yet</p>
        ) : (
          filteredSharedAssets.map((item) => (
            <div key={item.key} className="border theme-border rounded p-2 space-y-1">
              <p className="font-mono text-xs truncate">
                {item.assetId ? `${item.assetId}/` : ""}
                {item.filename}
              </p>
              <p className="font-mono text-micro theme-faint">{formatBytes(item.size)}</p>
              <code className="font-mono text-micro theme-muted block truncate">{item.markdown}</code>
              <p
                className="font-mono text-[10px] theme-faint"
                title="Canonical paths are recommended. Legacy short refs are still interpreted and normalized when note markdown is saved."
              >
                use canonical snippet
              </p>
              <div className="flex items-center gap-3 font-mono text-micro">
                <button
                  type="button"
                  className="underline"
                  onClick={() => onPreview(filteredSharedAssets, item.key)}
                  title="Preview in-page"
                >
                  preview
                </button>
                <a href={item.url} target="_blank" rel="noreferrer" className="underline" title="Open asset in a new tab">
                  open
                </a>
                <button
                  type="button"
                  className="underline"
                  onClick={() => onCopySnippet(item.markdown, `asset-${item.key}`)}
                >
                  {mediaCopied === `asset-${item.key}` ? "copied" : "copy"}
                </button>
                <button type="button" className="underline" onClick={() => onAppendSnippet(item.markdown)}>
                  append
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
