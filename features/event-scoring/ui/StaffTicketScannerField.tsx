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
        <div className="flex min-h-12 items-stretch border theme-border focus-within:border-foreground">
          <input
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="ticket code or QR"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent px-3 font-mono text-xs outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="border-l theme-border px-3 font-mono text-xs disabled:opacity-50"
          >
            {actionLabel}
          </button>
          <button
            type="button"
            aria-label={cameraOpen ? "Close ticket camera" : "Scan ticket with camera"}
            title={cameraOpen ? "Close camera" : "Scan ticket QR"}
            onClick={() => onCameraOpenChange(!cameraOpen)}
            className="grid min-w-11 place-items-center border-l theme-border hover:opacity-70"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M4 7.5h3l1.2-2h7.6l1.2 2h3v11H4z" />
              <circle cx="12" cy="13" r="3.25" />
            </svg>
          </button>
        </div>
      </form>
      {cameraOpen ? (
        <div className="mt-3 max-w-sm">
          <CameraFeed paused={busy} onCode={(raw) => onSubmit(raw)} />
        </div>
      ) : null}
    </div>
  );
}
