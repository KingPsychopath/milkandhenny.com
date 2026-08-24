import { useCallback, useEffect, useState } from "react";
import { AppImage } from "@/components/AppImage";
import { useQrCode } from "@/hooks/useQrCode";
import { GAME_POOL_DEFAULTS } from "@/features/things/pool/presets";
import {
  recommendedGamePoolSettingsBundle,
  type GamePoolSettingsBundle,
} from "@/features/things/pool/preset-bundle";
import { gameSettingsDocument, type GameSettings } from "@/features/things/shared/game-settings";
import type {
  GamePoolEntrance,
  GamePoolGame,
  GamePoolNameVisibility,
} from "@/features/things/pool/types";
import { GamePoolSettingsTransfer } from "./GamePoolSettingsTransfer";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

function editableEntrance(entrance: GamePoolEntrance): GamePoolEntrance {
  return entrance.run
    ? {
        ...entrance,
        gameSettings: entrance.run.gameSettings,
        targetSize: entrance.run.targetSize,
        autoJoin: entrance.run.autoJoin,
        allowRoomChoice: entrance.run.allowRoomChoice,
        allowNewRooms: entrance.run.allowNewRooms,
        nameVisibility: entrance.run.nameVisibility,
      }
    : entrance;
}

function EntranceQr({ entrance }: { entrance: GamePoolEntrance }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = origin ? `${origin}/play/${entrance.token}` : "";
  const { dataUrl, failed } = useQrCode(url || null, 320);
  return (
    <div className="mt-4 border-t theme-border pt-4">
      {dataUrl ? (
        <AppImage
          src={dataUrl}
          alt={`QR code for ${entrance.label}`}
          width={320}
          height={320}
          className="size-48"
        />
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

function GameSettingsFields({
  settings,
  onChange,
}: {
  settings: GameSettings;
  onChange: (settings: GameSettings) => void;
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
  if (settings.game === "same-brain")
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {numberField("rounds", settings.rounds, 3, 20, (rounds) =>
          onChange({ ...settings, rounds }),
        )}
        <label className="font-mono text-xs theme-muted">
          scoring
          <select
            value={settings.scoring}
            onChange={(event) =>
              onChange({
                ...settings,
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
          checked={settings.sayItAloud}
          onChange={(sayItAloud) => onChange({ ...settings, sayItAloud })}
        />
        <PoolCheck
          label="eliminate the odd one"
          checked={settings.eliminateOddOne}
          onChange={(eliminateOddOne) => onChange({ ...settings, eliminateOddOne })}
        />
      </div>
    );
  if (settings.game === "liars")
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="font-mono text-xs theme-muted">
          mode
          <select
            value={settings.mode}
            onChange={(event) =>
              onChange({
                ...settings,
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
          checked={settings.firstGame}
          onChange={(firstGame) => onChange({ ...settings, firstGame })}
        />
        <PoolCheck
          label="blind imposters"
          checked={settings.blindImposters}
          onChange={(blindImposters) => onChange({ ...settings, blindImposters })}
        />
        <PoolCheck
          label="shared word board"
          checked={settings.wordBoard}
          onChange={(wordBoard) => onChange({ ...settings, wordBoard })}
        />
      </div>
    );
  if (settings.game === "centre")
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {numberField("difficulty", settings.difficulty, 1, 5, (value) =>
          onChange({
            ...settings,
            difficulty: Math.max(1, Math.min(5, value)) as 1 | 2 | 3 | 4 | 5,
          }),
        )}
        <PoolCheck
          label="delayed rival dots"
          checked={settings.delayedRivals}
          onChange={(delayedRivals) => onChange({ ...settings, delayedRivals })}
        />
      </div>
    );
  if (settings.game === "twin")
    return (
      <div>
        {numberField("starting hand", settings.handSize, 3, 20, (handSize) =>
          onChange({ ...settings, handSize }),
        )}
      </div>
    );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {numberField("seconds to draw", settings.drawSeconds, 15, 90, (drawSeconds) =>
        onChange({ ...settings, drawSeconds }),
      )}
      {numberField("rounds", settings.roundTotal, 1, 12, (roundTotal) =>
        onChange({ ...settings, roundTotal }),
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
  const [operatorLinks, setOperatorLinks] = useState<Record<string, string>>({});

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
      setDrafts(
        Object.fromEntries(next.map((entrance) => [entrance.id, editableEntrance(entrance)])),
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to load game entrances");
    } finally {
      setLoading(false);
    }
  }, [authFetch, onError]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createEntrance = async (bundle: GamePoolSettingsBundle, actionScope: string) => {
    setLoading(true);
    onError("");
    try {
      const actionStorageKey = `game-pool:create:${actionScope}:action-id`;
      const actionId = sessionStorage.getItem(actionStorageKey) ?? crypto.randomUUID();
      sessionStorage.setItem(actionStorageKey, actionId);
      const response = await authFetch("/api/admin/game-pools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          game: bundle.game,
          label: bundle.label,
          gameSettings: bundle.gameSettings,
          targetSize: bundle.targetSize,
          autoJoin: bundle.admission.autoJoin,
          allowRoomChoice: bundle.admission.allowRoomChoice,
          allowNewRooms: bundle.admission.allowNewRooms,
          nameVisibility: bundle.admission.nameVisibility,
          actionId,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to create game entrance");
      sessionStorage.removeItem(actionStorageKey);
      setLabel("");
      onStatus("Game entrance created with a new permanent QR.");
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to create game entrance");
    } finally {
      setLoading(false);
    }
  };

  const create = () =>
    createEntrance(
      recommendedGamePoolSettingsBundle(game, label.trim() || GAME_POOL_DEFAULTS[game].label),
      "manual",
    );

  const createFromBundle = (bundle: GamePoolSettingsBundle) =>
    createEntrance(bundle, `bundle:${bundle.game}:${bundle.label}`);

  const applyBundle = (id: string, bundle: GamePoolSettingsBundle) => {
    setDrafts((current) => {
      const draft = current[id];
      if (!draft || draft.game !== bundle.game) return current;
      return {
        ...current,
        [id]: {
          ...draft,
          label: bundle.label,
          targetSize: bundle.targetSize,
          autoJoin: bundle.admission.autoJoin,
          allowRoomChoice: bundle.admission.allowRoomChoice,
          allowNewRooms: bundle.admission.allowNewRooms,
          nameVisibility: bundle.admission.nameVisibility,
          gameSettings: bundle.gameSettings,
        },
      };
    });
  };

  const control = async (
    id: string,
    action: "open" | "pause" | "resume" | "close" | "close-room",
    roomId?: string,
  ) => {
    setLoading(true);
    onError("");
    try {
      const actionStorageKey = `game-pool:${id}:${action}:${roomId ?? "run"}:action-id`;
      const actionId = sessionStorage.getItem(actionStorageKey) ?? crypto.randomUUID();
      sessionStorage.setItem(actionStorageKey, actionId);
      const response = await authFetch(`/api/admin/game-pools/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, roomId, durationMinutes: duration, actionId }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        entrance?: GamePoolEntrance;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Failed to control game entrance");
      sessionStorage.removeItem(actionStorageKey);
      if (action === "open" && data.entrance?.operatorToken)
        setOperatorLinks((current) => ({
          ...current,
          [id]: `${window.location.origin}/organize/${data.entrance?.operatorToken}`,
        }));
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
        body: JSON.stringify({
          label: draft.label,
          gameSettings: draft.gameSettings,
          targetSize: draft.targetSize,
          autoJoin: draft.autoJoin,
          allowRoomChoice: draft.allowRoomChoice,
          allowNewRooms: draft.allowNewRooms,
          nameVisibility: draft.nameVisibility,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to save game entrance");
      onStatus("Settings saved. Existing rooms keep their settings; the next room uses these.");
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to save game entrance");
    } finally {
      setLoading(false);
    }
  };

  const makeDefault = async (id: string) => {
    setLoading(true);
    onError("");
    try {
      const response = await authFetch(`/api/admin/game-pools/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to change the public default");
      onStatus("This entrance is now the public default for its game.");
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to change the public default");
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
      <p className="font-mono text-xs leading-relaxed theme-muted">
        Pooled entrances are the fast game-night option: one permanent QR fills and creates rooms
        for you. Use a game’s normal room screen only when you want one QR for one fixed room.
      </p>
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
                      {entrance.game} · {entrance.isDefault ? "public default · " : ""}
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
                    {operatorLinks[entrance.id] ? (
                      <button
                        type="button"
                        onClick={() =>
                          void navigator.clipboard.writeText(operatorLinks[entrance.id] ?? "")
                        }
                        className="min-h-11 font-mono text-xs underline"
                      >
                        copy tonight’s organizer link
                      </button>
                    ) : null}
                    {run ? (
                      <div className="border-t theme-border pt-4">
                        <p className="font-mono text-xs theme-muted">current rooms</p>
                        {entrance.rooms?.length ? (
                          <ul className="mt-2 divide-y theme-border font-mono text-xs">
                            {entrance.rooms.map((room) => (
                              <li
                                key={room.roomId}
                                className="flex items-center justify-between gap-3 py-2"
                              >
                                <span>
                                  {room.label} · {room.status}
                                </span>
                                <span className="flex items-center gap-3 theme-muted">
                                  {room.playerCount}/{room.capacity}
                                  {room.status === "closed" ? null : (
                                    <button
                                      type="button"
                                      disabled={loading}
                                      onClick={() =>
                                        void control(entrance.id, "close-room", room.roomId)
                                      }
                                      className="min-h-11 underline"
                                    >
                                      stop filling
                                    </button>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 font-mono text-xs theme-faint">No rooms yet.</p>
                        )}
                      </div>
                    ) : null}
                    <p className="font-mono text-xs leading-relaxed theme-muted">
                      {run
                        ? "These are tonight’s locked settings. Saving changes the next room and future joins; rooms that already exist keep their game settings."
                        : "These defaults are copied into the next activation when you open it."}
                    </p>
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
                        <label className="flex min-h-11 items-center gap-3 font-mono text-xs theme-muted">
                          <input
                            type="radio"
                            name={`default-pool-${entrance.game}`}
                            checked={draft.isDefault}
                            disabled={loading || Boolean(entrance.retiredAt)}
                            onChange={() => void makeDefault(entrance.id)}
                          />
                          use as this game’s public default
                        </label>
                        <PoolCheck
                          label="automatically continue repeat scans"
                          checked={draft.autoJoin}
                          onChange={(autoJoin) =>
                            setDrafts((current) => ({
                              ...current,
                              [entrance.id]: { ...draft, autoJoin },
                            }))
                          }
                        />
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
                    <GameSettingsFields
                      settings={draft.gameSettings.settings}
                      onChange={(settings) =>
                        setDrafts((current) => ({
                          ...current,
                          [entrance.id]: {
                            ...draft,
                            gameSettings: gameSettingsDocument(entrance.game, settings),
                          },
                        }))
                      }
                    />
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void save(entrance.id)}
                      className="min-h-11 rounded-full border theme-border px-5 font-mono text-xs"
                    >
                      {run ? "save for the next room" : "save defaults"}
                    </button>
                    <GamePoolSettingsTransfer
                      entrance={entrance}
                      draft={draft}
                      disabled={loading}
                      onApply={(bundle) => applyBundle(entrance.id, bundle)}
                      onCreate={createFromBundle}
                      onError={onError}
                      onStatus={onStatus}
                    />
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
