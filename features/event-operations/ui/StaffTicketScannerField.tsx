import { CameraFeed } from "@/features/tickets/ui/CameraFeed";

export function StaffTicketScannerField({
  id,
  value,
  onChange,
  actionLabel,
  cameraOpen,
  onCameraOpenChange,
  busy,
  onSubmit,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  actionLabel: string;
  cameraOpen: boolean;
  onCameraOpenChange: (open: boolean) => void;
  busy: boolean;
  onSubmit: (raw?: string) => void;
}) {
  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label htmlFor={id} className="sr-only">
          Ticket code or QR
        </label>
        <div className="relative">
          <input
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="ticket reference"
            autoComplete="off"
            spellCheck={false}
            className="min-h-16 w-full rounded-2xl border theme-border-strong bg-transparent py-3 pl-4 pr-28 font-mono text-base outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
          />
          <button
            type="button"
            aria-label={cameraOpen ? "Close ticket camera" : "Scan ticket with camera"}
            onClick={() => onCameraOpenChange(!cameraOpen)}
            aria-expanded={cameraOpen}
            aria-controls={`${id}-camera`}
            className="absolute inset-y-2 right-2 min-w-24 rounded-xl bg-foreground px-3 font-mono text-xs text-background transition-opacity hover:opacity-80"
          >
            {cameraOpen ? "close QR" : "scan QR"}
          </button>
        </div>
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="mh-action mh-action--primary mt-3 w-full disabled:opacity-50"
        >
          {busy ? "working…" : actionLabel}
        </button>
      </form>
      {cameraOpen ? (
        <div id={`${id}-camera`} className="mt-4 max-w-sm">
          <CameraFeed paused={busy} onCode={(raw) => onSubmit(raw)} />
        </div>
      ) : null}
    </div>
  );
}
