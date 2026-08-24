import { AppSelect } from "@/components/AppSelect";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useGamePreferences } from "../shared/useGamePreferences";
import { GameSettingsTransfer } from "../shared/GameSettingsTransfer";
import { gameSettingsDocument } from "../shared/game-settings";
import { useRememberedPlayerName } from "../shared/useRememberedPlayerName";
import { useWebHaptics } from "web-haptics/react";
import { writeExpiringLocalValue } from "../shared/game-storage.client";
import { createDrawCountryRoomFn } from "./draw-country-room.functions";
import { DRAW_COUNTRY_GAME_SETTINGS } from "./settings";
import { drawCountryBrowserKeys } from "./draw-country-keys";
import { recentCountryIds } from "./rotation-history.client";
import { SoloDrawCountry, type SoloDrawCountryMode } from "./SoloDrawCountry";
import type { CountryOutline } from "./types";
import {
  GameLaunch,
  GameLaunchButton,
  GameLaunchChoices,
  GameLaunchMeta,
} from "../shared/GameLaunch";
import { RoomJoinControl } from "../shared/RoomJoinControl";
import { useNetworkAvailability } from "../shared/useNetworkAvailability";
import { nextSoloCountry } from "./rotation.client";
import { GamePoolDefaultLaunch } from "../pool/GamePoolDefaultLaunch";
import type { GamePoolDefaultLaunch as GamePoolDefaultLaunchTarget } from "../pool/types";

function RoundSettings({
  roundTotal,
  drawSeconds,
  setRoundTotal,
  setDrawSeconds,
}: {
  roundTotal: number;
  drawSeconds: number;
  setRoundTotal: (value: number) => void;
  setDrawSeconds: (value: number) => void;
}) {
  return (
    <>
      <label className="font-mono text-xs text-black/55">
        <span className="block pb-2">countries</span>
        <AppSelect
          value={roundTotal}
          onValueChange={(value) => setRoundTotal(Number(value))}
          ariaLabel="Countries per game"
          tone="cream"
          className="min-h-12 w-full"
          options={[3, 5, 7, 10].map((value) => ({ value, label: `${value} rounds` }))}
        />
      </label>
      <label className="font-mono text-xs text-black/55">
        <span className="block pb-2">time per country</span>
        <AppSelect
          value={drawSeconds}
          onValueChange={(value) => setDrawSeconds(Number(value))}
          ariaLabel="Time per country"
          tone="cream"
          className="min-h-12 w-full"
          options={[20, 30, 45, 60].map((value) => ({ value, label: `${value} seconds` }))}
        />
      </label>
    </>
  );
}

