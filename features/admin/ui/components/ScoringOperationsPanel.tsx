import type { ScoringData } from "./event-scoring-types";

export function ScoringOperationsPanel({ operations }: { operations: ScoringData["operations"] }) {
  const measures = [
    ["score writes", operations.scoreWrites],
    ["rejected", operations.rejectedCommands],
    ["held", operations.heldActions],
    ["projection drift", operations.projectionDrift],
    ["exhausted pools", operations.exhaustedPools],
    ["discovery claims", operations.discoveryClaims],
    ["media failures", operations.mediaFailures],
    ["session failures", operations.sessionFailures],
  ] as const;
  return (
    <section aria-labelledby="scoring-operations-heading" className="border-t theme-border pt-6">
      <h4 id="scoring-operations-heading" className="font-serif text-xl">
        Operations
      </h4>
      <p className="mt-2 font-mono text-xs theme-muted">
        Private aggregate for the last {operations.windowMinutes} minutes. No personal data is
        included.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-px border theme-border bg-[var(--theme-border)] sm:grid-cols-4">
        {measures.map(([label, value]) => (
          <div key={label} className="bg-background p-3">
            <dt className="font-mono text-micro theme-muted">{label}</dt>
            <dd className="mt-1 font-serif text-xl">{value}</dd>
          </div>
        ))}
      </dl>
      {operations.alerts.length > 0 && (
        <ul className="mt-4 border-y theme-border" aria-label="Scoring alerts">
          {operations.alerts.map((alert) => (
            <li key={alert.code} className="py-3 font-mono text-xs">
              {alert.severity}: {alert.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
