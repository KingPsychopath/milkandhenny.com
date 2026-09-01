import { useCallback, useEffect, useMemo, useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import type { GamePoolEntrance, GamePoolGame } from "@/features/things/pool/types";
import { maximumRulePoints } from "@/features/event-scoring/types";

import { AdminStatus, adminToneForStatus } from "./AdminStatus";
import type { ScoringAction, ScoringData } from "./event-scoring-types";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

const GAME_OPTIONS: Array<{ key: string; label: string; poolGame?: GamePoolGame }> = [
  { key: "centre", label: "Centre", poolGame: "centre" },
  { key: "hot-and-cold", label: "Hot & Cold", poolGame: "hot-and-cold" },
  { key: "same-brain", label: "Same Brain", poolGame: "same-brain" },
  { key: "draw-country", label: "Draw the Country", poolGame: "draw-country" },
  { key: "spelling-bee", label: "Spelling Bee" },
  { key: "heads-up", label: "Heads Up" },
  { key: "family-feud", label: "Family Feud" },
  { key: "beer-pong", label: "Beer Pong" },
  { key: "dobble", label: "Dobble" },
  { key: "jenga", label: "Jenga" },
  { key: "connect-four", label: "Connect Four" },
  { key: "chess", label: "Chess" },
];

function activityPoints(activity: ScoringData["activities"][number]) {
  if (activity.rule.mode === "placement") {
    return Object.entries(activity.rule.placementPoints ?? {})
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(
        ([place, points]) =>
          `${place}${place === "1" ? "st" : place === "2" ? "nd" : "rd"} ${points}`,
      )
      .join(" · ");
  }
  const points = maximumRulePoints(activity.rule);
  return points === undefined ? "configured score" : `${points} pt${points === 1 ? "" : "s"}`;
}

export function ScoringGamesPanel({
  authFetch,
  eventGames,
  activities,
  onAction,
}: {
  authFetch: AuthFetch;
  eventGames: ScoringData["eventGames"];
  activities: ScoringData["activities"];
  onAction: ScoringAction;
}) {
  const [entrances, setEntrances] = useState<GamePoolEntrance[]>([]);
  const [entranceError, setEntranceError] = useState("");
  const [editingKey, setEditingKey] = useState("");
  const [gameKey, setGameKey] = useState(GAME_OPTIONS[0].key);
  const [label, setLabel] = useState(GAME_OPTIONS[0].label);
  const [playMode, setPlayMode] = useState<"pooled" | "hosted" | "table">("pooled");
  const [poolEntranceId, setPoolEntranceId] = useState("");
  const [awardMethod, setAwardMethod] = useState<"staff" | "automatic">("automatic");
  const [activityIds, setActivityIds] = useState<string[]>([]);
  const [status, setStatus] = useState<"included" | "paused">("included");

  const loadEntrances = useCallback(async () => {
    try {
      const response = await authFetch("/api/admin/game-pools");
      const result = (await response.json().catch(() => null)) as {
        entrances?: GamePoolEntrance[];
        error?: string;
      } | null;
      if (!response.ok) throw new Error(result?.error ?? "Could not load pooled entrances");
      setEntrances(result?.entrances ?? []);
      setEntranceError("");
    } catch (error) {
      setEntranceError(error instanceof Error ? error.message : "Could not load pooled entrances");
    }
  }, [authFetch]);

  useEffect(() => {
    void loadEntrances();
  }, [loadEntrances]);

  const selectedOption = GAME_OPTIONS.find((option) => option.key === gameKey);
  const compatibleEntrances = useMemo(
    () =>
      entrances.filter(
        (entrance) => !entrance.retiredAt && entrance.game === selectedOption?.poolGame,
      ),
    [entrances, selectedOption?.poolGame],
  );

  function chooseGame(nextKey: string) {
    const option = GAME_OPTIONS.find((candidate) => candidate.key === nextKey) ?? GAME_OPTIONS[0];
    setGameKey(option.key);
    setLabel(option.label);
    setPlayMode(option.poolGame ? "pooled" : "hosted");
    setPoolEntranceId("");
    setAwardMethod(option.poolGame ? "automatic" : "staff");
  }

  function edit(item: ScoringData["eventGames"][number]) {
    setEditingKey(item.gameKey);
    setGameKey(item.gameKey);
    setLabel(item.label);
    setPlayMode(item.playMode);
    setPoolEntranceId(item.poolEntranceId ?? "");
    setAwardMethod(item.awardMethod);
    setActivityIds(item.activityIds);
    setStatus(item.status);
  }

  function reset() {
    setEditingKey("");
    chooseGame(GAME_OPTIONS[0].key);
    setActivityIds([]);
    setStatus("included");
  }

  async function save() {
    const result = await onAction({
      action: "upsert-event-game",
      gameKey,
      label,
      playMode,
      poolEntranceId: playMode === "pooled" ? poolEntranceId : undefined,
      awardMethod,
      activityIds,
      status,
    });
    if (result) reset();
  }

  return (
    <section className="border-y theme-border py-6" aria-labelledby="scoring-games-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
            included games
          </p>
          <h4 id="scoring-games-heading" className="mt-1 font-serif text-xl font-semibold">
            One event game register
          </h4>
        </div>
        <a
          href="/admin?view=games"
          className="inline-flex min-h-11 items-center font-mono text-xs underline underline-offset-4"
        >
          manage pooled entrances
        </a>
      </div>
      <p className="mt-2 max-w-2xl font-mono text-xs leading-relaxed theme-muted">
        This is the source of truth for what earns points tonight. Supported pooled and hosted games
        can publish their official result automatically; physical table games stay with staff.
      </p>

      {eventGames.length === 0 ? (
        <p className="mt-5 border-y theme-border py-4 font-mono text-xs theme-muted">
          No games are included yet. Add the games guests may score from below.
        </p>
      ) : (
        <ul className="mt-5 divide-y theme-border border-y theme-border">
          {eventGames.map((item) => {
            const entrance = entrances.find((candidate) => candidate.id === item.poolEntranceId);
            const itemActivities = item.activityIds
              .map((id) => activities.find((activity) => activity.id === id))
              .filter((activity): activity is ScoringData["activities"][number] =>
                Boolean(activity),
              );
            return (
              <li key={item.id} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-serif text-lg font-semibold">{item.label}</p>
                      <AdminStatus tone={adminToneForStatus(item.status)}>
                        {item.status}
                      </AdminStatus>
                    </div>
                    <p className="mt-1 font-mono text-xs theme-muted">
                      {item.playMode === "pooled"
                        ? `${entrance?.label ?? "Pooled entrance missing"} · ${entrance?.run?.status ?? "closed"}`
                        : item.playMode === "hosted"
                          ? "hosted game"
                          : "table game"}
                      {" · "}
                      {item.awardMethod === "automatic"
                        ? "automatic managed result"
                        : "staff records result"}
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
                      {itemActivities.map((activity) => (
                        <li key={activity.id}>
                          {activity.name}: {activityPoints(activity)}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button
                    type="button"
                    onClick={() => edit(item)}
                    className="min-h-11 px-2 font-mono text-xs underline underline-offset-4"
                  >
                    edit
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6">
        <p className="font-mono text-xs font-semibold">
          {editingKey ? `Edit ${label}` : "Include a game"}
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="font-mono text-xs theme-muted">
            game
            <AppSelect
              value={gameKey}
              onValueChange={chooseGame}
              options={GAME_OPTIONS.map((option) => ({ value: option.key, label: option.label }))}
              disabled={Boolean(editingKey)}
              ariaLabel="Game"
              variant="field"
              className="mt-2"
            />
          </label>
          <label className="font-mono text-xs theme-muted">
            guest-facing label
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={120}
              className="mt-2 min-h-11 w-full border-b theme-border bg-transparent text-foreground"
            />
          </label>
          <label className="font-mono text-xs theme-muted">
            how guests play
            <AppSelect
              value={playMode}
              onValueChange={(value) => {
                const mode = value as typeof playMode;
                setPlayMode(mode);
                if (mode !== "pooled") setPoolEntranceId("");
                if (mode === "pooled" && selectedOption?.poolGame) setAwardMethod("automatic");
              }}
              options={[
                { value: "pooled", label: "pooled QR" },
                { value: "hosted", label: "hosted game" },
                { value: "table", label: "table game" },
              ]}
              ariaLabel="How guests play"
              variant="field"
              className="mt-2"
            />
          </label>
          {playMode === "pooled" ? (
            <label className="font-mono text-xs theme-muted">
              pooled entrance
              <AppSelect
                value={poolEntranceId}
                onValueChange={setPoolEntranceId}
                options={[
                  { value: "", label: "Choose entrance" },
                  ...compatibleEntrances.map((entrance) => ({
                    value: entrance.id,
                    label: `${entrance.label} · ${entrance.run?.status ?? "closed"}`,
                  })),
                ]}
                ariaLabel="Pooled entrance"
                variant="field"
                className="mt-2"
              />
            </label>
          ) : null}
          <label className="font-mono text-xs theme-muted">
            result method
            <AppSelect
              value={awardMethod}
              onValueChange={(value) => {
                const method = value as typeof awardMethod;
                setAwardMethod(method);
                if (method === "automatic" && activityIds.length > 1)
                  setActivityIds(activityIds.slice(0, 1));
              }}
              options={[
                { value: "automatic", label: "official result · automatic" },
                { value: "staff", label: "staff records result" },
              ]}
              ariaLabel="Result method"
              variant="field"
              className="mt-2"
            />
          </label>
          <label className="font-mono text-xs theme-muted">
            event status
            <AppSelect
              value={status}
              onValueChange={(value) => setStatus(value as typeof status)}
              options={[
                { value: "included", label: "included" },
                { value: "paused", label: "paused" },
              ]}
              ariaLabel="Event game status"
              variant="field"
              className="mt-2"
            />
          </label>
        </div>

        <fieldset className="mt-5 border-y theme-border py-4">
          <legend className="font-mono text-xs font-semibold">points awarded</legend>
          <div className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2">
            {activities.map((activity) => (
              <label
                key={activity.id}
                className="flex min-h-11 items-center gap-3 font-mono text-xs"
              >
                <input
                  type="checkbox"
                  checked={activityIds.includes(activity.id)}
                  onChange={(event) =>
                    setActivityIds((current) =>
                      event.target.checked
                        ? awardMethod === "automatic"
                          ? [activity.id]
                          : [...current, activity.id]
                        : current.filter((id) => id !== activity.id),
                    )
                  }
                />
                <span>
                  {activity.name} <span className="theme-muted">· {activityPoints(activity)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {entranceError ? (
          <p className="mt-3 font-mono text-xs" role="alert">
            <AdminStatus tone="danger">{entranceError}</AdminStatus>
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={
              !label.trim() ||
              activityIds.length === 0 ||
              (playMode === "pooled" && !poolEntranceId)
            }
            className="min-h-11 rounded-full bg-foreground px-5 font-mono text-xs text-background disabled:opacity-40"
          >
            {editingKey ? "save game" : "include game"}
          </button>
          {editingKey ? (
            <>
              <button
                type="button"
                onClick={reset}
                className="min-h-11 px-3 font-mono text-xs underline underline-offset-4"
              >
                cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm(`Remove ${label} from this event?`)) return;
                  const result = await onAction({ action: "remove-event-game", gameKey });
                  if (result) reset();
                }}
                className="min-h-11 px-3 font-mono text-xs text-[var(--danger)] underline underline-offset-4"
              >
                remove from event
              </button>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
