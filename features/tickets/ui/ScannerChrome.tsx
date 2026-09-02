import type { ReactNode } from "react";

export function ScannerHeader({
  mode,
  title,
  eventTitle,
  helperLabel,
  status,
  action,
}: {
  mode: "entry" | "checkpoint";
  title: string;
  eventTitle: string;
  helperLabel?: string;
  status: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="border-b theme-border pb-5">
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-micro uppercase tracking-[0.16em] theme-muted">
          {mode === "entry" ? "door · entry" : "checkpoint"}
        </p>
        {action}
      </div>
      <div className="mt-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-serif text-3xl leading-none text-foreground">{title}</h1>
          <p className="mt-2 truncate font-mono text-micro theme-muted">
            {eventTitle}
            {helperLabel ? ` · ${helperLabel}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right font-mono text-xs text-foreground">{status}</div>
      </div>
    </header>
  );
}

export function ScannerSearch({
  id,
  value,
  onChange,
  onCameraToggle,
  cameraOpen,
  children,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onCameraToggle: () => void;
  cameraOpen: boolean;
  children?: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="font-mono text-micro uppercase tracking-[0.12em] theme-muted">
        find a guest
      </label>
      <div className="relative mt-2">
        <input
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="name or ticket reference"
          className="min-h-16 w-full appearance-none rounded-2xl border theme-border-strong bg-transparent py-3 pl-4 pr-28 font-mono text-base text-foreground shadow-sm [&::-webkit-search-cancel-button]:appearance-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
        />
        <button
          type="button"
          onClick={onCameraToggle}
          aria-expanded={cameraOpen}
          aria-controls={`${id}-camera`}
          className="absolute inset-y-2 right-2 min-w-24 rounded-xl bg-foreground px-3 font-mono text-xs font-medium text-background transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
        >
          {cameraOpen ? "close QR" : "scan QR"}
        </button>
      </div>
      {children}
    </div>
  );
}

export function ScannerResult({
  tone,
  label,
  title,
  detail,
  children,
}: {
  tone: "positive" | "attention" | "danger";
  label: string;
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <section
      aria-live={tone === "danger" ? "assertive" : "polite"}
      className={`scanner-result scanner-result--${tone}`}
    >
      <p className="scanner-result__label">{label}</p>
      <p className="mt-2 font-serif text-3xl font-bold leading-none text-foreground">{title}</p>
      <p className="mt-2 font-mono text-xs leading-relaxed text-foreground">{detail}</p>
      {children}
    </section>
  );
}

export function ScannerMatches({ children }: { children: ReactNode }) {
  return <ul className="mt-2 overflow-hidden rounded-2xl border theme-border">{children}</ul>;
}
