export function AdminLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="border-y theme-border py-5 font-mono text-xs theme-muted" role="status">
      {label}
    </p>
  );
}

export function AdminLoadError({
  message,
  retry,
  retrying = false,
}: {
  message: string;
  retry: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="border-y theme-border py-5" role="alert">
      <p className="font-mono text-xs text-[var(--status-danger)]">{message}</p>
      <button
        type="button"
        disabled={retrying}
        onClick={retry}
        className="mt-2 min-h-11 font-mono text-xs underline underline-offset-4 disabled:opacity-50"
      >
        {retrying ? "retrying…" : "try again"}
      </button>
    </div>
  );
}
