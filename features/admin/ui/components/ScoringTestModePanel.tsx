import { useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import {
  simulateScoreClaim,
  TEST_SCENARIOS,
  type TestScenario,
} from "@/features/event-scoring/test-mode";
import { convertRulePoints } from "@/features/event-scoring/types";
import type { ScoringData } from "./event-scoring-types";
import { AdminStatus, adminToneForStatus } from "./AdminStatus";

export function ScoringTestModePanel({ data }: { data: ScoringData }) {
  const [activityId, setActivityId] = useState(data.activities[0]?.id ?? "");
  const [scenario, setScenario] = useState<TestScenario>("valid");
  const activity = data.activities.find((entry) => entry.id === activityId);
  const result = activity
    ? simulateScoreClaim({
        scenario,
        status: activity.status,
        rule: activity.rule,
        previewPoints: convertRulePoints(activity.rule, { placement: 1, rawScore: 1 }),
      })
    : undefined;
  const clueCount = data.discoveries.reduce(
    (sum, discovery) => sum + Math.max(1, discovery.clues.length),
    0,
  );

  return (
    <section aria-labelledby="scoring-test-heading" className="border-t theme-border pt-6">
      <h4 id="scoring-test-heading" className="font-serif text-xl">
        Test mode
      </h4>
      <p className="mt-2 max-w-xl font-mono text-xs leading-relaxed theme-muted">
        Rehearse attendee and moderator outcomes. Test mode has no ledger, rank, or pool writer.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="font-mono text-xs">
          activity
          <AppSelect
            value={activityId}
            onValueChange={setActivityId}
            options={data.activities.map((entry) => ({ value: entry.id, label: entry.name }))}
            variant="field"
            ariaLabel="Activity"
            className="mt-2"
          />
        </label>
        <label className="font-mono text-xs">
          scenario
          <AppSelect
            value={scenario}
            onValueChange={(value) => setScenario(value as TestScenario)}
            options={TEST_SCENARIOS.map((entry) => ({ value: entry, label: entry }))}
            variant="field"
            ariaLabel="Test scenario"
            className="mt-2"
          />
        </label>
      </div>
      {result && (
        <div className="mt-4 border-y theme-border py-4" aria-live="polite">
          <p className="flex flex-wrap items-center gap-x-2 font-serif text-lg">
            <AdminStatus tone={adminToneForStatus(result.state)}>{result.state}</AdminStatus>
            <span>· {result.points} points</span>
          </p>
          <p className="mt-1 font-mono text-xs theme-muted">{result.reason}</p>
          <p className="mt-2 font-mono text-micro theme-subtle">
            live writes 0 · pool change 0 · rank change 0
          </p>
        </div>
      )}
      <p className="mt-3 font-mono text-xs theme-muted">
        {clueCount} of {clueCount} configured clue credentials passed source validation.
      </p>
      <p className="mt-1 font-mono text-micro theme-subtle">
        Test scenarios use labels, never live QR or staff credentials.
      </p>
    </section>
  );
}
