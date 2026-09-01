import { useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import { EVENT_SCORING_TEMPLATES } from "@/features/event-scoring/templates";
import { SCORE_ECONOMY } from "@/features/event-scoring/types";
import type { AdminScoringActivity, ScoringAction, ScoringData } from "./event-scoring-types";
import { AdminStatus, adminToneForStatus } from "./AdminStatus";

const METHODS = ["qr", "code", "word", "phrase", "collected-clues"] as const;
const POINT_MODES = [
  "none",
  "once",
  "fixed-pool",
  "first-claimants",
  "one-winner",
  "diminishing",
  "per-clue",
  "completion",
  "per-clue-plus-completion",
] as const;

export function ScoringDiscoveriesPanel({
  activities,
  discoveries,
  onAction,
}: {
  activities: AdminScoringActivity[];
  discoveries: ScoringData["discoveries"];
  onAction: ScoringAction;
}) {
  const discoveryActivities = activities.filter((activity) => activity.template === "discovery");
  const [activityId, setActivityId] = useState(discoveryActivities[0]?.id ?? "");
  const [name, setName] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]>("qr");
  const [pointMode, setPointMode] = useState<(typeof POINT_MODES)[number]>("none");
  const [points, setPoints] = useState(3);
  const [completionBonus, setCompletionBonus] = useState(10);
  const [poolPoints, setPoolPoints] = useState(50);
  const [claimantLimit, setClaimantLimit] = useState("");
  const [claimFrequency, setClaimFrequency] = useState<"once" | "cooldown">("once");
  const [cooldownMinutes, setCooldownMinutes] = useState(5);
  const [maximumClaimsPerParticipant, setMaximumClaimsPerParticipant] = useState("");
  const [starterTemplateId, setStarterTemplateId] = useState("");
  const [tiers, setTiers] = useState("10, 7, 5");
  const [clues, setClues] = useState("one|First clue\ntwo|Second clue");
  const [issued, setIssued] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [testCredential, setTestCredential] = useState("");
  const [testResult, setTestResult] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const result = await onAction({
      action: "create-discovery",
      activityId: activityId || undefined,
      name,
      method,
      rule: {
        pointMode,
        pointsPerClue: points,
        completionBonus,
        poolPoints,
        ...(claimantLimit.trim()
          ? { claimantLimit: Math.max(1, Math.trunc(Number(claimantLimit))) }
          : {}),
        tiers: tiers
          .split(",")
          .map((value) => Number(value.trim()))
          .filter(Number.isFinite),
        requiresCheckIn: true,
        remainderAward: "discard",
        ...(method !== "collected-clues" && claimFrequency === "cooldown"
          ? {
              claimFrequency: "cooldown" as const,
              cooldownSeconds: Math.max(1, Math.round(cooldownMinutes * 60)),
              ...(maximumClaimsPerParticipant.trim()
                ? {
                    maximumClaimsPerParticipant: Math.max(
                      1,
                      Math.trunc(Number(maximumClaimsPerParticipant)),
                    ),
                  }
                : {}),
            }
          : { claimFrequency: "once" as const }),
      },
      clues:
        method === "collected-clues"
          ? clues.split("\n").flatMap((line) => {
              const [key, ...label] = line.split("|");
              return key?.trim() && label.join("|").trim()
                ? [{ key: key.trim(), label: label.join("|").trim() }]
                : [];
            })
          : undefined,
    });
    const discovery = result?.discovery as
      | { claimToken?: string; code?: string; clues?: Array<{ label: string; claimToken: string }> }
      | undefined;
    if (!discovery) return;
    setIssued([
      ...(discovery.code ? [`code: ${discovery.code}`] : []),
      ...(discovery.claimToken ? [`claim token: ${discovery.claimToken}`] : []),
      ...(discovery.clues ?? []).map((clue) => `${clue.label}: ${clue.claimToken}`),
    ]);
    setName("");
  }

  async function rotate(discoveryId: string) {
    const result = await onAction({ action: "replace-discovery-secret", discoveryId });
    if (typeof result?.claimToken === "string") setIssued([`replacement: ${result.claimToken}`]);
  }

  async function rotateClue(discoveryId: string, clueKey: string) {
    const result = await onAction({
      action: "replace-discovery-clue",
      discoveryId,
      clueKey,
    });
    if (typeof result?.claimToken === "string") {
      setIssued([`${clueKey} replacement: ${result.claimToken}`]);
    }
  }

  async function copy(discoveryId: string) {
    const result = await onAction({ action: "copy-discovery", discoveryId });
    const discovery = result?.discovery as
      | { claimToken?: string; code?: string; clues?: Array<{ label: string; claimToken: string }> }
      | undefined;
    if (!discovery) return;
    setIssued([
      ...(discovery.code ? [`code: ${discovery.code}`] : []),
      ...(discovery.claimToken ? [`claim token: ${discovery.claimToken}`] : []),
      ...(discovery.clues ?? []).map((clue) => `${clue.label}: ${clue.claimToken}`),
    ]);
  }

  return (
    <section aria-labelledby="scoring-discoveries-heading" className="border-t theme-border pt-6">
      <h4 id="scoring-discoveries-heading" className="font-serif text-xl">
        Discoveries
      </h4>
      <p className="mt-2 font-mono text-xs theme-muted">
        Hunts work on their own. Choose a point mode only when a claim should affect scoring.
      </p>
      <form onSubmit={(event) => void create(event)} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="font-mono text-xs sm:col-span-2">
          start from a template
          <AppSelect
            value={starterTemplateId}
            onValueChange={(value) => {
              setStarterTemplateId(value);
              const selected = EVENT_SCORING_TEMPLATES.find((item) => item.id === value);
              if (!selected || selected.kind !== "discovery" || !selected.method) return;
              setName(selected.label);
              setMethod(selected.method);
              setPoints(selected.rule.fixedPoints ?? 5);
            }}
            options={[
              { value: "", label: "Blank discovery" },
              ...EVENT_SCORING_TEMPLATES.filter((item) => item.kind === "discovery").map(
                (item) => ({
                  value: item.id,
                  label: item.label,
                }),
              ),
            ]}
            variant="field"
            ariaLabel="Discovery template"
            className="mt-2"
          />
        </label>
        <label className="font-mono text-xs">
          activity
          <AppSelect
            value={activityId}
            onValueChange={setActivityId}
            options={[
              { value: "", label: "No score activity" },
              ...discoveryActivities.map((activity) => ({
                value: activity.id,
                label: activity.name,
              })),
            ]}
            variant="field"
            ariaLabel="Score activity"
            className="mt-2"
          />
        </label>
        <label className="font-mono text-xs">
          name
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <label className="font-mono text-xs">
          claim method
          <AppSelect
            value={method}
            onValueChange={(value) => setMethod(value as typeof method)}
            options={METHODS.map((value) => ({
              value,
              label: value.replaceAll("-", " "),
            }))}
            variant="field"
            ariaLabel="Claim method"
            className="mt-2"
          />
          {(method === "code" || method === "word" || method === "phrase") && (
            <span className="mt-2 block theme-muted">
              Static codes can be photographed or shared. Use a claimant limit, short window, or QR
              replacement for valuable awards.
            </span>
          )}
        </label>
        <label className="font-mono text-xs">
          point mode
          <AppSelect
            value={pointMode}
            onValueChange={(value) => setPointMode(value as typeof pointMode)}
            options={POINT_MODES.map((value) => ({
              value,
              label: value.replaceAll("-", " "),
            }))}
            variant="field"
            ariaLabel="Point mode"
            className="mt-2"
          />
        </label>
        {pointMode !== "none" && (
          <label className="font-mono text-xs">
            points per clue
            <input
              type="number"
              min={0}
              max={SCORE_ECONOMY.maximumSingleAward}
              value={points}
              onChange={(event) => setPoints(Number(event.target.value))}
              className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
            />
          </label>
        )}
        {pointMode !== "none" && (
          <label className="font-mono text-xs">
            completion bonus
            <input
              type="number"
              min={0}
              max={SCORE_ECONOMY.maximumSingleAward}
              value={completionBonus}
              onChange={(event) => setCompletionBonus(Number(event.target.value))}
              className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
            />
          </label>
        )}
        {pointMode !== "none" && (
          <label className="font-mono text-xs">
            total pool
            <input
              type="number"
              min={0}
              value={poolPoints}
              onChange={(event) => setPoolPoints(Number(event.target.value))}
              className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
            />
          </label>
        )}
        <label className="font-mono text-xs">
          total claims — optional
          <input
            type="number"
            min={1}
            value={claimantLimit}
            onChange={(event) => setClaimantLimit(event.target.value)}
            placeholder="unlimited"
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        {method !== "collected-clues" && (
          <label className="font-mono text-xs">
            claims per person
            <AppSelect
              value={claimFrequency}
              onValueChange={(value) => setClaimFrequency(value as typeof claimFrequency)}
              options={[
                { value: "once", label: "once only" },
                { value: "cooldown", label: "repeat after cooldown" },
              ]}
              variant="field"
              ariaLabel="Claims per person"
              className="mt-2"
            />
          </label>
        )}
        {method !== "collected-clues" && claimFrequency === "cooldown" && (
          <>
            <label className="font-mono text-xs">
              cooldown in minutes
              <input
                type="number"
                min={1 / 60}
                max={10_080}
                step={1}
                required
                value={cooldownMinutes}
                onChange={(event) => setCooldownMinutes(Number(event.target.value))}
                className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
              />
            </label>
            <label className="font-mono text-xs">
              maximum claims per person — optional
              <input
                type="number"
                min={1}
                max={10_000}
                value={maximumClaimsPerParticipant}
                onChange={(event) => setMaximumClaimsPerParticipant(event.target.value)}
                placeholder="unlimited"
                className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
              />
            </label>
            <p className="font-mono text-xs theme-muted sm:col-span-2">
              Each successful repeat creates a new score transaction. Fixed-pool discoveries stop
              when their pool is empty.
            </p>
          </>
        )}
        <button
          type="button"
          onClick={() => setAdvanced((value) => !value)}
          aria-expanded={advanced}
          className="min-h-11 text-left font-mono text-xs underline hover:opacity-70 sm:col-span-2"
        >
          {advanced ? "hide advanced settings" : "show advanced settings"}
        </button>
        {advanced && (
          <label className="font-mono text-xs sm:col-span-2">
            diminishing tiers
            <input
              value={tiers}
              onChange={(event) => setTiers(event.target.value)}
              className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
            />
          </label>
        )}
        {method === "collected-clues" && (
          <label className="font-mono text-xs sm:col-span-2">
            clues — one key|label per line
            <textarea
              required
              rows={4}
              value={clues}
              onChange={(event) => setClues(event.target.value)}
              className="mt-2 w-full border theme-border bg-transparent p-3"
            />
          </label>
        )}
        <button className="min-h-11 border border-foreground px-4 font-mono text-xs hover:opacity-70">
          create draft discovery
        </button>
      </form>
      {issued.length > 0 && (
        <div className="mt-5 border-y theme-border py-4" role="status">
          <p className="font-mono text-xs">Copy these credentials now.</p>
          {issued.map((value) => (
            <input
              key={value}
              readOnly
              value={value}
              onFocus={(event) => event.currentTarget.select()}
              className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3 font-mono text-xs"
            />
          ))}
        </div>
      )}
      <ul className="mt-5 divide-y theme-border border-y theme-border">
        {discoveries.map((discovery) => (
          <li key={discovery.id} className="flex flex-wrap items-center gap-3 py-3">
            <span className="min-w-0 flex-1 font-serif">{discovery.name}</span>
            <span className="flex flex-wrap items-center gap-x-2 font-mono text-micro theme-muted">
              <span>{discovery.method}</span>
              <span aria-hidden="true">·</span>
              <AdminStatus tone={adminToneForStatus(discovery.status)}>
                {discovery.status}
              </AdminStatus>
              {discovery.rule.claimFrequency === "cooldown" &&
              typeof discovery.rule.cooldownSeconds === "number" ? (
                <span>· repeats every {Math.ceil(discovery.rule.cooldownSeconds / 60)} min</span>
              ) : null}
            </span>
            {discovery.method !== "collected-clues" && (
              <button
                type="button"
                onClick={() => void rotate(discovery.id)}
                className="min-h-11 px-2 font-mono text-micro underline hover:opacity-70"
              >
                replace credential
              </button>
            )}
            <button
              type="button"
              onClick={() => void copy(discovery.id)}
              className="min-h-11 px-2 font-mono text-micro underline hover:opacity-70"
            >
              copy
            </button>
            {(discovery.status === "draft" || discovery.status === "scheduled") && (
              <button
                type="button"
                onClick={() =>
                  void onAction({
                    action: "update-discovery",
                    discoveryId: discovery.id,
                    status: "live",
                  })
                }
                className="min-h-11 px-2 font-mono text-micro underline hover:opacity-70"
              >
                start
              </button>
            )}
            {discovery.status === "live" && (
              <button
                type="button"
                onClick={() =>
                  void onAction({
                    action: "update-discovery",
                    discoveryId: discovery.id,
                    status: "paused",
                  })
                }
                className="min-h-11 px-2 font-mono text-micro underline hover:opacity-70"
              >
                pause
              </button>
            )}
            {discovery.status === "paused" && (
              <button
                type="button"
                onClick={() =>
                  void onAction({
                    action: "update-discovery",
                    discoveryId: discovery.id,
                    status: "live",
                  })
                }
                className="min-h-11 px-2 font-mono text-micro underline hover:opacity-70"
              >
                resume
              </button>
            )}
            {["live", "paused"].includes(discovery.status) && (
              <button
                type="button"
                onClick={() =>
                  void onAction({
                    action: "update-discovery",
                    discoveryId: discovery.id,
                    status: "ended",
                  })
                }
                className="min-h-11 px-2 font-mono text-micro underline hover:opacity-70"
              >
                close
              </button>
            )}
            {!["ended", "cancelled"].includes(discovery.status) && (
              <button
                type="button"
                onClick={() =>
                  void onAction({
                    action: "update-discovery",
                    discoveryId: discovery.id,
                    status: "cancelled",
                  })
                }
                className="min-h-11 px-2 font-mono text-micro underline hover:opacity-70"
              >
                cancel
              </button>
            )}
            {discovery.clues.map((clue) => (
              <button
                key={clue.key}
                type="button"
                onClick={() => void rotateClue(discovery.id, clue.key)}
                className="min-h-11 px-2 font-mono text-micro underline hover:opacity-70"
              >
                replace {clue.label}
              </button>
            ))}
          </li>
        ))}
      </ul>
      {discoveries.length > 0 && (
        <form
          className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void onAction({
              action: "test-discovery",
              discoveryId: discoveries[0]?.id,
              presented: testCredential,
            }).then((result) => {
              const test = result?.test as { matched?: boolean; liveState?: string } | undefined;
              setTestResult(
                test?.matched
                  ? `Credential is valid. Live state: ${test.liveState}. No points were issued.`
                  : "Credential did not match. No points were issued.",
              );
            });
          }}
        >
          <label className="font-mono text-xs">
            test credential without issuing points
            <input
              required
              value={testCredential}
              onChange={(event) => setTestCredential(event.target.value)}
              className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
            />
          </label>
          <button className="min-h-11 self-end border theme-border px-4 font-mono text-xs hover:opacity-70">
            run test
          </button>
          {testResult && (
            <p className="font-mono text-xs sm:col-span-2" role="status">
              <AdminStatus
                tone={testResult.startsWith("Credential is valid") ? "positive" : "danger"}
              >
                {testResult}
              </AdminStatus>
            </p>
          )}
        </form>
      )}
    </section>
  );
}
