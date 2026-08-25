import type { ScoringData } from "./event-scoring-types";

export function ScoringAuditPanel({
  audit,
  onExport,
}: {
  audit: ScoringData["audit"];
  onExport: () => Promise<void>;
}) {
  return (
    <section aria-labelledby="scoring-audit-heading" className="border-t theme-border pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 id="scoring-audit-heading" className="font-serif text-xl">
            Audit and export
          </h4>
          <p className="mt-2 font-mono text-xs theme-muted">
            The export omits bearer credentials and includes the latest 500 audit events.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onExport()}
          className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70"
        >
          download export
        </button>
      </div>
      <ol className="mt-4 max-h-80 divide-y theme-border overflow-y-auto border-y theme-border">
        {audit.map((entry) => (
          <li
            key={entry.id}
            className="grid gap-1 py-3 font-mono text-micro sm:grid-cols-[1fr_auto]"
          >
            <span>
              {entry.action} · {entry.entityType}
            </span>
            <time className="theme-muted" dateTime={entry.createdAt}>
              {new Date(entry.createdAt).toLocaleString()}
            </time>
            <span className="theme-muted">
              actor: {entry.actorType}
              {entry.actorId ? ` (${entry.actorId})` : ""}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