export function DrawCountryApp({
  initialCountry,
  defaultPool,
}: {
  initialCountry: CountryOutline | null;
  defaultPool?: GamePoolDefaultLaunchTarget | null;
}) {
  const navigate = useNavigate();
  const haptics = useWebHaptics();
  const online = useNetworkAvailability();
  const [country, setCountry] = useState(initialCountry);
  const [countryLoadFailed, setCountryLoadFailed] = useState(false);
  const [soloMode, setSoloMode] = useState<SoloDrawCountryMode | null>(null);
  const { name, setName, remember } = useRememberedPlayerName(32);
  const { preferences, set, replace } = useGamePreferences("draw-country", {
    roundTotal: DRAW_COUNTRY_GAME_SETTINGS.roundTotal,
    drawSeconds: DRAW_COUNTRY_GAME_SETTINGS.drawSeconds,
  });
  const roundTotal = preferences.roundTotal;
  const drawSeconds = preferences.drawSeconds;
  const setRoundTotal = (value: number) => set("roundTotal", value);
  const setDrawSeconds = (value: number) => set("drawSeconds", value);
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [panel, setPanel] = useState<"solo" | "friends" | "join" | null>(null);

  useEffect(() => {
    if (country) return;
    let active = true;
    setCountryLoadFailed(false);
    void nextSoloCountry()
      .then((nextCountry) => {
        if (active) setCountry(nextCountry);
      })
      .catch(() => {
        if (active) setCountryLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [country, online]);

  if (soloMode && country)
    return (
      <SoloDrawCountry
        initialCountry={country}
        mode={soloMode}
        roundTotal={roundTotal}
        roundSeconds={soloMode === "quick" ? 30 : drawSeconds}
        onExit={() => setSoloMode(null)}
      />
    );

  const handleCreate = async () => {
    if (!online) {
      setMessage(
        "Rooms need an internet connection. Quick draw and solo rounds still work offline.",
      );
      return;
    }
    if (!name.trim() || creating) {
      setMessage("Add your name to make a room.");
      return;
    }
    setCreating(true);
    setMessage(null);
    try {
      const room = await createDrawCountryRoomFn({
        data: {
          hostName: name.trim(),
          roundTotal,
          drawSeconds,
          recentCountryIds: recentCountryIds(),
        },
      });
      remember(name);
      sessionStorage.setItem(drawCountryBrowserKeys.invite(room.roomId), room.joinToken);
      writeExpiringLocalValue(
        drawCountryBrowserKeys.playerSession(room.roomId),
        {
          roomId: room.roomId,
          playerId: room.playerId,
          playerToken: room.playerToken,
          expiresAt: room.expiresAt,
          snapshot: room.snapshot,
        },
        room.expiresAt,
      );
      void haptics.trigger("success");
      await navigate({ to: "/things/draw-country/$roomId", params: { roomId: room.roomId } });
    } catch {
      setCreating(false);
      setMessage("Could not make the room. Check your connection and try again.");
    }
  };

  const handleJoin = async (code = joinCode) => {
    if (!online) {
      setMessage(
        "Rooms need an internet connection. Quick draw and solo rounds still work offline.",
      );
      return;
    }
    const roomId = code.trim().toUpperCase();
    if (!/^[A-Z2-9]{7}$/.test(roomId)) {
      setMessage("Enter the 7-character room code.");
      return;
    }
    await navigate({ to: "/things/draw-country/$roomId", params: { roomId } });
  };

  return (
    <div className="things-game things-game--cream text-black">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 pt-4 font-mono text-xs text-black/50">
        <Link to="/things" className="inline-flex min-h-11 items-center">
          ← things
        </Link>
        <span>draw the country</span>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl px-5 pb-16 pt-3 sm:pt-8">
        <GameLaunch
          tone="cream"
          eyebrow="from memory"
          title="Draw a country. See what you remembered."
          description="We align your drawing, compare it with the real border, and show exactly where it matched."
        >
          <div className={`grid gap-3 ${defaultPool && online ? "sm:grid-cols-2" : ""}`}>
            <GameLaunchButton
              accent="ink"
              disabled={!country}
              onClick={() => {
                setSoloMode("quick");
                void haptics.trigger("selection");
              }}
            >
              {country ? "quick draw" : "opening the atlas…"}
            </GameLaunchButton>
            {defaultPool && online ? (
              <GamePoolDefaultLaunch pool={defaultPool} tone="light" emphasis="secondary">
                find a room
              </GamePoolDefaultLaunch>
            ) : null}
          </div>
          <GameLaunchMeta tone="light">
            {countryLoadFailed
              ? "reconnect once to save this game for offline play"
              : defaultPool && online
                ? "quick draw or matched multiplayer · shared settings are ready"
                : online
                  ? "one country · 30 seconds · works offline"
                  : "offline · local play is ready"}
          </GameLaunchMeta>
          <GameLaunchChoices tone="light">
            <button
              type="button"
              onClick={() => setPanel(panel === "solo" ? null : "solo")}
              aria-pressed={panel === "solo"}
              className="min-h-11"
            >
              solo rounds
            </button>
            <button
              type="button"
              onClick={() => setPanel(panel === "friends" ? null : "friends")}
              aria-pressed={panel === "friends"}
              className="min-h-11"
            >
              multiplayer rounds
            </button>
            <button
              type="button"
              onClick={() => setPanel(panel === "join" ? null : "join")}
              aria-pressed={panel === "join"}
              className="min-h-11"
            >
              join by code
            </button>
          </GameLaunchChoices>
        </GameLaunch>

        {panel === "solo" ? (
          <section
            className="mx-auto mt-10 max-w-lg border-t border-black/15 pt-7"
            aria-labelledby="solo-rounds-mode"
          >
            <h2 id="solo-rounds-mode" className="font-serif text-3xl font-semibold">
              Solo rounds
            </h2>
            <p className="mt-2 font-serif text-black/55">
              Draw a short set, inspect every map, then compare your scores at the end.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <RoundSettings
                roundTotal={roundTotal}
                drawSeconds={drawSeconds}
                setRoundTotal={setRoundTotal}
                setDrawSeconds={setDrawSeconds}
              />
              <div className="sm:col-span-2">
                <GameSettingsTransfer
                  document={gameSettingsDocument("draw-country", {
                    game: "draw-country",
                    roundTotal,
                    drawSeconds,
                  })}
                  onApply={replace}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setSoloMode("rounds");
                  void haptics.trigger("selection");
                }}
                className="min-h-12 rounded-full bg-black px-6 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white sm:col-span-2"
              >
                start {roundTotal} solo rounds
              </button>
            </div>
          </section>
        ) : null}

        {panel === "friends" ? (
          <section
            className="mx-auto mt-10 max-w-lg border-t border-black/15 pt-7"
            aria-labelledby="together-mode"
          >
            <h2 id="together-mode" className="font-serif text-3xl font-semibold">
              Multiplayer rounds
            </h2>
            <p className="mt-2 font-serif text-black/55">
              Everyone draws the same countries. The closest border wins each round.
            </p>
            {!online ? (
              <p role="status" className="mt-5 font-mono text-xs text-amber-800">
                Rooms need an internet connection. Quick draw and solo rounds are still ready here.
              </p>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleCreate();
                }}
                className="mt-5 grid gap-4 rounded-[1.75rem] border border-black/15 bg-white/25 p-5 sm:grid-cols-3"
              >
                <label className="font-mono text-xs text-black/55">
                  <span className="block pb-2">your name</span>
                  <input
                    name="playerName"
                    value={name}
                    maxLength={32}
                    required
                    autoComplete="name"
                    enterKeyHint="go"
                    onChange={(event) => {
                      setName(event.target.value);
                      setMessage(null);
                    }}
                    /* text-base keeps iOS Safari from zooming the page on focus. */
                    className="min-h-12 w-full rounded-full border border-black/15 bg-white/55 px-4 text-base text-black"
                  />
                </label>
                <RoundSettings
                  roundTotal={roundTotal}
                  drawSeconds={drawSeconds}
                  setRoundTotal={setRoundTotal}
                  setDrawSeconds={setDrawSeconds}
                />
                <button
                  type="submit"
                  disabled={creating}
                  className="min-h-12 rounded-full bg-black px-6 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white disabled:opacity-40 sm:col-span-3"
                >
                  {creating ? "making room…" : defaultPool ? "create private room" : "create room"}
                </button>
              </form>
            )}
            {message ? (
              <p role="status" className="mt-4 font-mono text-xs text-amber-800">
                {message}
              </p>
            ) : null}
          </section>
        ) : null}

        {panel === "join" ? (
          <section
            className="mx-auto mt-10 max-w-lg border-t border-black/15 pt-7"
            aria-label="Join a room"
          >
            {!online ? (
              <p role="status" className="font-mono text-xs text-amber-800">
                Rooms need an internet connection. Quick draw and solo rounds are still ready here.
              </p>
            ) : (
              <RoomJoinControl
                value={joinCode}
                gamePath="/things/draw-country"
                tone="light"
                message={message}
                onValueChange={(value) => {
                  setJoinCode(value);
                  setMessage(null);
                }}
                onJoin={handleJoin}
              />
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}
