import { useCallback, useEffect, useState } from "react";
import { useQrCode } from "@/hooks/useQrCode";
import { GAME_POOL_DEFAULTS } from "@/features/things/pool/presets";
import type {
  GamePoolEntrance,
  GamePoolGame,
  GamePoolNameVisibility,
  GamePoolPreset,
} from "@/features/things/pool/types";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

function EntranceQr({ entrance }: { entrance: GamePoolEntrance }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = origin ? `${origin}/play/${entrance.token}` : "";
  const { dataUrl, failed } = useQrCode(url || null, 320);
  return (
    <div className="mt-4 border-t theme-border pt-4">
      {dataUrl ? (
        <img src={dataUrl} alt={`QR code for ${entrance.label}`} className="size-48" />
      ) : null}
      {failed ? (
        <p className="font-mono text-xs theme-muted">
          QR generation failed. Copy the link instead.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-4">
        <button
          type="button"
          disabled={!url}
          onClick={() => void navigator.clipboard.writeText(url)}
          className="min-h-11 font-mono text-xs underline disabled:opacity-40"
        >
          copy player link
        </button>
        {dataUrl ? (
          <a
            download={`${entrance.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-qr.png`}
            href={dataUrl}
            className="inline-flex min-h-11 items-center font-mono text-xs underline"
          >
            download QR
          </a>
        ) : null}
      </div>
    </div>
  );
}

function PresetFields({
  preset,
  onChange,
}: {
  preset: GamePoolPreset;
  onChange: (preset: GamePoolPreset) => void;
}) {
  const numberField = (
    label: string,
    value: number,
    minimum: number,
    maximum: number,
    update: (value: number) => void,
  ) => (
    <label className="font-mono text-xs theme-muted">
      {label}
      <input
        type="number"
        min={minimum}
        max={maximum}
        value={value}
        onChange={(event) => update(Number(event.target.value))}
        className="mt-1 min-h-11 w-full border-b theme-border bg-transparent font-mono text-sm text-[var(--foreground)]"
      />
    </label>
  );
  if (preset.game === "same-brain")
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {numberField("rounds", preset.rounds, 3, 20, (rounds) => onChange({ ...preset, rounds }))}
        <label className="font-mono text-xs theme-muted">
          scoring
          <select
            value={preset.scoring}
            onChange={(event) =>
              onChange({
                ...preset,
                scoring: event.target.value === "exact" ? "exact" : "embedding",
              })
            }
            className="mt-1 min-h-11 w-full border-b theme-border bg-transparent text-[var(--foreground)]"
          >
            <option value="embedding">meaning</option>
            <option value="exact">exact words</option>
          </select>
        </label>
        <PoolCheck
          label="say answers aloud"
          checked={preset.sayItAloud}
          onChange={(sayItAloud) => onChange({ ...preset, sayItAloud })}
        />
        <PoolCheck
          label="eliminate the odd one"
          checked={preset.eliminateOddOne}
          onChange={(eliminateOddOne) => onChange({ ...preset, eliminateOddOne })}
        />
      </div>
    );
  if (preset.game === "liars")
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="font-mono text-xs theme-muted">
          mode
          <select
            value={preset.mode}
            onChange={(event) =>
              onChange({
                ...preset,
                mode: event.target.value === "imposter" ? "imposter" : "mafia",
              })
            }
            className="mt-1 min-h-11 w-full border-b theme-border bg-transparent text-[var(--foreground)]"
          >
            <option value="mafia">mafia</option>
            <option value="imposter">imposter</option>
          </select>
        </label>
        <PoolCheck
          label="first-game rules"
          checked={preset.firstGame}
          onChange={(firstGame) => onChange({ ...preset, firstGame })}
        />
        <PoolCheck
          label="blind imposters"
          checked={preset.blindImposters}
          onChange={(blindImposters) => onChange({ ...preset, blindImposters })}
        />
        <PoolCheck
          label="shared word board"
          checked={preset.wordBoard}
          onChange={(wordBoard) => onChange({ ...preset, wordBoard })}
        />
      </div>
    );
  if (preset.game === "centre")
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {numberField("difficulty", preset.difficulty, 1, 5, (value) =>
          onChange({ ...preset, difficulty: Math.max(1, Math.min(5, value)) as 1 | 2 | 3 | 4 | 5 }),
        )}
        <PoolCheck
          label="delayed rival dots"
          checked={preset.delayedRivals}
          onChange={(delayedRivals) => onChange({ ...preset, delayedRivals })}
        />
      </div>
    );
  if (preset.game === "twin")
    return (
      <div>
        {numberField("starting hand", preset.handSize, 3, 20, (handSize) =>
          onChange({ ...preset, handSize }),
        )}
      </div>
    );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {numberField("seconds to draw", preset.drawSeconds, 15, 120, (drawSeconds) =>
        onChange({ ...preset, drawSeconds }),
      )}
      {numberField("rounds", preset.roundTotal, 1, 12, (roundTotal) =>
        onChange({ ...preset, roundTotal }),
      )}
    </div>
  );
}

function PoolCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3 font-mono text-xs theme-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

export function GamePoolsPanel({
  authFetch,
  onError,
  onStatus,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const [entrances, setEntrances] = useState<GamePoolEntrance[]>([]);
  const [loading, setLoading] = useState(false);
  const [game, setGame] = useState<GamePoolGame>("same-brain");
  const [label, setLabel] = useState("");
  const [duration, setDuration] = useState(240);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, GamePoolEntrance>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch("/api/admin/game-pools");
      const data = (await response.json().catch(() => ({}))) as {
        entrances?: GamePoolEntrance[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Failed to load game entrances");
      const next = data.entrances ?? [];
      setEntrances(next);
      setDrafts(Object.fromEntries(next.map((entrance) => [entrance.id, entrance])));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to load game entrances");
    } finally {
      setLoading(false);
    }
  }, [authFetch, onError]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    setLoading(true);
    onError("");
    try {
      const response = await authFetch("/api/admin/game-pools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ game, label: label || GAME_POOL_DEFAULTS[game].label }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to create game entrance");
      setLabel("");
      onStatus("Game entrance created.");
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to create game entrance");
    } finally {
      setLoading(false);
    }
  };

  const control = async (id: string, action: "open" | "pause" | "resume" | "close") => {
    setLoading(true);
    onError("");
    try {
      const response = await authFetch(`/api/admin/game-pools/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, durationMinutes: duration }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to control game entrance");
      onStatus(action === "open" ? "Game entrance opened." : `Game entrance ${action}d.`);
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to control game entrance");
    } finally {
      setLoading(false);
    }
  };

  const save = async (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    setLoading(true);
    onError("");
    try {
      const response = await authFetch(`/api/admin/game-pools/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to save game entrance");
      onStatus("Game entrance saved. Active rooms keep their current preset.");
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to save game entrance");
    } finally {
      setLoading(false);
    }
  };

  const changeLink = async (id: string, change: { retire?: boolean; rotateToken?: boolean }) => {
    setLoading(true);
    onError("");
    try {
      const response = await authFetch(`/api/admin/game-pools/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(change),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to change the player link");
      onStatus(change.rotateToken ? "A new permanent QR link is ready." : "Game entrance retired.");
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to change the player link");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="grid gap-4 border-b theme-border py-6 sm:grid-cols-[1fr_1fr_auto]">
        <label className="font-mono text-xs theme-muted">
          game
          <select
            value={game}
            onChange={(event) => setGame(event.target.value as GamePoolGame)}
            className="mt-1 min-h-11 w-full border-b theme-border bg-transparent text-[var(--foreground)]"
          >
            {Object.entries(GAME_POOL_DEFAULTS).map(([value, defaults]) => (
              <option key={value} value={value}>
                {defaults.label}
              </option>
            ))}
          </select>
        </label>
        <label className="font-mono text-xs theme-muted">
          label
          <input
            value={label}
            maxLength={80}
            placeholder={GAME_POOL_DEFAULTS[game].label}
            onChange={(event) => setLabel(event.target.value)}
            className="mt-1 min-h-11 w-full border-b theme-border bg-transparent text-[var(--foreground)]"
          />
        </label>
        <button
          type="button"
          disabled={loading}
          onClick={() => void create()}
          className="min-h-11 self-end rounded-full bg-[var(--foreground)] px-5 font-mono text-xs text-[var(--background)] disabled:opacity-50"
        >
          create entrance
        </button>
      </div>
      <label className="mt-5 block max-w-40 font-mono text-xs theme-muted">
        open for minutes
        <input
          type="number"
          min={15}
          max={1440}
          value={duration}
          onChange={(event) => setDuration(Number(event.target.value))}
          className="mt-1 min-h-11 w-full border-b theme-border bg-transparent text-[var(--foreground)]"
        />
      </label>
      {entrances.length === 0 ? (
        <p className="mt-8 font-mono text-xs theme-muted">No game entrances yet.</p>
      ) : (
        <ul className="mt-6 divide-y theme-border">
          {entrances.map((entrance) => {
            const draft = drafts[entrance.id] ?? entrance;
            const run = entrance.run;
            const isExpanded = expanded === entrance.id;
            return (
              <li key={entrance.id} className="py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-serif text-xl font-semibold">{entrance.label}</p>
                    <p className="mt-1 font-mono text-xs theme-muted">
                      {entrance.game} ·{" "}
                      {entrance.retiredAt
                        ? "retired"
                        : run
                          ? `${run.status} since ${new Date(run.openedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                          : "closed"}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpanded(isExpanded ? null : entrance.id)}
                    className="min-h-11 px-2 font-mono text-xs underline"
                  >
                    {isExpanded ? "hide" : "manage"}
                  </button>
                </div>
                {isExpanded ? (
                  <div className="mt-5 space-y-5">
                    <div className="flex flex-wrap gap-3">
                      {entrance.retiredAt ? null : !run ? (
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => void control(entrance.id, "open")}
                          className="min-h-11 rounded-full bg-[var(--foreground)] px-5 font-mono text-xs text-[var(--background)]"
                        >
                          open now
                        </button>
                      ) : run.status === "paused" ? (
                        <button
                          type="button"
                          onClick={() => void control(entrance.id, "resume")}
                          className="min-h-11 rounded-full border theme-border px-5 font-mono text-xs"
                        >
                          resume joins
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void control(entrance.id, "pause")}
                          className="min-h-11 rounded-full border theme-border px-5 font-mono text-xs"
                        >
                          pause joins
                        </button>
                      )}
                      {run ? (
                        <button
                          type="button"
                          onClick={() => void control(entrance.id, "close")}
                          className="min-h-11 px-3 font-mono text-xs text-[var(--prose-hashtag)] underline"
                        >
                          close tonight
                        </button>
                      ) : null}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="font-mono text-xs theme-muted">
                        label
                        <input
                          value={draft.label}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [entrance.id]: { ...draft, label: event.target.value },
                            }))
                          }
                          className="mt-1 min-h-11 w-full border-b theme-border bg-transparent text-[var(--foreground)]"
                        />
                      </label>
                      <label className="font-mono text-xs theme-muted">
                        target room size
                        <input
                          type="number"
                          min={2}
                          max={GAME_POOL_DEFAULTS[entrance.game].capacity}
                          value={draft.targetSize}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [entrance.id]: { ...draft, targetSize: Number(event.target.value) },
                            }))
                          }
                          className="mt-1 min-h-11 w-full border-b theme-border bg-transparent text-[var(--foreground)]"
                        />
                      </label>
                      <label className="font-mono text-xs theme-muted">
                        names in room list
                        <select
                          value={draft.nameVisibility}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [entrance.id]: {
                                ...draft,
                                nameVisibility: event.target.value as GamePoolNameVisibility,
                              },
                            }))
                          }
                          className="mt-1 min-h-11 w-full border-b theme-border bg-transparent text-[var(--foreground)]"
                        >
                          <option value="first-names">first names</option>
                          <option value="initials">initials</option>
                          <option value="counts">counts only</option>
                        </select>
                      </label>
                      <div>
                        <PoolCheck
                          label="let players choose a room"
                          checked={draft.allowRoomChoice}
                          onChange={(allowRoomChoice) =>
                            setDrafts((current) => ({
                              ...current,
                              [entrance.id]: { ...draft, allowRoomChoice },
                            }))
                          }
                        />
                        <PoolCheck
                          label="let players start another room"
                          checked={draft.allowNewRooms}
                          onChange={(allowNewRooms) =>
                            setDrafts((current) => ({
                              ...current,
                              [entrance.id]: { ...draft, allowNewRooms },
                            }))
                          }
                        />
                      </div>
                    </div>
                    <PresetFields
                      preset={draft.preset}
                      onChange={(preset) =>
                        setDrafts((current) => ({
                          ...current,
                          [entrance.id]: { ...draft, preset },
                        }))
                      }
                    />
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void save(entrance.id)}
                      className="min-h-11 rounded-full border theme-border px-5 font-mono text-xs"
                    >
                      save defaults
                    </button>
                    {!entrance.retiredAt ? (
                      <EntranceQr entrance={entrance} />
                    ) : (
                      <p className="border-t theme-border pt-4 font-mono text-xs theme-muted">
                        This entrance and its QR code are retired.
                      </p>
                    )}
                    {!run && !entrance.retiredAt ? (
                      <div className="flex flex-wrap gap-4 border-t theme-border pt-4">
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Replace this permanent player link? The old QR code will stop working.",
                              )
                            )
                              void changeLink(entrance.id, { rotateToken: true });
                          }}
                          className="min-h-11 font-mono text-xs underline"
                        >
                          replace QR link
                        </button>
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Retire this entrance? Its QR code will stop working permanently.",
                              )
                            )
                              void changeLink(entrance.id, { retire: true });
                          }}
                          className="min-h-11 font-mono text-xs text-[var(--prose-hashtag)] underline"
                        >
                          retire entrance
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
