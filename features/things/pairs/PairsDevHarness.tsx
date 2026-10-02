import { useState } from "react";
import { PairsApp } from "./PairsApp";
import { PAIRS_SCENARIOS, pairsScenario } from "./pairs-scenarios";
import type { PairsScenario } from "./pairs-scenarios";
import { PairsRaceDevHarness } from "./PairsRaceDevHarness";

export function PairsDevHarness() {
  const [scenario, setScenario] = useState<PairsScenario>("default table");
  const [run, setRun] = useState(0);
  return (
    <>
      <nav
        aria-label="Pairs development scenarios"
        className="flex flex-wrap gap-3 border-b theme-border p-4 font-mono text-xs"
      >
        <span className="self-center">development · shared device · deterministic seed 404</span>
        {PAIRS_SCENARIOS.map((name) => (
          <button
            key={name}
            type="button"
            className="mh-action mh-action--secondary"
            aria-pressed={name === scenario}
            onClick={() => {
              setScenario(name);
              setRun(run + 1);
            }}
          >
            {name}
          </button>
        ))}
      </nav>
      <PairsApp
        key={`${scenario}:${run}`}
        initialRecord={pairsScenario(scenario)}
        recovery={false}
      />
      <PairsRaceDevHarness />
    </>
  );
}
