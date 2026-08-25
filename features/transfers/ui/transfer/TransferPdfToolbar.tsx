import type { FormEvent, ReactNode } from "react";

type Zoom = "fit" | number;

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

function nextZoom(current: Zoom, direction: -1 | 1): number {
  const value = current === "fit" ? 1 : current;
  const ordered = direction > 0 ? ZOOM_LEVELS : ZOOM_LEVELS.toReversed();
  return ordered.find((level) => (direction > 0 ? level > value : level < value)) ?? value;
}

function ReaderButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-11 min-w-11 items-center justify-center px-3 font-mono text-micro theme-subtle transition-opacity hover:opacity-60 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function PageField({
  id,
  page,
  totalPages,
  value,
  onChange,
  onSubmit,
}: {
  id: string;
  page: number;
  totalPages: number;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2 px-3">
      <label htmlFor={id} className="sr-only">
        Page number
      </label>
      <input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => onChange(String(page))}
        className="h-9 w-12 rounded-sm border theme-border bg-transparent px-2 text-center font-mono text-micro tabular-nums"
      />
      <span className="font-mono text-nano theme-muted">/ {totalPages}</span>
    </form>
  );
}

type TransferPdfToolbarProps = {
  filename: string;
  downloadUrl: string;
  page: number;
  totalPages: number | null;
  pageInput: string;
  zoom: Zoom;
  onPageInputChange: (value: string) => void;
  onPageSubmit: (event: FormEvent) => void;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: Zoom) => void;
  onRotate: () => void;
  onClose: () => void;
};

function TransferPdfToolbar({
  filename,
  downloadUrl,
  page,
  totalPages,
  pageInput,
  zoom,
  onPageInputChange,
  onPageSubmit,
  onPageChange,
  onZoomChange,
  onRotate,
  onClose,
}: TransferPdfToolbarProps) {
  return (
    <header className="shrink-0 border-b theme-border bg-background">
      <div className="flex min-h-14 items-center gap-1 px-2 sm:px-4">
        <div className="mr-auto min-w-0 px-2">
          <p id="transfer-pdf-title" className="truncate font-mono text-micro text-foreground">
            {filename}
          </p>
          <p className="font-mono text-nano theme-muted" aria-live="polite">
            {totalPages ? `page ${page} of ${totalPages}` : "opening PDF..."}
          </p>
        </div>

        {totalPages ? (
          <div className="hidden items-center divide-x theme-border sm:flex">
            <ReaderButton
              label="Previous page"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              ←
            </ReaderButton>
            <PageField
              id="pdf-page-number"
              page={page}
              totalPages={totalPages}
              value={pageInput}
              onChange={onPageInputChange}
              onSubmit={onPageSubmit}
            />
            <ReaderButton
              label="Next page"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              →
            </ReaderButton>
            <ReaderButton label="Zoom out" onClick={() => onZoomChange(nextZoom(zoom, -1))}>
              −
            </ReaderButton>
            <button
              type="button"
              onClick={() => onZoomChange("fit")}
              className="min-h-11 min-w-16 px-3 font-mono text-nano theme-subtle transition-opacity hover:opacity-60"
            >
              {zoom === "fit" ? "fit" : `${Math.round(zoom * 100)}%`}
            </button>
            <ReaderButton label="Zoom in" onClick={() => onZoomChange(nextZoom(zoom, 1))}>
              +
            </ReaderButton>
            <ReaderButton label="Rotate page clockwise" onClick={onRotate}>
              ↻
            </ReaderButton>
          </div>
        ) : null}

        <a
          href={downloadUrl}
          className="flex min-h-11 items-center px-3 font-mono text-micro text-amber-600 transition-opacity hover:opacity-60"
        >
          download
        </a>
        <ReaderButton label="Close PDF reader" onClick={onClose}>
          ✕
        </ReaderButton>
      </div>

      {totalPages ? (
        <div className="flex min-h-12 items-center justify-between border-t theme-border px-2 sm:hidden">
          <ReaderButton
            label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            ←
          </ReaderButton>
          <PageField
            id="pdf-mobile-page-number"
            page={page}
            totalPages={totalPages}
            value={pageInput}
            onChange={onPageInputChange}
            onSubmit={onPageSubmit}
          />
          <ReaderButton
            label="Next page"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            →
          </ReaderButton>
          <ReaderButton
            label="Toggle fit to width"
            onClick={() => onZoomChange(zoom === "fit" ? 1 : "fit")}
          >
            {zoom === "fit" ? "fit" : `${Math.round(zoom * 100)}%`}
          </ReaderButton>
        </div>
      ) : null}
    </header>
  );
}

export { nextZoom, TransferPdfToolbar };
export type { Zoom };
