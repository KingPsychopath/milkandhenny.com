import { useState } from "react";

import type { AdminScoringActivity, ScoringAction, ScoringData } from "./event-scoring-types";

const METHODS = ["qr", "code", "word", "phrase", "collected-clues"] as const;
const POINT_MODES = [
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
  const [pointMode, setPointMode] = useState<(typeof POINT_MODES)[number]>("once");
  const [points, setPoints] = useState(3);
  const [completionBonus, setCompletionBonus] = useState(10);
  const [poolPoints, setPoolPoints] = useState(50);
  const [claimantLimit, setClaimantLimit] = useState(10);
  const [tiers, setTiers] = useState("10, 7, 5");
  const [clues, setClues] = useState("one|First clue\ntwo|Second clue");
  const [issued, setIssued] = useState<string[]>([]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const result = await onAction({
      action: "create-discovery",
      activityId,
      name,
      method,
      rule: {
        pointMode,
        pointsPerClue: points,
        completionBonus,
        poolPoints,
        claimantLimit,
        tiers: tiers
          .split(",")
          .map((value) => Number(value.trim()))
          .filter(Number.isFinite),
        requiresCheckIn: true,
        remainderAward: "discard",
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
      {discoveryActivities.length === 0 ? (
        <p className="mt-3 font-mono text-xs theme-muted">Create a discovery activity first.</p>
      ) : (
        <form onSubmit={(event) => void create(event)} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="font-mono text-xs">
            activity
            <select
              value={activityId}
              onChange={(event) => setActivityId(event.target.value)}
              className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
            >
              {discoveryActivities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.name}
                </option>
              ))}
            </select>
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
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value as typeof method)}
              className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
            >
              {METHODS.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("-", " ")}
                </option>
              ))}
            </select>
            {(method === "code" || method === "word" || method === "phrase") && (
              <span className="mt-2 block theme-muted">
                Static codes can be photographed or shared. Use a claimant limit, short window, or
                QR replacement for valuable awards.
              </span>
            )}
          </label>
          <label className="font-mono text-xs">
            point mode
            <select
              value={pointMode}
              onChange={(event) => setPointMode(event.target.value as typeof pointMode)}
              className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
            >
              {POINT_MODES.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("-", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="font-mono text-xs">
            points per clue
            <input
              type="number"
              min={0}
              value={points}
              onChange={(event) => setPoints(Number(event.target.value))}
              className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
            />
          </label>
          <label className="font-mono text-xs">
            completion bonus
            <input
              type="number"
              min={0}
              value={completionBonus}
              onChange={(event) => setCompletionBonus(Number(event.target.value))}
              className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
            />
          </label>
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
          <label className="font-mono text-xs">
            claimant limit
            <input
              type="number"
              min={1}
              value={claimantLimit}
              onChange={(event) => setClaimantLimit(Number(event.target.value))}
              className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
            />
          </label>
          <label className="font-mono text-xs sm:col-span-2">
            diminishing tiers
            <input
              value={tiers}
              onChange={(event) => setTiers(event.target.value)}
              className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
            />
          </label>
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
      )}
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
            <span className="font-mono text-micro theme-muted">
              {discovery.method} · {discovery.status}
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
    </section>
  );
}
