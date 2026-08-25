import { useState } from "react";

import type { AdminScoringPool, ScoringAction } from "./event-scoring-types";

export function ScoringPoolsPanel({
  pools,
  onAction,
}: {
  pools: AdminScoringPool[];
  onAction: ScoringAction;
}) {
  const [adjustments, setAdjustments] = useState<Record<string, number>>({});
  return (
    <section aria-labelledby="scoring-pools-heading" className="border-t theme-border pt-6">
      <h4 id="scoring-pools-heading" className="font-serif text-xl">
        Point pools
      </h4>
      {pools.length === 0 ? (
        <p className="mt-3 font-mono text-xs theme-muted">No point pools issued.</p>
      ) : (
        <ul className="mt-4 divide-y theme-border border-y theme-border">
          {pools.map((pool) => (
            <li key={pool.id} className="py-4">
              <p className="font-mono text-xs">
                {pool.ownerType} · {pool.available} available
              </p>
              <p className="mt-1 font-mono text-micro theme-muted">
                {pool.issued} issued · {pool.reserved} reserved · {pool.spent} spent · {pool.held}{" "}
                held
              </p>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onAction({
                    action: "adjust-pool",
                    poolId: pool.id,
                    delta: adjustments[pool.id] ?? 0,
                  });
                }}
              >
                <label className="sr-only" htmlFor={`pool-${pool.id}`}>
                  Add or reclaim points
                </label>
                <input
                  id={`pool-${pool.id}`}
                  type="number"
                  value={adjustments[pool.id] ?? 0}
                  onChange={(event) =>
                    setAdjustments((current) => ({
                      ...current,
                      [pool.id]: Number(event.target.value),
                    }))
                  }
                  className="min-h-11 w-32 border theme-border bg-transparent px-3 font-mono text-xs"
                />
                <button className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70">
                  apply
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
